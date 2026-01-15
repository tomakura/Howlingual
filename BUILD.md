# 📦 Howlingual ビルドガイド

このドキュメントでは、Howlingualの各プラットフォーム向けインストーラーをビルドする方法を説明します。

---

## 🍎 macOS

### 必要な環境
- macOS 10.13以上
- Xcode Command Line Tools
- Rust (最新安定版)
- Node.js 18以上

### ビルド手順

#### 1. ユニバーサルバイナリ（Intel + Apple Silicon）

```bash
# Rustターゲットの追加（初回のみ）
rustup target add aarch64-apple-darwin x86_64-apple-darwin

# ビルド実行
npm run tauri:build:mac
```

#### 2. 特定のアーキテクチャのみ

**Intel (x86_64) のみ:**
```bash
npm run tauri build --target x86_64-apple-darwin
```

**Apple Silicon (ARM64) のみ:**
```bash
npm run tauri build --target aarch64-apple-darwin
```

### 成果物

ビルドが完了すると、以下のファイルが生成されます：

```
src-tauri/target/universal-apple-darwin/release/
├── bundle/
│   ├── dmg/
│   │   └── Howlingual_0.1.0_universal.dmg  # インストーラー
│   └── macos/
│       └── Howlingual.app                   # アプリケーションバンドル
```

### 配布

**DMGファイル**を配布することで、ユーザーはドラッグ&ドロップでインストールできます。

---

## 🪟 Windows

### 必要な環境
- Windows 10/11
- Visual Studio 2022（C++開発ツール付き）
- Rust (最新安定版)
- Node.js 18以上
- WiX Toolset 3.11以上（MSIインストーラー用）
- NSIS 3.x（NSISインストーラー用、推奨）

### 環境セットアップ

#### 1. Visual Studio C++ Build Tools

```powershell
# Visual Studio Installerから以下をインストール：
# - Desktop development with C++
# - Windows 10 SDK
```

#### 2. WiX Toolset（オプション）

[WiX Toolset](https://wixtoolset.org/releases/)からインストール

#### 3. NSIS（推奨）

[NSIS](https://nsis.sourceforge.io/Download)からインストール

### ビルド手順

#### Windows x64

```powershell
# Rustターゲットの追加（初回のみ）
rustup target add x86_64-pc-windows-msvc

# ビルド実行
npm run tauri:build:win
```

#### Windows ARM64

```powershell
# Rustターゲットの追加（初回のみ）
rustup target add aarch64-pc-windows-msvc

# ビルド実行
npm run tauri:build:win-arm
```

### 成果物

ビルドが完了すると、以下のファイルが生成されます：

```
src-tauri/target/x86_64-pc-windows-msvc/release/
├── bundle/
│   ├── nsis/
│   │   └── Howlingual_0.1.0_x64-setup.exe   # NSISインストーラー（推奨）
│   └── msi/
│       └── Howlingual_0.1.0_x64_en-US.msi   # MSIインストーラー
```

### 配布

**NSISセットアップ実行ファイル** (.exe) を配布することを推奨します。  
ユーザーフレンドリーで、アンインストーラーも自動生成されます。

---

## 🐧 Linux（参考）

Linuxビルドは現在公式サポート対象外ですが、以下の手順で試すことができます：

```bash
# 依存パッケージのインストール（Ubuntu/Debian）
sudo apt-get update
sudo apt-get install -y \
    libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev

# ビルド
npm run tauri build
```

---

## 🔧 トラブルシューティング

### ビルドエラー: "failed to bundle project"

- **Windows**: Visual StudioのC++ツールとWindows SDKが正しくインストールされているか確認
- **macOS**: Xcode Command Line Toolsが最新か確認: `xcode-select --install`

### ONNX関連のエラー

OCRモデルファイル（`.onnx`）が`src-tauri/resources/`に存在することを確認してください。

### 署名とノータリゼーション（macOS）

本番配布には、Apple Developer IDでの署名とノータリゼーション（公証）が必要です：

```bash
# 環境変数を設定
export APPLE_CERTIFICATE=<base64-encoded-certificate>
export APPLE_CERTIFICATE_PASSWORD=<password>
export APPLE_SIGNING_IDENTITY=<identity-name>
export APPLE_ID=<your-apple-id>
export APPLE_PASSWORD=<app-specific-password>
export APPLE_TEAM_ID=<team-id>

# ビルド
npm run tauri:build:mac
```

詳細は[Tauri公式ドキュメント](https://tauri.app/v2/guides/distribution/)を参照してください。

---

## 📝 ビルドスクリプト

現在、以下のビルドスクリプトが`package.json`に定義されています：

```json
{
  "tauri:build": "tauri build",
  "tauri:build:mac": "tauri build --target universal-apple-darwin",
  "tauri:build:win": "tauri build --target x86_64-pc-windows-msvc",
  "tauri:build:win-arm": "tauri build --target aarch64-pc-windows-msvc"
}
```

---

## 🚀 CI/CDでの自動ビルド

GitHub Actionsを使用して、各プラットフォーム向けのビルドを自動化できます。  
`.github/workflows/`ディレクトリに設定ファイルを追加することで実装可能です。

参考: [Tauri GitHub Actions](https://github.com/tauri-apps/tauri-action)

---

**Happy Building! 🎉**
