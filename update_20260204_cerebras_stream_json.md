# 2026-02-04 Cerebras Stream JSON調整

## 変更内容
- Groq/Cerebras の API キー解決に `.env` の `VITE_GROQ_API_KEY` / `VITE_CEREBRAS_API_KEY` をフォールバックとして追加。
- Cerebras のストリーミング時は `response_format: json_object` を送らないように変更（JSONはシステムプロンプトで強制）。
- Cerebras のモデル一覧取得も `.env` のキーをフォールバックに使用。
- `SchemaType` の import を復旧。

## 理由
- .env にキーを入れた場合に UI 入力なしでも利用できるようにするため。
- Cerebras のストリーミングで JSON mode が非対応なため（stream時はJSON modeを外す）。

## 影響範囲
- 翻訳ストリーミング（Cerebras）
- API キー解決（Groq/Cerebras）
- モデル一覧取得（Cerebras）
- Gemini 型定義（`SchemaType`）

## テスト
- 未実施
