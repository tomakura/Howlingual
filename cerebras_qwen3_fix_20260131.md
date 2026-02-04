# Cerebras Qwen3 235B 修正メモ (2026-01-31)

## 目的
- Cerebrasの`qwen-3-235b-a22b-instruct-2507`で翻訳が失敗する問題の緩和。

## 修正内容
- `src/lib/ai_service.ts` に、Cerebras向けのJSONモード失敗時フォールバックを追加。
  - JSONモードで`400`/`failed_generation`等が返った場合、`response_format`なしで再試行。
  - JSON抽出は既存の堅牢パーサで処理。

## 根拠（挙動）
- CerebrasのJSONモードは、無効JSON時に`failed_generation`を含む`400`を返すため、再試行が有効。
- JSONモードはストリーミングと併用不可。

## 影響範囲
- Cerebrasプロバイダの翻訳実行時。

## 簡易確認
1. Cerebras + Qwen3 235Bで翻訳実行
2. 失敗時に再試行で結果が返るか確認
3. UIにエラーが表示される場合は内容を記録
