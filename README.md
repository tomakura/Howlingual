# 🌐 Howlingual

**AI翻訳 × OCR × リアルタイムストリーミング**  
デスクトップ向けの次世代翻訳・校正ツール

---

## ✨ 主な機能

### 🤖 マルチプロバイダーAI翻訳
- **OpenAI** (GPT-4, GPT-4 Turbo, GPT-3.5 Turbo)
- **Anthropic** (Claude 3.5 Sonnet, Claude 3 Opus/Haiku)
- **Google** (Gemini Pro/Flash)
- **Groq** (高速推論エンジン)
- **Cerebras** (超高速AI処理)

すべてのプロバイダーで**リアルタイムストリーミング翻訳**に対応。翻訳が生成されるそばから結果を確認できます。

### 📸 OCR翻訳
画面上の任意の範囲をキャプチャして即座に翻訳。  
画像内のテキストを自動認識し、自然な翻訳を提供します。

- 日本語OCRエンジン（PaddleOCR v3/v4/v5）内蔵
- macOS標準のVision OCRにも対応

### ⚡ クイック翻訳モード
ショートカットキー一つで、コンパクトな翻訳ウィンドウを起動。  
選択中のテキストやクリップボードの内容を素早く翻訳できます。

- メインウィンドウとクイックウィンドウ間でシームレスに状態を引き継ぎ
- 翻訳履歴、文体設定、技術指標もすべて同期

### 🎨 文体カスタマイズ
用途に合わせた翻訳スタイルを自由に設定・保存。

- **プリセット**: ビジネス、カジュアル、要約、技術文書など
- **カスタム設定**: トーンや詳細度を細かく調整可能
- お気に入り機能で、よく使う設定をワンクリックで適用

### 📊 技術指標の可視化
翻訳のパフォーマンスを詳細に把握。

- 待機時間、初回応答時間、ストリーミング速度
- 使用モデル、トークン数、コスト推定
- コンパクト表示で邪魔にならない

### 🌍 多言語対応UI
日本語・英語をはじめ、複数の言語でインターフェースを利用可能。

---

## 🛠️ 技術スタック

| レイヤー | 技術 |
|---------|------|
| **Frontend** | [SvelteKit](https://kit.svelte.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| **Backend** | [Tauri v2](https://tauri.app/) (Rust) |
| **OCR Engine** | PaddleOCR (ONNX), macOS Vision |
| **AI Integration** | OpenAI API, Anthropic API, Google Generative AI, Groq, Cerebras |
| **Styling** | Vanilla CSS |

---

## 🚀 セットアップ

### 必要な環境
- [Rust](https://www.rust-lang.org/) (最新安定版)
- [Node.js](https://nodejs.org/) v18 以上
- macOS / Windows / Linux

### インストール手順

1. **リポジトリをクローン**
   ```bash
   git clone https://github.com/tomakura/Howlingual.git
   cd Howlingual
   ```

2. **依存関係のインストール**
   ```bash
   npm install
   ```

3. **開発モードで起動**
   ```bash
   npm run tauri dev
   ```

4. **本番用ビルド**
   ```bash
   npm run tauri build
   ```

   プラットフォーム別のビルド方法は [BUILD.md](BUILD.md) を参照してください。

### API キーの設定
初回起動時に設定画面からAPIキーを登録してください。

- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/
- Google: https://ai.google.dev/
- Groq: https://console.groq.com/
- Cerebras: https://cerebras.ai/

---

## 🎯 使い方

### メインウィンドウ
1. テキストエリアに翻訳したい文章を入力
2. AIプロバイダーとモデルを選択
3. 翻訳ボタンをクリック（またはショートカットキー）
4. リアルタイムで翻訳結果が表示されます

### クイックモード
1. グローバルショートカットキーでクイックウィンドウを起動
2. 自動的にクリップボードの内容を翻訳
3. 結果を確認後、メインウィンドウに引き継ぎ可能

### OCRキャプチャ
1. キャプチャボタンをクリック
2. 画面上の翻訳したい範囲をドラッグ
3. OCRで文字認識 → 自動翻訳

---

## 🔧 最近の改善

- ✅ ストリーミング中断時の状態管理を強化（runIdによる遅延更新防止）
- ✅ クイック/メインウィンドウ間のハンドオーバー処理を最適化
- ✅ Groq/Cerebrasプロバイダーのストリーミング対応
- ✅ 技術指標の表示をコンパクト化（2行表示）
- ✅ お気に入りボタンのアニメーション追加

詳細は [handover_fix_notes.md](handover_fix_notes.md) を参照してください。

---

## � ビルド・配布

各プラットフォーム向けのインストーラーをビルドする方法は [BUILD.md](BUILD.md) を参照してください。

- macOS: ユニバーサルバイナリ（Intel + Apple Silicon）
- Windows: x64 / ARM64
- Linux: 実験的サポート

---

## �📄 ライセンス

MIT License

---

## 🤝 コントリビューション

Issue や Pull Request をお待ちしています！

---

**Made with ❤️ and AI**

