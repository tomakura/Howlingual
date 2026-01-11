# Howlingual

AIの力を活用した、デスクトップ向けの高度な翻訳・校正ツールです。

## 主な機能

- **マルチエンジンAI翻訳**: OpenAI (GPT), Anthropic (Claude), Google (Gemini) の最新モデルを選択可能。
- **OCR (光学文字認識) 翻訳**: 画面上の任意の範囲をキャプチャし、即座に翻訳します。
- **クイック翻訳**: ショートカットキー一つで、選択中のテキストやクリップボードの内容を翻訳。
- **文体カスタマイズ**: 「ビジネス」「カジュアル」「要約」など、用途に合わせた翻訳スタイルの設定・保存が可能。
- **多言語対応**: 日本語、英語をはじめとする複数の言語に対応したUI。

## 技術スタック

- **Frontend**: [SvelteKit](https://kit.svelte.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Backend**: [Tauri](https://tauri.app/) (Rust)
- **Styling**: Vanilla CSS

## セットアップ

### プリレクイジット
- [Rust](https://www.rust-lang.org/)
- [Node.js](https://nodejs.org/) (v18+)

### インストールと実行
1. 依存関係のインストール:
   ```powershell
   npm install
   ```
2. 開発モードでの起動:
   ```powershell
   npm run tauri dev
   ```

## ライセンス
MIT

