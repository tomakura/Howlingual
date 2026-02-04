# update_20260204_provider_direct.md

## 変更内容
- Groq/Cerebras を OpenAI SDK 経由ではなく、各プロバイダーの HTTP API へ直接リクエストする方式に切替。
- ストリーミングは SSE を自前で読み取り、部分JSONを逐次反映。
- APIエラー本文からメッセージを抽出し、Cerebras 404 の原因が見えるように改善。

## 影響範囲
- Groq/Cerebras の通信経路が OpenAI SDK 依存から外れます。
- エラーメッセージが具体化されます（例: モデル未アクセス）。

## テスト
- `scripts/cerebras_ai_service_test.mjs` でストリーム/非ストリームの疎通を再確認。
  - `reports/cerebras_ai_service_2026-02-04_05-12-21-409.json`
