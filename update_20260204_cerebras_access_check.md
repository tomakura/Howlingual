# 2026-02-04 Cerebras モデルアクセス確認

## 実施内容
- /v1/models でモデル一覧取得（CEREBRAS_API_KEY）
- /v1/chat/completions で最小リクエスト（非ストリーム、JSON mode無し）
- ai_service 経由の stream / non-stream テスト

## 結果
- /v1/models は 200。モデル一覧に `qwen-3-235b-a22b-instruct-2507` が含まれる。
- /v1/chat/completions は 404（model_not_found）。
- ai_service 経由の stream / non-stream も 404（model_not_found）。

## 出力レポート
- `reports/cerebras_ai_service_2026-02-04_06-00-14-340.json`
- `reports/provider_test_2026-02-04_06-01-33-696.json`
- `reports/provider_test_2026-02-04_06-01-33-696.md`

## 所感
- モデル一覧に表示されるが chat/completions で 404。アクセス権限 or モデル有効化の問題が濃厚。
