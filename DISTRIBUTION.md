# macOSでの配布・署名ガイド

現在の「開発ビルド」や「署名なしビルド」は、自分のPCで使う分には問題ありませんが、他人に配布したり、アップデートを重ねたりする場合には不向きです。
特に、**画面収録**や**アクセシビリティ**の権限は、アプリの「署名」が変わるとリセットされてしまうため、正式な署名を行うことで安定して動作するようになります。

## 1. 必要なもの

- **Apple Developer Program への登録** (年間 $99)
  - これがないと、macOSアプリとして正式に署名・公証ができません。
- **Xcode** (App Storeからインストール)

## 2. 証明書の作成

1. Apple Developer サイトの [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list) にアクセスします。
2. **Developer ID Application** 証明書を作成し、ダウンロードしてキーチェーンにインストールします。

## 3. 環境変数の設定

ビルド時に以下の環境変数を設定すると、Tauriが自動的に署名と公証を行います。

- `APPLE_SIGNING_IDENTITY`: キーチェーンにある証明書の名前 (例: `Developer ID Application: Your Name (XXXXXXXXXX)`)
- `APPLE_ID`: Apple ID のメールアドレス
- `APPLE_PASSWORD`: アプリ用パスワード (Apple IDのパスワードそのものではなく、[appleid.apple.com](https://appleid.apple.com) で発行したもの)
- `APPLE_TEAM_ID`: チームID (Developer Portalで見れます)

## 4. ビルド設定

`src-tauri/tauri.conf.json` は現在のままで概ねOKですが、`bundle.macOS.entitlements` が正しく設定されていることを確認済みです。

## 5. ビルドコマンド

環境変数をセットした状態でビルドします。

```bash
# 証明書IDなどを確認
security find-identity -v -p codesigning

# ビルド実行 (公証まで行う場合)
export APPLE_SIGNING_IDENTITY="Developer ID Application: ..."
export APPLE_ID="..."
export APPLE_PASSWORD="..."
export APPLE_TEAM_ID="..."

yarn tauri build
```

## 6. 配布

ビルドが完了すると、`.dmg` ファイルや `.app` ファイルが生成されます。
正しく署名・公証されたアプリは：
- 初回起動時に「悪質なソフトウェアかどうかをAppleがチェックしました」という安心なメッセージが出ます。
- **権限設定 (TCC) が維持されます**。同名のアプリを上書きアップデートしても、一度許可した画面収録権限などはそのまま引き継がれます。

### 署名なしで配布する場合の注意点 (非推奨)

署名なしで友人などに `.app` を渡すと：
1. 「開発元が未確認のため開けません」とエラーが出ます。
2. 右クリック → 「開く」で強制的に開く必要があります。
3. アップデートのたびに権限がリセットされ、また「システム設定で削除して追加」の手順が必要になることが多いです。

本格的に配布するなら、Apple Developer Program への参加を強くおすすめします。
