# 不具合・問題点 追加レポート (補足)

既存の `BUG_REPORT.md` に記載されていない、コードベースの詳細調査で発見された追加の問題点と潜在的なバグを以下にまとめます。

## 1. Rust バックエンド (`src-tauri/src/`)

### 1.1 `ocr_engine.rs` - 過剰なデバッグログ
**重要度**: 低 (クリーンアップ)
**場所**: `src-tauri/src/ocr_engine.rs`
**内容**: OCRエンジンの各フェーズ（辞書の読み込み、テキストのデコード、ボックス検出など）で `println!` が多用されています。
```rust
println!("[ocr_engine] Loaded dictionary: {} keys", keys.len());
println!("[ocr_debug] Detected {} text boxes.", rects.len());
println!("[ocr_debug] Raw indices: {:?}", raw_indices);
```
**影響**: リリースビルドでも標準出力に表示されるため、不要なログが蓄積され、わずかですがパフォーマンスに影響を与える可能性があります。
**推奨**: `log` や `tracing` などの適切なロギングフレームワークを使用するか、リリースビルドでは無効化してください。

### 1.2 `ocr_engine.rs` - 画像リサイズ時の固定値フォールバック
**重要度**: 低
**場所**: `src-tauri/src/ocr_engine.rs` 117-122行目
**内容**:
```rust
if resize_w == 0 { resize_w = 32; }
if resize_h == 0 { resize_h = 32; }
```
**影響**: 画像サイズの計算に失敗（結果が0）した場合、一律で32x32にリサイズして処理を継続しようとします。これにより、エラーにならずに意味不明なOCR結果が返される可能性があります。
**推奨**: サイズが不正な場合はエラーを返すように修正してください。

## 2. フロントエンド (`src/`)

### 2.1 `ai_service.ts` - `translateText` における「日本語」のハードコード (未使用)
**重要度**: 低 (技術的負債)
**場所**: `src/lib/ai_service.ts` 578行目
**内容**: 非ストリーミングの `translateText` 関数において、解説言語が「日本語」でハードコードされています。
```typescript
const systemPrompt = buildSystemPrompt("日本語", candidateCount);
```
**影響**: 現在のUIでは `translateTextStream` が使用されているため実害はありませんが、将来この関数を使用した場合、ユーザーの設定に関わらず解説が日本語で強制されます。
**推奨**: `translateText` も `explanationLang` を受け取れるようにするか、不要なら関数を削除してください。

### 2.2 `ai_service.ts` - 壊れやすい JSON パースロジック
**重要度**: 中
**場所**: `src/lib/ai_service.ts` - `tryParsePartialJson`
**内容**: ストリーミング中の不完全なJSONをパースするために、文字列の末尾に `"}`, `]}` などをヒューリスティックに付加して修復を試みています。
```typescript
const closingSequences = ['"}]}}', '"}]}', ...];
```
**影響**: JSONの構造が複雑になった場合や、特定の文字列が含まれる場合にパースに失敗する可能性があり、ストリーミング表示の不自然な挙動（更新が止まる、表示が乱れるなど）の原因になります。
**推奨**: `best-effort-json-parser` のような、より堅牢なストリーミングJSONパースライブラリの使用を検討してください。

### 2.3 `+page.svelte` - アプリバージョンのハードコード
**重要度**: 低
**場所**: `src/routes/+page.svelte` 36行目
**内容**: `const appVersion = "1.0";` がハードコードされています。
**影響**: `package.json` や `tauri.conf.json` のバージョン情報と乖離する可能性があります。
**推奨**: `package.json` からインポートするか、`tauri-plugin-package-info` を使用してください。

## 3. 設定・ビルド関連

### 3.1 `package.json` - universal-apple-darwin ビルドのリスク
**重要度**: 中
**場所**: `package.json`
**内容**: `"tauri:build:mac": "tauri build --target universal-apple-darwin"`
**影響**: ユニバーサルバイナリのビルドには、すべてのネイティブ依存関係（Rustクレート）が x86_64 と aarch64 の両方をサポートしている必要があります。`ort` (ONNX Runtime) や `xcap` などのネイティブライブラリを含むクレートでリンクエラーが発生したり、特定のアーキテクチャでクラッシュするバイナリが生成されるリスクがあります。
**推奨**: 実機での動作確認を徹底するか、必要に応じて個別のアーキテクチャ向けにビルドコマンドを分けてください。

## 4. その他の論理リスク

### 4.1 クリップボード操作の競合 (Race Condition)
**重要度**: 中
**場所**: `src-tauri/src/lib.rs` - `capture_selected_text`
**内容**: 元のクリップボードを一時退避し、クリア後に `Ctrl+C` をシミュレート、ウェイトを置いてから元の状態に戻すという処理を行っています。
**影響**: この一瞬の処理中にユーザーが手動でコピーを行ったり、システムの動作が遅れた場合、ユーザーのクリップボードデータが消失したり、意図しないデータが取得される可能性があります。`thread::sleep` に依存した実装は不安定さの要因です。
**推奨**: Windows の UI Automation や macOS のアクセシビリティ API を使用して、クリップボードを経由せずにテキストを取得する方法を検討してください。
