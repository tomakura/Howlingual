```markdown
# Howlingual macOS自己署名証明書設定（Developer Program不要）

## 目的
- バージョンアップしても権限（画面収録・アクセシビリティ）が維持されるようにする
- adhoc署名の問題（ビルドの度にハッシュが変わる）を解決
- 無料で実現

---

## 1. 自己署名証明書の作成（手動作業）

### macOSキーチェーンアクセスで作成
1. **キーチェーンアクセス.app** を開く
2. メニュー：**キーチェーンアクセス > 証明書アシスタント > 証明書を作成...**
3. 設定：
   - 名前: `Howlingual Developer`
   - 識別情報のタイプ: **自己署名ルート**
   - 証明書のタイプ: **コード署名**
   - 「デフォルトを無効化」はチェックしない
4. 作成ボタンをクリック

---

## 2. ファイル作成・変更

### 📄 `src-tauri/entitlements.plist` （新規作成）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Hardened Runtime -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    
    <!-- アクセシビリティ・AppleEvents -->
    <key>com.apple.security.automation.apple-events</key>
    <true/>
    
    <!-- ネットワーク（API通信用） -->
    <key>com.apple.security.network.client</key>
    <true/>
</dict>
</plist>
```

---

### 📄 `src-tauri/tauri.conf.json` （変更）

`bundle.macOS` セクションに以下を追加：

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Howlingual Developer",
      "entitlements": "entitlements.plist"
    }
  }
}
```

**既存の `bundle.macOS` がある場合は追加、ない場合は新規作成**

---

### 📄 `src-tauri/src/lib.rs` （変更）

#### 1) 新しいコマンドを追加（ファイル末尾の `pub fn run()` より前に追加）

```rust
#[tauri::command]
async fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}

#[tauri::command]
async fn open_screen_recording_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn();
    }
}
```

#### 2) `invoke_handler` に追加（既存の `tauri::generate_handler!` 内に追加）

既存のこの部分：
```rust
.invoke_handler(tauri::generate_handler![
    greet,
    update_shortcut,
    open_main_window,
    get_pending_text,
    get_handover_text,
    update_pending_text,
    replace_selection,
    quit_app,
    handover_to_main,
    start_selection_ocr,
    finish_selection_ocr,
    cancel_selection_ocr,
    complete_ocr_flow,
    set_ocr_engine,
    check_permissions,
    request_permissions
])
```

↓ 以下の2つを追加：

```rust
.invoke_handler(tauri::generate_handler![
    greet,
    update_shortcut,
    open_main_window,
    get_pending_text,
    get_handover_text,
    update_pending_text,
    replace_selection,
    quit_app,
    handover_to_main,
    start_selection_ocr,
    finish_selection_ocr,
    cancel_selection_ocr,
    complete_ocr_flow,
    set_ocr_engine,
    check_permissions,
    request_permissions,
    open_accessibility_settings,
    open_screen_recording_settings
])
```

---

### 📄 フロントエンド（Svelte）権限導線改善（オプション）

`src/routes/+page.svelte` の権限セクション（既存の「許可する」ボタンの隣）に追加：

#### アクセシビリティ部分

既存：
```svelte
{#if !permissions.accessibility}
  <button
    onclick={() => requestPermission("accessibility")}
    class="permission-btn"
  >
    {t(appLanguage, "grant")}
  </button>
{/if}
```

↓ 追加：

```svelte
{#if !permissions.accessibility}
  <button
    onclick={() => requestPermission("accessibility")}
    class="permission-btn"
  >
    {t(appLanguage, "grant")}
  </button>
  <button
    onclick={async () => {
      await invoke("open_accessibility_settings");
    }}
    class="permission-btn"
    style="margin-left: 8px;"
  >
    設定を開く
  </button>
{/if}
```

#### 画面収録部分

既存：
```svelte
{#if !permissions.screen_recording}
  <button
    onclick={() => requestPermission("screen_recording")}
    class="permission-btn"
  >
    {t(appLanguage, "grant")}
  </button>
{/if}
```

↓ 追加：

```svelte
{#if !permissions.screen_recording}
  <button
    onclick={() => requestPermission("screen_recording")}
    class="permission-btn"
  >
    {t(appLanguage, "grant")}
  </button>
  <button
    onclick={async () => {
      await invoke("open_screen_recording_settings");
    }}
    class="permission-btn"
    style="margin-left: 8px;"
  >
    設定を開く
  </button>
{/if}
```

#### `invoke` のインポート追加（ファイル上部）

既存のインポートセクションに追加：
```typescript
import { invoke } from "@tauri-apps/api/core";
```

---

## 3. ビルドと確認

```bash
# ビルド
yarn tauri build

# 署名確認
codesign -dv --verbose=4 src-tauri/target/release/bundle/macos/Howlingual.app

# "Authority=Howlingual Developer" が出ればOK
```

---

## 4. 配布時のREADME追記

```markdown
### macOSで初回起動時の注意

自己署名版のため、初回起動時に警告が出ます：

1. Howlingual.app を **右クリック** → 「開く」
2. 警告が出たら「開く」をクリック
3. 次回以降は通常通りダブルクリックで起動できます

権限設定：
- 画面収録: システム設定 > プライバシーとセキュリティ > 画面収録
- アクセシビリティ: システム設定 > プライバシーとセキュリティ > アクセシビリティ
```

---