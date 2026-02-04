# update_20260201_models.md

## 変更内容
- `src/lib/ai_models.ts` のモデル一覧を最新ドキュメント準拠に更新（OpenAI/Gemini/Anthropic/Groq/Cerebras）。
- OpenAI の Responses API 限定モデル（例: gpt-5.2-pro / o3-pro）を一覧とストリーミング対象から除外。
- Anthropic のモデル ID を現行のバージョン付き ID に差し替え。
- Groq の廃止・停止済みモデルを一覧とストリーミング対象から削除。
- デフォルトモデルを現行モデルに更新（Anthropic/Groq/Cerebras）。
- Cerebras デフォルトを `qwen-3-235b-a22b-instruct-2507` に変更。
