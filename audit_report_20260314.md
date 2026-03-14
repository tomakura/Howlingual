# Howlingual 監査レポート

更新日: 2026-03-14  
監査対象: `src/`, `src-tauri/`, ルート設定/ドキュメント/ビルド設定  
対象OS: macOS / Windows / Linux  
監査時点の事実:

- `yarn check` は通過
- `cargo check` は通過
- ただし静的チェック通過は「設計上安全」を意味しない
- ワークツリーは監査時点で dirty だったため、このレポートは「現在の作業ツリー全体」を対象にした

## 要約

現在の Howlingual は、動作している箇所が多い一方で、以下の領域に高いリスクが集中している。

1. フロントの状態管理が `localStorage` / Tauri event / polling / `invoke` に分散しており、競合時の最終状態が不定
2. クリップボード依存の選択取得・置換がユーザー資産を壊しうる
3. OCR が全モニタキャプチャ + 共有グローバル状態 + timing 依存で、性能/プライバシー/再現性の面で危険
4. 翻訳バックエンドが hand-written JSON/SSE パースに強く依存し、provider 仕様変更に脆い
5. `+page.svelte` と `src-tauri/src/lib.rs` への責務集中が限界に近く、局所修正でも別機能へ回帰しやすい
6. ユーザー意図を上書きする UX が複数ある

## 優先度の意味

- `P0`: ユーザー資産破壊、誤動作、再現困難な race、継続運用に直結する外部仕様ズレ
- `P1`: 近いうちに障害やUX破綻へ繋がる構造問題、責務分離不足、誤解を生む仕様
- `P2`: 保守性低下、将来の仕様変更に弱い箇所、今すぐではないが積み残すと高コスト化する箇所

## Findings

### P0-1. クリップボード hack がユーザー資産を壊しうる

- 症状:
  選択取得と置換が「一度 clipboard を上書きし、後で戻す」方式に依存している。
- なぜ危ないか:
  現在の退避対象は実質 `text` と `image` だけで、複合フォーマット、ファイル参照、アプリ固有 pasteboard 形式は安全に戻せない。途中失敗時は復元不能になる。
- ユーザー影響:
  直前にコピーしていた内容が壊れる、置換で別アプリの入力を汚す、ショートカット起動が副作用を持つ。
- 再現条件:
  ファイルやリッチコンテンツを clipboard に持った状態で `replace_selection` または quick capture を使う。貼り付け先アプリが遅い/権限不足/入力拒否でも発生余地がある。
- 根拠:
  [`src-tauri/src/lib.rs:227`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L227), [`src-tauri/src/lib.rs:280`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L280), [`src-tauri/src/lib.rs:667`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L667), [`src/routes/+page.svelte:2010`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L2010)
- 想定UXとの差分:
  ユーザーは「翻訳アプリが補助する」ことを期待しており、「クリップボードの中身を失う」ことは期待していない。
- 修正の切り出し単位:
  backend の clipboard abstraction を独立させ、退避/復元可能形式、失敗時ロールバック、明示確認 UX をセットで見直す。

### P0-2. 状態同期経路が多重化し、stale state と race の温床になっている

- 症状:
  初期ロード、`storage` イベント、Tauri `listen`, `request_translation_state`, `get_pending_text/get_handover_text` polling, `sync_translation_context` が同時に state を更新する。
- なぜ危ないか:
  どの経路が最後に state を上書きしたかが追えず、特に compact/main handover や起動直後に UI が消える/戻る/古い内容へ巻き戻る。
- ユーザー影響:
  翻訳結果の消失、入力内容の巻き戻り、履歴/お気に入り/設定の表示が開いているウィンドウごとにズレる。
- 再現条件:
  compact 起動直後に event 到着が遅れる、main/compact を高速に往復する、複数ウィンドウで設定や履歴を書き換える。
- 根拠:
  [`src/routes/+page.svelte:779`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L779), [`src/routes/+page.svelte:909`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L909), [`src/routes/+page.svelte:922`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L922), [`src/routes/+page.svelte:956`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L956), [`src/routes/+page.svelte:1068`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L1068), [`src/routes/+page.svelte:1878`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L1878)
- 想定UXとの差分:
  ユーザーは「どのウィンドウでも同じ状態」を期待するが、現状は「最も遅く届いた同期経路が勝つ」。
- 修正の切り出し単位:
  翻訳状態の単一ソースを決め、window handover と local persistence を adapter 層へ寄せる。

### P0-3. OCR が全モニタキャプチャ前提で、性能・プライバシー・復帰制御のリスクが大きい

- 症状:
  OCR 開始で全モニタをキャプチャし、メモリ保持し、capture window 群を生成する。失敗時や座標エラー時は全体状態を消す。
- なぜ危ないか:
  高解像度/多画面で重い。ユーザーが選んでいない画面まで取得する。`OcrOriginState` と `LastCursorPos` の共有状態に復帰先が依存し、近接操作で race を起こしやすい。
- ユーザー影響:
  OCR 開始が重い、許可したくない画面内容まで取得される、キャンセル後に別ウィンドウへ戻る、再試行 UX が悪い。
- 再現条件:
  4K 複数モニタ、OCR 開始直後のキャンセル、失敗リトライ、compact/main を跨いだ OCR。
- 根拠:
  [`src-tauri/src/lib.rs:1273`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1273), [`src-tauri/src/lib.rs:1295`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1295), [`src-tauri/src/lib.rs:1330`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1330), [`src-tauri/src/lib.rs:1468`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1468), [`src-tauri/src/lib.rs:1533`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1533), [`src-tauri/src/lib.rs:1575`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1575)
- 想定UXとの差分:
  ユーザーは「選んだ範囲だけを軽く読む」ことを期待している。
- 修正の切り出し単位:
  OCR セッションを per-request state に切り出し、capture 範囲と復帰先をセッションIDで管理する。

### P0-4. 翻訳ストリーミングが hand-written JSON/SSE パースに依存している

- 症状:
  部分 JSON の抽出、文字列復元、SSE 区切り、候補テキスト抽出がすべて独自実装。
- なぜ危ないか:
  provider 側の event 形状、delta 形式、JSON エスケープ、partial JSON の出し方が少し変わるだけで、誤った `text` / `reason` を UI に流す。
- ユーザー影響:
  streaming 中に壊れた翻訳案が出る、理由欄が別候補と混ざる、最終 JSON だけ失敗して error になる。
- 再現条件:
  provider ごとの差分、途中で JSON が未閉じの状態、未知 event の混入、エスケープ文字を含む出力。
- 根拠:
  [`src-tauri/src/translation_backend.rs:312`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L312), [`src-tauri/src/translation_backend.rs:399`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L399), [`src-tauri/src/translation_backend.rs:485`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L485), [`src-tauri/src/translation_backend.rs:518`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L518), [`src-tauri/src/translation_backend.rs:697`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L697)
- 想定UXとの差分:
  ユーザーは「streaming は途中でもだいたい正しい」ことを期待する。
- 修正の切り出し単位:
  provider ごとの parser 層を分離し、partial 解析と final 解析を別契約へ分ける。

### P1-1. フロントの責務が `+page.svelte` に集中しすぎている

- 症状:
  メイン画面、翻訳ライフサイクル、設定、履歴、OCR、権限、usage、TTS、スクロール制御が 1 ファイルに集中している。
- なぜ危ないか:
  修正箇所が多すぎて局所変更の影響範囲を読み切れない。レビュー粒度が荒くなり、回帰が見逃されやすい。
- ユーザー影響:
  小さな仕様変更でも別UXが壊れやすい。開発速度より回帰コストが先に増える。
- 再現条件:
  任意の UI/状態変更時。
- 根拠:
  [`src/routes/+page.svelte`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte), 監査時点の行数 10,552
- 想定UXとの差分:
  表面的には動いていても、継続改善しづらい。
- 修正の切り出し単位:
  `translation state`, `window sync`, `settings/history modal`, `usage/tech metrics`, `OCR` に分離する。

### P1-2. 既に分離済みの `SettingsPanel` / `HistoryPanel` が未使用で、本体に重複実装が残っている

- 症状:
  設定・履歴用コンポーネントが存在するが、本体側でも同等UIを再実装している。監査時点では import 参照なし。
- なぜ危ないか:
  片方だけ更新され、将来の仕様差分・アクセシビリティ差分・文言差分の温床になる。
- ユーザー影響:
  UI が似ているのに挙動や文言がズレる。
- 根拠:
  [`src/lib/components/SettingsPanel.svelte:1`](/Users/flow/Programs/Howlingual/src/lib/components/SettingsPanel.svelte#L1), [`src/lib/components/HistoryPanel.svelte:1`](/Users/flow/Programs/Howlingual/src/lib/components/HistoryPanel.svelte#L1), [`src/routes/+page.svelte:5258`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L5258), [`src/routes/+page.svelte:6601`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L6601)
- 想定UXとの差分:
  同じ機能は同じ実装を共有すべきだが、現状は abandoned refactor に近い。
- 修正の切り出し単位:
  使う側を一本化し、未使用側を削除または本採用する。

### P1-3. 同一言語翻訳防止がユーザー意図を上書きし、英語 fallback もハードコードされている

- 症状:
  `allowRewrite=false` のとき、source と target が同じだと target を自動変更する。fallback は `"英語"` 固定。
- なぜ危ないか:
  ユーザーが明示的に選んだ target が裏で変わる。UI 言語や保存状態が日本語内部値に依存している。
- ユーザー影響:
  「勝手に翻訳先が変わる」「履歴再実行で前回と違う」体験になる。
- 再現条件:
  auto-detect + 同一言語、または default target と source の衝突時。
- 根拠:
  [`src/routes/+page.svelte:93`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L93), [`src/routes/+page.svelte:2071`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L2071), [`src/routes/+page.svelte:2080`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L2080)
- 想定UXとの差分:
  ユーザーは警告や選択肢を期待するのであって、黙って target を書き換えられることは期待しない。
- 修正の切り出し単位:
  language identity を内部コード化し、rewrite policy は明示的な UI 契約にする。

### P1-4. 永続化が ad hoc な `localStorage` 直書きで、スキーマと互換戦略がない

- 症状:
  設定、文体、履歴、お気に入り、最終結果、usage が個別キーで散発保存される。壊れた JSON は握り潰し気味。
- なぜ危ないか:
  保存形式変更時に旧データ移行ができない。コメントと実装がズレている。
- ユーザー影響:
  更新後に状態が静かに壊れる、履歴だけ残る、最後の結果だけ消える、設定が巻き戻る。
- 再現条件:
  スキーマ変更、壊れた localStorage、別バージョンからの移行。
- 根拠:
  [`src/routes/+page.svelte:781`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L781), [`src/routes/+page.svelte:1070`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L1070), [`src/routes/+page.svelte:2692`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L2692), [`src/routes/+page.svelte:2788`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L2788), [`src/routes/+page.svelte:2978`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L2978)
- 想定UXとの差分:
  ユーザーはアップデート後も設定と履歴が整合的に残ることを期待する。
- 修正の切り出し単位:
  storage schema version と migration を追加し、I/O を専用モジュールへ寄せる。

### P1-5. 権限UXが OS ごとに一貫しておらず、macOS では前倒し要求、他OSでは実質 no-op

- 症状:
  macOS はアプリ起動時に screen capture 権限を前倒し要求する。一方 non-mac は `check_permissions` が常に `true` を返し、`request_permissions` も実質何もしない。
- なぜ危ないか:
  ユーザーが OCR を使う前にダイアログが出る。Linux/Windows では失敗理由が permission UI 上から見えない。
- ユーザー影響:
  「何もしていないのに権限要求」「許可済みに見えるのに動かない」体験になる。
- 根拠:
  [`src-tauri/src/lib.rs:1732`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1732), [`src-tauri/src/lib.rs:1770`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1770), [`src-tauri/src/lib.rs:1808`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1808), [`src-tauri/src/lib.rs:1869`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L1869)
- 想定UXとの差分:
  権限は必要になった時点で説明付きで要求されるべき。
- 修正の切り出し単位:
  permission surface を OS capability と分けて設計し直す。

### P1-6. provider 実行ポリシーがフロントとバックエンドで二重管理されている

- 症状:
  フロントには `translation_policy.ts` があり、stream/json 可否を持つ。一方バックエンドは常に streaming を試して失敗したら non-stream fallback する。
- なぜ危ないか:
  片方だけ更新されると、UI の想定と backend の実際がズレる。
- ユーザー影響:
  「このモデルは stream 非対応のはずなのに stream 表示になる」「fallback 原因が見えない」などのズレになる。
- 根拠:
  [`src/lib/translation_policy.ts:17`](/Users/flow/Programs/Howlingual/src/lib/translation_policy.ts#L17), [`src-tauri/src/translation_backend.rs:991`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L991), [`src-tauri/src/translation_backend.rs:1288`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L1288), [`src-tauri/src/translation_backend.rs:1419`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L1419)
- 想定UXとの差分:
  UI が見せる「このプロバイダはこう動く」が backend と一致しているべき。
- 修正の切り出し単位:
  capability 判定を backend 側へ一本化し、UI は backend の plan を描画するだけにする。

### P1-7. `service` window / `/service` ルートが役目を終えているのに残っている

- 症状:
  hidden service window が Tauri config に残り、ルート側コメントでも「設定に残っているから残しているだけ」と明記されている。
- なぜ危ないか:
  役目を終えた構成物が残ると、デバッグ・起動コスト・将来の責務判断を濁らせる。
- ユーザー影響:
  直接的なUX破壊は軽いが、今後の修正判断を誤らせる。
- 根拠:
  [`src-tauri/tauri.conf.json:13`](/Users/flow/Programs/Howlingual/src-tauri/tauri.conf.json#L13), [`src/routes/service/+page.svelte:5`](/Users/flow/Programs/Howlingual/src/routes/service/+page.svelte#L5)
- 想定UXとの差分:
  不要構成物は残さないほうが全体の挙動理解が容易。
- 修正の切り出し単位:
  service route/window 削除可否を確定し、削除または正式な責務再定義を行う。

### P1-8. i18n が途中で破れており、アプリ言語と表示言語が混在する

- 症状:
  hardcoded error 文、OCR overlay 文言、aria-label、日付表示が `appLanguage` ではなく固定文字列や OS locale に依存する。
- なぜ危ないか:
  多言語UIを売りにしているのに、アクセシビリティ層と補助UIが未翻訳。
- ユーザー影響:
  英語UIでも一部だけ日本語/英語固定になる。スクリーンリーダー利用者で特に目立つ。
- 根拠:
  [`src/routes/+page.svelte:1693`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L1693), [`src/routes/+page.svelte:6700`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L6700), [`src/routes/+page.svelte:6737`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L6737), [`src/routes/+page.svelte:6832`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L6832), [`src/lib/components/CaptureOverlay.svelte:250`](/Users/flow/Programs/Howlingual/src/lib/components/CaptureOverlay.svelte#L250)
- 想定UXとの差分:
  見た目だけでなく補助文言と日時まで含めて言語切替が一貫するべき。
- 修正の切り出し単位:
  visible text / aria text / date formatting を全て i18n 層へ寄せる。

### P1-9. macOS / Windows / Linux 差分が capability ではなく if 分岐で散在している

- 症状:
  window, OCR, input simulation, permissions が各所の `cfg` と `navigator.userAgent` へ散在する。
- なぜ危ないか:
  platform behavior を追うには frontend と Rust を両方見ないといけない。
- ユーザー影響:
  OS ごとの差分バグが直しにくい。
- 根拠:
  [`src/routes/+page.svelte:168`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L168), [`src/routes/+page.svelte:835`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte#L835), [`src-tauri/src/lib.rs:326`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L326), [`src-tauri/src/lib.rs:525`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L525), [`src-tauri/src/lib.rs:582`](/Users/flow/Programs/Howlingual/src-tauri/src/lib.rs#L582)
- 想定UXとの差分:
  OS 差は capability contract に閉じ込めるべきで、UI は「できる/できない」だけ見ればよい。
- 修正の切り出し単位:
  platform capability API を backend 側で整備する。

### P2-1. hardcoded model inventory が時間とともに腐りやすい

- 症状:
  モデル一覧、推奨モデル、速度/品質の推定が全て静的配列と命名規則推定で管理されている。
- なぜ危ないか:
  provider 側の model lifecycle とズレる。UI のラベルと backend の実際の互換性が乖離しやすい。
- ユーザー影響:
  推奨モデルが古い、存在しない model を選ぶ、streaming 体験ラベルが実態と違う。
- 根拠:
  [`src/lib/ai_models.ts:18`](/Users/flow/Programs/Howlingual/src/lib/ai_models.ts#L18), [`src/lib/ai_models.ts:116`](/Users/flow/Programs/Howlingual/src/lib/ai_models.ts#L116)
- 想定UXとの差分:
  「推奨」「高速」「高品質」が最新 provider 事情を反映している前提で表示されている。
- 修正の切り出し単位:
  model catalog の更新責務を分離し、少なくとも provider capability と model list を別管理にする。

### P2-2. provider 実装が分岐ごとに重複しており、仕様追従コストが高い

- 症状:
  endpoint、header、usage extraction、response path が provider ごとに分散している。
- なぜ危ないか:
  新 provider 追加や既存 provider 仕様更新時に重複修正が必要になる。
- ユーザー影響:
  provider 間で error handling や metrics の精度がバラつく。
- 根拠:
  [`src-tauri/src/translation_backend.rs:580`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L580), [`src-tauri/src/translation_backend.rs:622`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L622), [`src-tauri/src/translation_backend.rs:657`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L657), [`src-tauri/src/translation_backend.rs:1056`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L1056)
- 想定UXとの差分:
  provider が違っても基本的な挙動品質は揃うべき。
- 修正の切り出し単位:
  request builder / stream decoder / final parser / usage mapper を provider adapter 化する。

### P2-3. package manager と lockfile が混在している

- 症状:
  `packageManager` は Yarn 4 なのに `package-lock.json` と `yarn.lock` が共存している。
- なぜ危ないか:
  CI/開発者環境で install 元が揺れる。依存差分が再現しにくい。
- ユーザー影響:
  直接 UX ではないが、ビルド再現性を下げる。
- 根拠:
  [`package.json:39`](/Users/flow/Programs/Howlingual/package.json#L39), [`package-lock.json`](/Users/flow/Programs/Howlingual/package-lock.json), [`yarn.lock`](/Users/flow/Programs/Howlingual/yarn.lock)
- 想定UXとの差分:
  開発/配布の再現性は一貫しているべき。
- 修正の切り出し単位:
  package manager を一本化し、不要 lockfile を整理する。

### P2-4. ログ戦略が開発観測向けに寄りすぎている

- 症状:
  UI 側に `console.log` / `console.warn` が大量に残り、さらに `logging.ts` で console をラップして Tauri log へ転送している。
- なぜ危ないか:
  ノイズが多く、重要ログが埋もれる。意図せず機微情報をログへ流すリスクも上がる。
- ユーザー影響:
  障害調査効率低下。ログ量増加。
- 根拠:
  [`src/lib/logging.ts:1`](/Users/flow/Programs/Howlingual/src/lib/logging.ts#L1), [`src/routes/+page.svelte`](/Users/flow/Programs/Howlingual/src/routes/+page.svelte), [`src/lib/components/CaptureOverlay.svelte:35`](/Users/flow/Programs/Howlingual/src/lib/components/CaptureOverlay.svelte#L35)
- 想定UXとの差分:
  本番ログは診断に必要な粒度へ絞られているべき。
- 修正の切り出し単位:
  structured logging の方針と log level を整理する。

## 外部API仕様とのズレ

### 1. OpenAI は Chat Completions 継続利用自体は可能だが、公式には Responses API と Structured Outputs が推奨

- 現状:
  OpenAI 系は `chat/completions` + `response_format: { "type": "json_object" }` を使用している。
- リスク:
  直ちに壊れるわけではないが、今後の structured output / tool / output item の拡張は Responses API を中心に進む。現実装は古い JSON mode に寄っている。
- 根拠:
  [`src-tauri/src/translation_backend.rs:588`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L588), [`src-tauri/src/translation_backend.rs:1003`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L1003)
- 公式:
  [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs/)  
  [OpenAI Migrate to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses/)

### 2. Groq では Structured Outputs と streaming の制約があり、現在の hand-written JSON fallback は中途半端

- 現状:
  Groq を OpenAI 互換として同一実装で streaming している。
- リスク:
  schema guarantee を持たないまま streaming partial parse に依存している。公式の structured output 制約とアプリ設計が噛み合っていない。
- 根拠:
  [`src/lib/translation_policy.ts:18`](/Users/flow/Programs/Howlingual/src/lib/translation_policy.ts#L18), [`src-tauri/src/translation_backend.rs:1016`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L1016)
- 公式:
  [Groq Structured Outputs](https://console.groq.com/docs/structured-outputs)

### 3. Anthropic streaming は event 種別が多く、現在の parser は狭い仮定に依存している

- 現状:
  event を generic SSE として読み、`/delta/text` のみを主に見ている。
- リスク:
  `message_start`, `content_block_*`, `message_delta`, `ping`, `error` などの event 差分や拡張に弱い。
- 根拠:
  [`src-tauri/src/translation_backend.rs:863`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L863), [`src-tauri/src/translation_backend.rs:938`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L938)
- 公式:
  [Anthropic Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)

### 4. Gemini は structured output streaming を持つが、現在のコードは provider 契約を自前パースへ落としている

- 現状:
  `streamGenerateContent` の text part を連結し、最終的に自前 JSON 抽出へ渡している。
- リスク:
  partial JSON 契約に頼るなら provider 専用 parser を持つほうが安全。今は他 provider と同じ抽象へ押し込んでいる。
- 根拠:
  [`src-tauri/src/translation_backend.rs:664`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L664), [`src-tauri/src/translation_backend.rs:946`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L946)
- 公式:
  [Gemini Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)  
  [Gemini API Reference](https://ai.google.dev/api)

### 5. Cerebras は OpenAI 互換でも完全互換ではなく、現在の一括扱いは危険

- 現状:
  OpenAI 互換 endpoint として同じ payload を投げている。
- リスク:
  `system` の扱い、未対応パラメータ、レスポンス差分が provider 固有にある。現状は OpenAI 同等前提で吸収している。
- 根拠:
  [`src/lib/translation_policy.ts`](/Users/flow/Programs/Howlingual/src/lib/translation_policy.ts), [`src-tauri/src/translation_backend.rs:1028`](/Users/flow/Programs/Howlingual/src-tauri/src/translation_backend.rs#L1028)
- 公式:
  [Cerebras OpenAI Compatibility](https://inference-docs.cerebras.ai/resources/openai)  
  [Cerebras Streaming](https://inference-docs.cerebras.ai/capabilities/streaming)

## 先に直す順番

1. `P0-1` クリップボード破壊リスクを止める
2. `P0-2` 状態同期経路を一本化する
3. `P0-3` OCR セッションと復帰制御を分離する
4. `P0-4` provider parser を分離し、stream/final parse を建て直す
5. `P1-1` / `P1-2` でフロントの責務分割と dead UI 整理を行う
6. `P1-5` 権限UXを再設計する
7. `P1-6` backend 主導の execution plan に寄せる
8. `P1-7` / `P2-3` の残骸とビルド周りを整理する

## 並行で直せる束

- 束A:
  クリップボード、権限、OCR セッション
- 束B:
  フロント state/store 分離、settings/history modal の一本化
- 束C:
  provider adapter 化、外部API capability 管理、model catalog 整理
- 束D:
  i18n 補完、date/aria 文言統一、service window 削除、lockfile 整理

## 補足

- このレポートは「今のワークツリーでどこが危ないか」をまとめたもので、誰が入れた変更かの切り分けはしていない。
- 静的チェックが通っているため、次の実装段では「壊れている箇所の修理」より「壊れやすい構造の削減」が主眼になる。
