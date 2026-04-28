<script lang="ts">
  import { tick, onMount, onDestroy, untrack } from "svelte";
  import { fade, scale, fly, crossfade } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";
  import { invoke } from "@tauri-apps/api/core";
  import { getVersion } from "@tauri-apps/api/app";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen, emit } from "@tauri-apps/api/event";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import {
    enable as enableAutostart,
    disable as disableAutostart,
    isEnabled as isAutostartEnabled,
  } from "@tauri-apps/plugin-autostart";
  import {
    translateTextStream,
    type AiModel,
    type AiResponse,
    type UsageMetadata,
  } from "$lib/ai_service";
  import {
    AI_MODELS,
    DEFAULT_MODELS_BY_PROVIDER,
    type AiProvider,
    getDefaultModelForProvider,
    getModelEntry,
    getProviderForModel,
    isAiProvider,
  } from "$lib/ai_models";
  import CaptureOverlay from "$lib/components/CaptureOverlay.svelte";
  import {
    t,
    getLanguageName,
    getStyleName,
    getTargetLanguageName,
    type AppLanguage,
  } from "$lib/i18n";
  import { getDefaultStyles } from "$lib/style_defaults";

  // ====== Animations ======
  const [send, receive] = crossfade({
    duration: 300,
    fallback: (node, params) => scale(node, { ...params, duration: 250 }),
  });

  // ====== Settings State ======
  let showSettings = $state(false);
  let settingsTab = $state<
    "appearance" | "translation" | "system" | "api" | "styles" | "about"
  >("appearance");
  let appVersion = $state("1.3.0");
  let selectedModel = $state<AiModel>(
    DEFAULT_MODELS_BY_PROVIDER.openai as AiModel,
  );
  let apiKeys = $state({
    gemini: "",
    openai: "",
    anthropic: "",
    groq: "",
    cerebras: "",
  });
  let rememberApiKeys = $state(true);
  let defaultTargetLang = $state("日本語");
  let theme = $state<"dark" | "light">("dark");
  let appLanguage = $state<"ja" | "en" | "zh" | "ko">("ja");
  let translationCount = $state<1 | 2 | 3>(3); // 翻訳案の個数（1〜3）
  let allowRewrite = $state(false);
  let selectedProvider = $state<AiProvider>("openai");
  // プロバイダごとの最後に選択したモデルを記憶
  let lastSelectedModels = $state<Record<string, string>>({
    ...DEFAULT_MODELS_BY_PROVIDER,
  });
  // Initialize mode synchronously from URL to prevent flash of wrong UI
  const initialParams = new URLSearchParams(window.location.search);
  const initialView = initialParams.get("view");
  let isCompactMode = $state(initialView === "compact");
  let isCaptureMode = $state(initialView === "capture");
  let isStackExpanded = $state(false); // Controls card stack in compact mode
  const DEFAULT_SHORTCUT = "CommandOrControl+Shift+H";
  let quickShortcut = $state(DEFAULT_SHORTCUT);
  let shortcutDraft = $state(DEFAULT_SHORTCUT);
  let shortcutError = $state("");
  let shortcutSaving = $state(false);
  let autoRunQuick = $state(true); // Auto-run setting - default ON for backward compatibility
  let autoStartEnabled = $state(false);
  let startMinimized = $state(false);
  let ocrEngine = $state<"paddle" | "windows">("paddle");
  let clipboardOpsEnabled = $state(false);

  let historyAnimating = $state(false);
  let historyAnimTimer: ReturnType<typeof setTimeout> | null = null;
  function triggerHistoryAnim() {
    // 既存のタイマーをクリアして即座に再開可能に
    if (historyAnimTimer) clearTimeout(historyAnimTimer);
    historyAnimating = true;
    historyAnimTimer = setTimeout(() => (historyAnimating = false), 400);
  }

  // ====== Window Fade Animation ======
  let isWindowVisible = $state(false);
  let isWindows = $state(false);
  let isMac = $state(false);
  let isLinux = $state(false);
  let ttsAvailable = $state(false);

  async function toggleAutoStart() {
    const next = !autoStartEnabled;
    try {
      if (next) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      autoStartEnabled = next;
    } catch (e) {
      console.warn("Failed to update autostart", e);
    }
  }

  async function hideWindow() {
    isWindowVisible = false;
    setTimeout(async () => {
      await getCurrentWindow().hide();
    }, 250); // Match CSS transition duration
  }

  onMount(() => {
    let unlistenShown: () => void;
    let unlistenFocus: () => void;

    (async () => {
      // Detect OS
      if (typeof navigator !== "undefined") {
        isWindows = navigator.userAgent.includes("Windows");
        isMac = navigator.userAgent.includes("Mac");
        isLinux =
          navigator.userAgent.includes("Linux") &&
          !navigator.userAgent.includes("Android");
      }
      if (typeof window !== "undefined") {
        ttsAvailable =
          "speechSynthesis" in window &&
          typeof SpeechSynthesisUtterance !== "undefined";
      }

      // Listen for window_shown event from Rust
      unlistenShown = await listen("window_shown", () => {
        console.log("[window] window_shown event received");
        // Slight delay to ensure opacity:0 is applied first
        setTimeout(() => {
          isWindowVisible = true;
        }, 50);
      });

      // Fallback: Show on focus if not visible
      const win = getCurrentWindow();
      
      // If window already has focus or is visible, make sure isWindowVisible is true
      const focused = await win.isFocused();
      const visible = await win.isVisible();
      if (focused || visible) {
        console.log("[window] Already focused or visible on mount");
        isWindowVisible = true;
      }

      unlistenFocus = await win.listen("tauri://focus", () => {
        console.log("[window] tauri://focus event received");
        // If we get focus, make sure we are visible
        if (!isWindowVisible) {
          requestAnimationFrame(() => {
            isWindowVisible = true;
          });
        }
      });
    })();

    return () => {
      if (unlistenShown) unlistenShown();
      if (unlistenFocus) unlistenFocus();
    };
  });

  onMount(() => {
    getVersion()
      .then((version) => {
        appVersion = version;
      })
      .catch((err) => {
        console.warn("Failed to read app version", err);
      });
  });

  function detectLanguageSimple(text: string) {
    // ひらがな・カタカナがあれば確実に日本語
    const hasHiraganaKatakana = /[\u3040-\u30ff]/.test(text);
    if (hasHiraganaKatakana) return "日本語";

    // ハングルが含まれていれば韓国語
    const hasHangul = /[\uac00-\ud7af]/.test(text);
    if (hasHangul) return "韓国語";

    // 漢字のみの場合は句読点等で判定
    const hasKanji = /[\u4e00-\u9faf]/.test(text);
    if (hasKanji) {
      const hasJapanesePunct = /[「」『』。、・《》]/.test(text);
      if (hasJapanesePunct) return "日本語";
      return "中国語";
    }

    return "英語";
  }

  // Custom Styles
  type CustomStyle = {
    id: string;
    name: string;
    prompt: string;
    isDefault?: boolean;
  };

  let customStyles = $state<CustomStyle[]>(getDefaultStyles("ja"));
  let editingStyle = $state<CustomStyle | null>(null);
  let showResetConfirmation = $state(false);
  let showDiscardConfirmation = $state(false);

  let styleOverflowOpen = $state(false);

  let styleContainerRef = $state<HTMLElement>();
  let visibleStyleCount = $state(4);

  // Sort styles: Active first, then original order -> DISABLED by user request
  // Now we just use customStyles order (User can reorder manually)
  let sortedStyles = $derived(customStyles);

  let visibleStyles = $derived(sortedStyles.slice(0, visibleStyleCount));
  let hiddenStyles = $derived(sortedStyles.slice(visibleStyleCount));
  let hasActiveHiddenStyles = $derived(
    hiddenStyles.some((s) => (styleLevels[s.id] || 0) > 0),
  );

  // Responsive style count
  $effect(() => {
    if (styleContainerRef) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const totalWidth = entry.contentRect.width;
          const itemWidth = 80; // 閾値調整: 1個分多く表示
          const buttonWidth = 50;

          const maxIfNoButton = Math.floor(totalWidth / itemWidth);

          if (customStyles.length <= maxIfNoButton) {
            visibleStyleCount = customStyles.length;
          } else {
            const available = totalWidth - buttonWidth;
            const maxIfButton = Math.floor(available / itemWidth);
            visibleStyleCount = Math.max(1, maxIfButton);
          }
        }
      });
      resizeObserver.observe(styleContainerRef);
      return () => resizeObserver.disconnect();
    }
  });

  // Update default styles when language changes
  $effect(() => {
    const defaults = getDefaultStyles(appLanguage);
    // Use untrack to prevent circular updates if we modify customStyles
    // actually we want to react to appLanguage.
    // We need to be careful not to create a loop if customStyles triggers something else.

    // We only want to update *default* styles names/prompts to match the new language
    // UNLESS the user has customized them?
    // The requirement says "default existing styles should be in the language matching the language settings".
    // This implies we simply swap the translation.

    const updatedStyles = customStyles.map((s) => {
      if (s.isDefault) {
        const def = defaults.find((d) => d.id === s.id);
        if (def) {
          return { ...s, name: def.name, prompt: def.prompt };
        }
      }
      return s;
    });

    // Only update if changed prevents loops
    if (JSON.stringify(updatedStyles) !== JSON.stringify(customStyles)) {
      customStyles = updatedStyles;
    }
  });

  let availableModels = $state([...AI_MODELS]);

  let filteredModels = $derived(
    availableModels.filter((m) => m.provider === selectedProvider),
  );


  async function detectWindowMode() {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    if (viewParam === "compact") {
      isCompactMode = true;
      isCaptureMode = false;
      // If we are starting in compact mode, we should likely be visible
      // (e.g. triggered by shortcut during app startup)
      isWindowVisible = true;
      await tick();
      autoResize();
      return;
    }
    if (viewParam === "main") {
      isCompactMode = false;
      isCaptureMode = false;
      await tick();
      autoResize();
      return;
    }
    if (viewParam === "capture") {
      isCaptureMode = true;
      isCompactMode = false;
      return;
    }

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      isCompactMode = getCurrentWindow().label === "compact";
      await tick();
      autoResize();
      return;
    } catch (error) {
      console.warn("Window mode detection failed:", error);
    }
  }

  let isOpeningMain = $state(false);
  let isWaitingForOCR = $state(false);

  // Load settings on mount
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");

    void detectWindowMode();
    const saved = localStorage.getItem("howlingual_settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        applySettingsFromParsed(parsed);
      } catch (e) {
        console.warn("Failed to parse saved settings", e);
      }
    }

    // Load separated custom styles if available
    const savedStyles = localStorage.getItem("howlingual_custom_styles");
    if (savedStyles) {
      try {
        const parsedStyles = JSON.parse(savedStyles);
        if (Array.isArray(parsedStyles)) {
          console.log(
            "[Settings] Loaded active custom styles from separate storage",
          );
          customStyles = parsedStyles;
        }
      } catch (e) {
        console.warn("Failed to parse saved custom styles", e);
      }
    }

    // Load style levels (文体の強弱設定)
    const savedStyleLevels = localStorage.getItem("howlingual_style_levels");
    if (savedStyleLevels) {
      try {
        const parsedLevels = JSON.parse(savedStyleLevels);
        if (typeof parsedLevels === "object" && parsedLevels !== null) {
          styleLevels = normalizeStyleLevels(parsedLevels, customStyles);
          console.log(
            "[Settings] Loaded style levels from storage",
            styleLevels,
          );
        }
      } catch (e) {
        console.warn("Failed to parse saved style levels", e);
      }
    }
    // Mark style levels as ready to be saved thereafter
    styleLevelsReady = true;

    // Flush styleLevels on window close to avoid loss if debounce hasn't fired
    handleBeforeUnloadRef = () => {
      if (styleLevelsReady) {
        persistStyleLevels();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnloadRef);

    // Ensure shortcut is OS-specific for display
    const isMac = navigator.userAgent.includes("Mac");
    quickShortcut = quickShortcut.replace(
      "CommandOrControl",
      isMac ? "Command" : "Ctrl",
    );

    shortcutDraft = quickShortcut;
    void syncShortcut();

    (async () => {
      try {
        autoStartEnabled = await isAutostartEnabled();
      } catch (e) {
        console.warn("Failed to read autostart state", e);
      }

      // Check permissions on macOS
      if (isMac) {
        await checkPermissions();
      }
    })();

    // Handle startup visibility
    if (viewParam === "main") {
      (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const window = getCurrentWindow();
          if (!startMinimized) {
            await window.show();
            await window.setFocus();
            // Force visible state if we are intentionally showing main
            isWindowVisible = true;
          }
        } catch (e) {
          console.warn("Failed to handle startup visibility", e);
        }
      })();
    }
    // Quick Mode Reset on Focus
    if (viewParam === "compact") {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        win.listen("tauri://focus", async () => {
          // Disabled auto-reset on focus as per user feedback ("annoying")
          // and to prevent race condition with text_captured event which focuses window
          /*
          if (!isTranslating && !isWaitingForOCR && !isOpeningMain) {
            console.log("[QuickMode] Focus detected, resetting state.");
            inputQuery = "";
            translations = translations.map((t) => ({
              ...t,
              text: "",
              reason: "",
            }));
            await emit("sync_input_command", {
              text: "",
              resetTranslations: true,
            });
          }
          */
        });
      });
    }

    settingsReady = true;
  });

  // Service Integration
  onMount(() => {
    let unlisten: () => void;
    (async () => {
      // Sync state on load
      console.log("[UI] Requesting Sync State...");
      await emit("request_sync_state");

      unlisten = await listen<any>("translation_update", (event) => {
        const p = event.payload;

        // --- ECHO GUARD ---
        // Ignore updates for old input text to prevent "jumpy" UI when typing fast.
        // During active detection or translation, the service might echo old states.
        if (p.inputQuery !== undefined && p.inputQuery !== inputQuery) {
          // If this window is focused/typing, ignore stale echoes unless real translation is flowing.
          const hasResults =
            Array.isArray(p.translations) &&
            p.translations.some((t: any) => t?.text);
          if (textareaEl && document.activeElement === textareaEl) {
            if (!p.isTranslating && !hasResults) {
              return;
            }
          }
        }

        // Detect completion for History Saving
        if (isTranslating && !p.isTranslating) {
          // Translation just finished
          if (
            p.translations &&
            p.translations.length > 0 &&
            p.translations.some((t: any) => t.text)
          ) {
            const newEntry: HistoryItem = {
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              sourceText: p.inputQuery || inputQuery,
              sourceLang: p.detectedLang || p.sourceLang || sourceLang,
              targetLang: p.targetLang || targetLang,
              isAutoDetect: isAutoDetect,
              detectedLang: p.detectedLang || detectedLang || "",
              translations: p.translations.map((t: any) => ({
                text: t.text,
                reason: t.reason,
              })),
              detailedExplanation: p.detailedExplanation
                ? $state.snapshot(p.detailedExplanation)
                : null,
              styleLevels: p.styleLevels ? $state.snapshot(p.styleLevels) : {},
            };
            history = [newEntry, ...history].slice(0, 50);
            localStorage.setItem("howlingual_history", JSON.stringify(history));

            persistLastResult(); // Helper function

            const usageTokens = Math.max(
              0,
              (p.techMetrics?.inputTokens ?? 0) +
                (p.techMetrics?.outputTokens ?? 0),
            );
            recordUsage(1, usageTokens);
          }
          lastTranslatedText = p.inputQuery || inputQuery;
        }

        isTranslating = p.isTranslating;
        if (!p.isTranslating) {
          // Only stop detecting if we're not in the manual threshold-waiting state
          if (
            !isAutoDetect ||
            inputQuery.trim().length >= 5 ||
            !inputQuery.trim()
          ) {
            isDetecting = false;
          }
        }
        translations = p.translations; // Direct sync

        if ("detailedExplanation" in p) {
          detailedExplanation = p.detailedExplanation || null;
          showExplanation = Boolean(p.detailedExplanation);
        } else if (p.isTranslating) {
          detailedExplanation = null;
          showExplanation = false;
        }
        if ("errorMessage" in p) {
          errorMessage = p.errorMessage || "";
        }
        if (p.inputQuery && p.inputQuery !== inputQuery) {
          inputQuery = p.inputQuery;
        }

        // Sync Language Settings
        // Only accept updates if we have enough text to trust the backend (or if manual)
        // This prevents "flash" updates where backend sees 1 char and says "English"
        if (!isAutoDetect || inputQuery.trim().length >= 5) {
          if (p.sourceLang) {
            if (isAutoDetect && p.sourceLang !== AUTO_DETECT_LABEL) {
              const incoming = p.detectedLang || p.sourceLang;
              const localDetect = detectLanguageSimple(inputQuery);
              detectedLang = localDetect === "日本語" ? "日本語" : incoming;
              isDetecting = false;
            } else {
              applySourceLangFromSync(p.sourceLang, p.detectedLang);
            }
          } else if (p.detectedLang && isAutoDetect) {
            const localDetect = detectLanguageSimple(inputQuery);
            detectedLang = localDetect === "日本語" ? "日本語" : p.detectedLang;
            isDetecting = false;
          }
        }

        if (p.targetLang) {
          targetLang = p.targetLang;
        }

        // Sync Metrics
        if (p.techMetrics) {
          syncTechMetrics(p.techMetrics);
        }

        // Auto-resize if needed
        void tick().then(autoResize);
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  });

  // Poll for pending text when window gets focus (for compact mode)
  onMount(() => {
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let hasReceivedText = false;
    let checkCount = 0;
    let pollStart = Date.now();
    const POLL_INTERVAL_MS = 100;

    async function checkPendingText(): Promise<boolean> {
      // Don't consume pending text if we are navigating to main window
      if (isOpeningMain) return false;

      try {
        let text: string | null = null;
        if (isCompactMode) {
          text = await invoke<string | null>("get_pending_text");
        } else {
          // Main Window checks dedicated handover text
          text = await invoke<string | null>("get_handover_text");
        }
        if (text && text.trim()) {
          console.log("[pending-text] Received:", text.length, "chars");
          hasReceivedText = true;

          // Use applyQuickText for compact mode, full handover for main mode
          syncShowTechInfoFromStorage();
          if (isCompactMode) {
            await applyQuickText(text);
          } else {
            await handleHandover(text);
          }

          return true;
        } else {
          // If no text after first check, clear the UI for fresh start
          checkCount++;
          if (checkCount === 1 && !hasReceivedText && isCompactMode) {
            // First check returned null - this is a fresh open without selection
            // Clear previous results but keep input if user typed something
            translations = [];
            detailedExplanation = null;
            showExplanation = false;
            isTranslating = false;
            errorMessage = "";
            resetTechMetrics();
            autoScrollEnabled = true;
          }
        }
      } catch (error) {
        // Ignore errors (command may not exist in web mode)
      }
      return false;
    }

    const scheduleNextPoll = () => {
      if (!isCompactMode) return;
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
      pollTimeoutId = setTimeout(async () => {
        if (Date.now() - pollStart > 3000) return;
        const got = await checkPendingText();
        if (!got) {
          scheduleNextPoll();
        }
      }, POLL_INTERVAL_MS);
    };

    // Check immediately (Run once for BOTH modes to catch handover/initial data)
    pollStart = Date.now();
    void checkPendingText().then((got) => {
      if (isCompactMode && !got) {
        scheduleNextPoll();
      }
    });

    // Note: We don't need a focus handler for compact mode
    // The text_captured event already handles window opening/text updates

    // Listen for text_captured event from backend
    console.log("[Listener] Registering text_captured listener");
    const unlistenPromise = listen<string>("text_captured", async (event) => {
      console.log(
        "[event] text_captured handler called, payload length:",
        event.payload.length,
      );

      // Only process if we initiated the OCR
      // Process if we are waiting for OCR OR if we are in compact mode (shortcut trigger)
      if (!isWaitingForOCR && !isCompactMode) {
        console.log(
          "[event] Ignoring - neither waiting for OCR nor Compact Mode",
        );
        return;
      }

      console.log(
        "[event] text_captured processing:",
        event.payload.length,
        "chars",
      );

      // Ensure window is visible and focused
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        await currentWindow.show();
        await currentWindow.setFocus();
      } catch (e) {
        console.warn("Failed to show window", e);
      }

      hasReceivedText = true;
      isOpeningMain = false; // Reset flag so we can capture again
      isWaitingForOCR = false; // Reset waiting flag

      // Force UI update with new text
      syncShowTechInfoFromStorage();
      void applyQuickText(event.payload);
    });

    // Listen for handover_data event (Main Window only)
    const unlistenHandoverPromise = listen<string>("handover_data", (event) => {
      if (isCompactMode) return; // Should not happen but safety check

      console.log(
        "[event] handover_data received:",
        event.payload.length,
        "chars",
      );

      void handleHandover(event.payload);
    });

    return async () => {
      if (pollTimeoutId) clearTimeout(pollTimeoutId);
      const unlisten = await unlistenPromise;
      unlisten();
      const unlistenHandover = await unlistenHandoverPromise;
      unlistenHandover();

      // Clean up storage listener
      window.removeEventListener("storage", handleStorageChange);
    };
  });

  // Storage listener for syncing history across windows
  function handleStorageChange(event: StorageEvent) {
    if (event.key === "howlingual_history") {
      try {
        const newValue = event.newValue ? JSON.parse(event.newValue) : [];
        // Only update if different to avoid redundant renders?
        // Simple assignment is safer for sync.
        history = newValue;
        console.log("[Sync] History updated from storage event");
      } catch (e) {
        console.warn("Failed to sync history", e);
      }
    } else if (event.key === "howlingual_settings") {
      if (!event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        applySettingsFromParsed(parsed);
        if (parsed.quickShortcut) {
          const isMac = navigator.userAgent.includes("Mac");
          quickShortcut = parsed.quickShortcut.replace(
            "CommandOrControl",
            isMac ? "Command" : "Ctrl",
          );
          shortcutDraft = quickShortcut;
        }
        console.log("[Sync] Settings updated from storage event");
      } catch (e) {
        console.warn("Failed to sync settings", e);
      }
    } else if (event.key === "howlingual_favorites") {
      try {
        favorites = event.newValue ? JSON.parse(event.newValue) : [];
        console.log("[Sync] Favorites updated from storage event");
      } catch (e) {
        console.warn("Failed to sync favorites", e);
      }
    } else if (event.key === "howlingual_showTechInfo") {
      showTechInfo = event.newValue === "true";
      console.log("[Sync] showTechInfo updated:", showTechInfo);
    }
  }

  // Add storage listener
  onMount(() => {
    window.addEventListener("storage", handleStorageChange);
  });

  onMount(() => {
    refreshUsageStats();
  });

  // Auto-save settings when changed
  $effect(() => {
    if (!settingsReady) return;
    const sanitizedApiKeys = rememberApiKeys
      ? apiKeys
      : {
          gemini: "",
          openai: "",
          anthropic: "",
          groq: "",
          cerebras: "",
        };
    const settings = {
      model: selectedModel,
      provider: selectedProvider,
      apiKeys: sanitizedApiKeys,
      defaultTargetLang: defaultTargetLang,
      theme: theme,
      appLanguage: appLanguage,
      // customStyles: customStyles, // Removed from general settings, saved separately
      allowRewrite: allowRewrite,
      rememberApiKeys: rememberApiKeys,
      quickShortcut: quickShortcut,
      autoRunQuick: autoRunQuick,
      autoStartEnabled: autoStartEnabled,
      startMinimized: startMinimized,
      lastSelectedModels: lastSelectedModels,
      translationCount: translationCount,
      clipboardOpsEnabled: clipboardOpsEnabled,
      ocrEngine: ocrEngine,
    };
    localStorage.setItem("howlingual_settings", JSON.stringify(settings));

    // Apply theme immediately
    document.documentElement.setAttribute("data-theme", theme);

    // Sync OCR Engine to Backend (Windows only)
    if (isWindows) {
      invoke("set_ocr_engine", { engine: ocrEngine }).catch((e) =>
        console.warn("Failed to set OCR engine", e),
      );
    }

    // console.log("[Settings] Auto-saved");
  });

  $effect(() => {
    if (!settingsReady) return;
    invoke("set_clipboard_ops_enabled", { enabled: clipboardOpsEnabled }).catch(
      (e) => console.warn("Failed to set clipboard ops enabled", e),
    );
  });

  // Style levels: 0 = オフ, 1 = 弱, 2 = 強（IDベースで管理）
  const clampStyleLevel = (val: any) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return 0;
    if (n <= 0) return 0;
    if (n >= 2) return 2;
    return 1;
  };

  const normalizeStyleLevels = (
    raw: any,
    styles: CustomStyle[],
  ): Record<string, number> => {
    const result: Record<string, number> = {};
    const nameToId = new Map(styles.map((s) => [s.name, s.id]));
    styles.forEach((s) => {
      result[s.id] = 0;
    });

    if (raw && typeof raw === "object") {
      for (const [key, val] of Object.entries(raw)) {
        const level = clampStyleLevel(val);
        if (key in result) {
          result[key] = level;
          continue;
        }
        const id = nameToId.get(key);
        if (id && id in result) {
          result[id] = level;
        }
      }
    }
    return result;
  };

  let settingsReady = $state(false);

  function syncProviderAndModel(model?: string, provider?: string) {
    const entry = getModelEntry(model);
    if (entry) {
      selectedModel = entry.value as AiModel;
      selectedProvider = entry.provider;
      return;
    }

    if (model) {
      selectedModel = model as AiModel;
      const inferred =
        getProviderForModel(model) ||
        (provider && isAiProvider(provider) ? provider : null);
      if (inferred) {
        selectedProvider = inferred;
      }
      return;
    }

    if (provider && isAiProvider(provider)) {
      selectedProvider = provider;
      const fallback =
        lastSelectedModels[provider] ?? getDefaultModelForProvider(provider);
      if (fallback) {
        selectedModel = fallback as AiModel;
      }
    }
  }

  function ensureModelMatchesProvider() {
    const valid = availableModels.some(
      (m) => m.provider === selectedProvider && m.value === selectedModel,
    );
    if (!valid) {
      const fallback =
        lastSelectedModels[selectedProvider] ??
        getDefaultModelForProvider(selectedProvider);
      if (fallback) {
        selectedModel = fallback as AiModel;
      }
    }
  }

  function applySettingsFromParsed(parsed: any) {
    if (!parsed || typeof parsed !== "object") return;

    if (parsed.lastSelectedModels) {
      lastSelectedModels = {
        ...lastSelectedModels,
        ...parsed.lastSelectedModels,
      };
    }

    if (parsed.model || parsed.provider) {
      syncProviderAndModel(parsed.model, parsed.provider);
    } else {
      ensureModelMatchesProvider();
    }

    if (selectedProvider && selectedModel) {
      if (lastSelectedModels[selectedProvider] !== selectedModel) {
        lastSelectedModels = {
          ...lastSelectedModels,
          [selectedProvider]: selectedModel,
        };
      }
    }

    if (parsed.rememberApiKeys !== undefined)
      rememberApiKeys = parsed.rememberApiKeys;
    const shouldApplyKeys =
      parsed.rememberApiKeys !== undefined
        ? parsed.rememberApiKeys
        : rememberApiKeys;
    if (parsed.apiKeys && shouldApplyKeys) {
      apiKeys = { ...apiKeys, ...parsed.apiKeys };
    }
    if (parsed.defaultTargetLang)
      defaultTargetLang = parsed.defaultTargetLang;
    if (parsed.theme) theme = parsed.theme;
    if (parsed.appLanguage) appLanguage = parsed.appLanguage;
    if (parsed.allowRewrite !== undefined) allowRewrite = parsed.allowRewrite;
    if (parsed.quickShortcut) quickShortcut = parsed.quickShortcut;
    if (parsed.autoRunQuick !== undefined) autoRunQuick = parsed.autoRunQuick;
    if (parsed.autoStartEnabled !== undefined)
      autoStartEnabled = parsed.autoStartEnabled;
    if (parsed.startMinimized !== undefined)
      startMinimized = parsed.startMinimized;
    if (parsed.clipboardOpsEnabled !== undefined)
      clipboardOpsEnabled = parsed.clipboardOpsEnabled;
    if (parsed.ocrEngine) ocrEngine = parsed.ocrEngine;
    if (
      parsed.translationCount &&
      [1, 2, 3].includes(parsed.translationCount)
    )
      translationCount = parsed.translationCount;

    document.documentElement.setAttribute("data-theme", theme);
  }

  let styleLevels: Record<string, number> = $state(
    untrack(() => normalizeStyleLevels({}, customStyles)),
  );
  // Prevent initial auto-save from overwriting loaded values
  let styleLevelsReady = $state(false);
  let styleLevelsSaveTimer: number | null = null;
  let handleBeforeUnloadRef: (() => void) | null = null;
  const persistStyleLevels = () => {
    localStorage.setItem(
      "howlingual_style_levels",
      JSON.stringify(styleLevels),
    );
  };
  let compactStylesOpen = $state(false);
  let activeStyleCount = $derived(
    Object.values(styleLevels).filter((level) => level > 0).length,
  );

  // Sync styleLevels with customStyles (IDベースに正規化)
  $effect(() => {
    const currentLevels = untrack(() => styleLevels);
    styleLevels = normalizeStyleLevels(currentLevels, customStyles);
  });

  function triggerResetStyles() {
    showResetConfirmation = true;
  }

  function confirmResetStyles() {
    customStyles = getDefaultStyles(appLanguage);
    showResetConfirmation = false;
  }
  // Auto-save style levels whenever they change (after initial load)
  $effect(() => {
    // Access both readiness flag and levels to make effect reactive
    const ready = styleLevelsReady;
    const _levels = styleLevels;
    // Skip saving until initial onMount loading completes
    if (!ready) return;
    // Debounce writes to avoid excessive I/O
    if (styleLevelsSaveTimer !== null) {
      clearTimeout(styleLevelsSaveTimer);
      styleLevelsSaveTimer = null;
    }
    styleLevelsSaveTimer = window.setTimeout(() => {
      persistStyleLevels();
      console.log("[Settings] Auto-saved style levels");
      styleLevelsSaveTimer = null;
    }, 100);
    return () => {
      if (styleLevelsSaveTimer !== null) {
        clearTimeout(styleLevelsSaveTimer);
        styleLevelsSaveTimer = null;
      }
    };
  });

  function selectProvider(provider: AiProvider) {
    // 現在のモデルを現在のプロバイダに保存
    lastSelectedModels = {
      ...lastSelectedModels,
      [selectedProvider]: selectedModel,
    };

    selectedProvider = provider;

    // 保存されていたモデルを復元
    if (lastSelectedModels[provider]) {
      // 保存されたモデルがまだ利用可能か確認
      const savedModelExists = availableModels.some(
        (m) =>
          m.value === lastSelectedModels[provider] && m.provider === provider,
      );
      if (savedModelExists) {
        selectedModel = lastSelectedModels[provider] as AiModel;
        return;
      }
    }

    // フォールバック: プロバイダの最初のモデルを選択
    const fallback = getDefaultModelForProvider(provider);
    if (fallback) {
      selectedModel = fallback as AiModel;
    }
  }

  const PROVIDER_DOCS: { provider: AiProvider; label: string; url: string }[] =
    [
      {
        provider: "openai",
        label: "OpenAI",
        url: "https://platform.openai.com/docs/overview",
      },
      {
        provider: "gemini",
        label: "Gemini",
        url: "https://ai.google.dev/docs/gemini_api_overview",
      },
      {
        provider: "anthropic",
        label: "Anthropic",
        url: "https://platform.claude.com/docs/en/api/overview",
      },
      {
        provider: "groq",
        label: "Groq",
        url: "https://console.groq.com/docs",
      },
      {
        provider: "cerebras",
        label: "Cerebras",
        url: "https://inference-docs.cerebras.ai/",
      },
    ];

  function getProviderDoc(provider: AiProvider) {
    return PROVIDER_DOCS.find((doc) => doc.provider === provider) || null;
  }

  let selectedProviderDoc = $derived(getProviderDoc(selectedProvider));

  async function openProviderDocs(url: string) {
    try {
      await openUrl(url);
    } catch (error) {
      console.warn("Failed to open provider docs:", error);
      if (typeof window !== "undefined") {
        try {
          window.open(url, "_blank", "noopener");
        } catch {}
      }
    }
  }

  $effect(() => {
    const provider = selectedProvider;
    const model = selectedModel;
    if (!provider || !model) return;
    if (lastSelectedModels[provider] !== model) {
      lastSelectedModels = {
        ...lastSelectedModels,
        [provider]: model,
      };
    }
  });

  let slideDirection = $state(1);
  const settingsTabOrder = [
    "appearance",
    "translation",
    "system",
    "api",
    "styles",
    "about",
  ];

  function moveStyle(index: number, direction: "up" | "down") {
    const newStyles = [...customStyles];
    if (direction === "up" && index > 0) {
      [newStyles[index], newStyles[index - 1]] = [
        newStyles[index - 1],
        newStyles[index],
      ];
    } else if (direction === "down" && index < newStyles.length - 1) {
      [newStyles[index], newStyles[index + 1]] = [
        newStyles[index + 1],
        newStyles[index],
      ];
    }
    customStyles = newStyles;
    localStorage.setItem(
      "howlingual_custom_styles",
      JSON.stringify(customStyles),
    );
  }

  function getApiKeyLabel(provider: AiProvider) {
    switch (provider) {
      case "openai":
        return t(appLanguage, "openaiApiKey");
      case "gemini":
        return t(appLanguage, "geminiApiKey");
      case "anthropic":
        return t(appLanguage, "anthropicApiKey");
      case "groq":
        return t(appLanguage, "groqApiKey");
      case "cerebras":
        return t(appLanguage, "cerebrasApiKey");
    }
  }

  function getApiKeyPlaceholder(provider: AiProvider) {
    switch (provider) {
      case "gemini":
        return "AIza...";
      case "anthropic":
        return "sk-ant-...";
      case "groq":
      case "cerebras":
      case "openai":
      default:
        return "sk-...";
    }
  }

  function changeTab(
    newTab:
      | "appearance"
      | "translation"
      | "system"
      | "api"
      | "styles"
      | "about",
  ) {
    const currentIndex = settingsTabOrder.indexOf(settingsTab);
    const newIndex = settingsTabOrder.indexOf(newTab);
    slideDirection = newIndex > currentIndex ? 1 : -1;
    settingsTab = newTab;
  }

  let focusReturnTarget: HTMLElement | null = null;

  function rememberFocusTarget() {
    if (document.activeElement instanceof HTMLElement) {
      focusReturnTarget = document.activeElement;
    }
  }

  function restoreFocusTarget() {
    const target = focusReturnTarget;
    focusReturnTarget = null;
    if (!target) return;
    void tick().then(() => {
      if (target.isConnected) {
        target.focus({ preventScroll: true });
      }
    });
  }

  function openSettingsModal() {
    rememberFocusTarget();
    settingsTab = "appearance";
    showSettings = true;
  }

  function openHistory() {
    rememberFocusTarget();
    showHistory = true;
  }

  function closeHistory() {
    showHistory = false;
    restoreFocusTarget();
  }

  async function handleWindowKeydown(e: KeyboardEvent) {
    if (isCaptureMode) return; // Let CaptureOverlay handle events
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void startTranslation();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();

      // Blur active element to prevent focus rings after closing
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      if (actionMenuOpenId !== null) {
        actionMenuOpenId = null;
        return;
      }
      if (showSourceLangMenu) {
        showSourceLangMenu = false;
        return;
      }
      if (showTargetLangMenu) {
        showTargetLangMenu = false;
        return;
      }
      if (styleOverflowOpen) {
        styleOverflowOpen = false;
        return;
      }
      if (compactStylesOpen) {
        compactStylesOpen = false;
        return;
      }

      if (showResetConfirmation) {
        showResetConfirmation = false;
        return;
      }
      if (showDiscardConfirmation) {
        showDiscardConfirmation = false;
        return;
      }
      if (editingStyle) {
        showDiscardConfirmation = true;
        return;
      }
      if (showSettings) {
        closeSettings();
        return;
      }
      if (showHistory) {
        closeHistory();
        return;
      }

      if (isCompactMode) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().hide();
        return;
      }
    }
  }

  function openStyleEditor(style?: CustomStyle) {
    if (style) {
      editingStyle = { ...style };
    } else {
      editingStyle = {
        id: crypto.randomUUID(),
        name: "",
        prompt: "",
        isDefault: false,
      };
    }
  }

  function saveStyle() {
    if (!editingStyle) return;
    if (!editingStyle.name.trim()) return;

    // Check if the style is a default style and if it has been modified
    if (editingStyle.isDefault) {
      const defaults = getDefaultStyles(appLanguage);
      const originalDefault = defaults.find((d) => d.id === editingStyle!.id);

      // If it is a default style but content changed, it's no longer a "default" (system managed) style
      // It becomes a custom style derived from a default one.
      if (originalDefault) {
        if (
          editingStyle.name !== originalDefault.name ||
          editingStyle.prompt !== originalDefault.prompt
        ) {
          editingStyle.isDefault = false;
        }
      } else {
        // Should not happen if id matched, but safety fallback
        editingStyle.isDefault = false;
      }
    }

    const index = customStyles.findIndex((s) => s.id === editingStyle!.id);
    if (index !== -1) {
      customStyles = customStyles.map((s, i) =>
        i === index ? editingStyle! : s,
      );
    } else {
      customStyles = [...customStyles, editingStyle];
    }
    localStorage.setItem(
      "howlingual_custom_styles",
      JSON.stringify(customStyles),
    );
    editingStyle = null;
  }

  function cancelEditStyle() {
    showDiscardConfirmation = true;
  }

  function confirmDiscardStyle() {
    editingStyle = null;
    showDiscardConfirmation = false;
  }

  function deleteStyle(styleId: string) {
    customStyles = customStyles.filter((s) => s.id !== styleId);
    localStorage.setItem(
      "howlingual_custom_styles",
      JSON.stringify(customStyles),
    );
  }

  function resetStyles() {
    if (confirm(t(appLanguage, "confirmReset"))) {
      customStyles = [...getDefaultStyles(appLanguage)];
      localStorage.setItem(
        "howlingual_custom_styles",
        JSON.stringify(customStyles),
      );
    }
  }

  async function addStyle() {
    openStyleEditor();
  }

  function openSettings() {
    rememberFocusTarget();
    showSettings = true;
  }

  function openStyles() {
    rememberFocusTarget();
    settingsTab = "styles";
    showSettings = true;
  }

  function closeSettings() {
    showSettings = false;
    restoreFocusTarget();
  }

  async function startOCR() {
    if (isMac && permissions.screen_recording === false) {
      await requestPermission("screen_recording");
      errorMessage = (t(appLanguage, "screenRecording") || "画面収録") + " " + (t(appLanguage, "denied") || "未許可") + "\n\n" + (t(appLanguage, "ocrHighAccuracyDesc") ? "System Settings > Privacy & Security > Screen Recording" : "システム設定 > プライバシーとセキュリティ > 画面収録 から、\nHowlingualに画面収録の許可を与えてください。");
      // Actually, let's use a more direct message if we don't have a specific i18n key for the instruction yet
      if (appLanguage === "ja") {
        errorMessage = "画面収録の許可が必要です。\n\nシステム設定 > プライバシーとセキュリティ > 画面収録 から、\nHowlingualに画面収録の許可を与えてください。";
      } else {
        errorMessage = "Screen Recording permission is required.\n\nPlease grant permission to Howlingual in System Settings > Privacy & Security > Screen Recording.";
      }
      return;
    }

    try {
      console.log("[UI] Starting OCR selection...");
      isWaitingForOCR = true;
      const origin = isCompactMode ? "compact" : "main";
      await invoke("start_selection_ocr", { origin });
    } catch (e) {
      console.error("[UI] OCR trigger failed:", e);
      errorMessage = "OCR Error: " + String(e);
      isWaitingForOCR = false;
    }
  }

  async function openMainScreen() {
    try {
      isOpeningMain = true; // Flag to prevent compact window from clearing text

      // Build handover payload with full translation state
      console.log(
        "[handover] Current translations:",
        translations.length,
        translations,
      );
      const handoverPayload = JSON.stringify({
        sourceText: inputQuery,
        translations: translations.map((t) => ({
          text: t.text,
          reason: t.reason,
        })),
        detailedExplanation: detailedExplanation
          ? $state.snapshot(detailedExplanation)
          : null,
        sourceLang: isAutoDetect ? AUTO_DETECT_LABEL : sourceLang,
        detectedLang: detectedLang,
        targetLang: targetLang,
        styleLevels: $state.snapshot(styleLevels),
        techMetrics: $state.snapshot(techMetrics),
        showTechInfo: showTechInfo,
        isTranslating: isTranslating, // Pass translating state
      });
      console.log(
        "[handover] Sending payload:",
        handoverPayload.length,
        "chars",
      );

      // Use dedicated handover command with full state
      await invoke("handover_to_main", { text: handoverPayload });

      // Hide the quick window after handover
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        if (currentWindow.label === "compact") {
          await currentWindow.hide();
        }
      } catch (hideError) {
        console.warn("Failed to hide quick window:", hideError);
      }
    } catch (error) {
      console.warn("Main window open failed:", error);
      isOpeningMain = false;
    }
  }

  async function handleHandover(payload: string) {
    try {
      // Try to parse as JSON first (for full state handover)
      const data = JSON.parse(payload);
      if (typeof data === "object" && data !== null && "sourceText" in data) {
        console.log("[Handover] Restoring full state");
        inputQuery = data.sourceText || "";
        lastTranslatedText = inputQuery;
        // Map translations to ensure reactive updates if needed
        if (data.translations && Array.isArray(data.translations)) {
          translations = data.translations.map((t: any, i: number) => ({
            id: i + 1,
            text: t?.text || "",
            reason: t?.reason || "",
          }));
        } else {
          translations = [];
        }
        detailedExplanation = data.detailedExplanation || null;
        showExplanation = !!detailedExplanation;

        if (data.sourceLang) {
          applySourceLangFromSync(data.sourceLang, data.detectedLang);
        }
        if (data.targetLang) {
          targetLang = data.targetLang;
        }

        if (data.styleLevels) {
          styleLevels = normalizeStyleLevels(
            { ...styleLevels, ...data.styleLevels },
            customStyles,
          );
        }
        if (data.techMetrics) {
          syncTechMetrics({ ...techMetrics, ...data.techMetrics });
        }
        if (typeof data.showTechInfo === "boolean") {
          showTechInfo = data.showTechInfo;
        }

        // Restore translating state if it was interrupted
        isTranslating = data.isTranslating || false;

        await tick();
        await autoResize();
        await emit("request_sync_state");
      } else {
        // Valid JSON but not our state object? Treat as text.
        await applyQuickText(typeof data === "string" ? data : payload);
      }
    } catch (e) {
      // Not JSON, treat as raw text
      await applyQuickText(payload);
    }
  }

  async function applyQuickText(text: string) {
    // Clear ALL previous state when new text arrives
    inputQuery = ""; // Clear first to force reactivity
    // Pre-populate empty translation slots (so card backgrounds are visible)
    translations = Array.from({ length: translationCount }, (_, i) => ({
      id: i + 1,
      text: "",
      reason: "",
    }));
    detailedExplanation = null;
    showExplanation = false;
    errorMessage = "";
    autoScrollEnabled = true;
    lastStreamCharCount = 0;
    // Reset tech metrics
    resetTechMetrics();
    isStackExpanded = false; // Reset stack state

    await tick();

    // Apply the new input text
    inputQuery = text;
    if (isAutoDetect) {
      const trimmed = text.trim();
      detectedLang = trimmed ? detectLanguageSimple(trimmed) : "";
      isDetecting = false;
    }
    // Sync to service immediately and reset service-side state
    await syncSharedState(true);

    await tick();
    autoResize();

    // Focus the textarea
    if (textareaEl) {
      textareaEl.focus();
    }

    // Auto-start translation if there's text
    if (text.trim()) {
      if (autoRunQuick) {
        console.log("[AutoRun] Triggering translation automatically");
        await startTranslation();
      } else {
        console.log("[AutoRun] Skipped (disabled)");
      }
    }
  }

  let syncTimer: ReturnType<typeof setTimeout> | null = null;

  async function syncSharedState(resetTranslations = false) {
    await emit("sync_input_command", {
      text: inputQuery,
      sourceLang,
      detectedLang,
      isDetecting,
      targetLang,
      styles: $state.snapshot(styleLevels),
      candidateCount: translationCount,
      resetTranslations,
    });
  }

  function scheduleSyncSharedState(delay = 150) {
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncSharedState();
    }, delay);
  }

  function handleInputChange() {
    void autoResize();
    // Synchronous immediate detection with threshold
    if (isAutoDetect) {
      const trimmed = inputQuery.trim();
      if (!trimmed) {
        detectedLang = "";
        isDetecting = false;
      } else if (trimmed.length < 5) {
        // Wait for more input
        detectedLang = "";
        isDetecting = true;
      } else {
        // Enough input, detect immediately
        const res = detectLanguageSimple(trimmed);
        detectedLang = res;
        isDetecting = false;
      }
    }
    scheduleSyncSharedState();
  }

  async function clearInput() {
    if (isTranslating) {
      await stopTranslation();
    }
    inputQuery = "";
    translations = [];
    detailedExplanation = null;
    showExplanation = false;
    errorMessage = "";
    lastStreamCharCount = 0;
    autoScrollEnabled = true;
    isStackExpanded = false;
    if (isAutoDetect) {
      detectedLang = "";
      isDetecting = false;
    }
    resetTechMetrics();
    await syncSharedState(true);
  }

  async function syncShortcut() {
    try {
      await invoke("update_shortcut", { shortcut: quickShortcut });
      shortcutError = "";
    } catch (error) {
      console.warn("Shortcut sync failed:", error);
    }
  }

  async function applyShortcut() {
    const nextShortcut = shortcutDraft.trim();
    if (!nextShortcut) {
      shortcutError = t(appLanguage, "shortcutInvalid");
      return;
    }
    if (nextShortcut === quickShortcut) {
      shortcutError = "";
      return;
    }
    shortcutSaving = true;
    try {
      await invoke("update_shortcut", { shortcut: nextShortcut });
      quickShortcut = nextShortcut;
      shortcutDraft = nextShortcut;
      shortcutError = "";
    } catch (error) {
      console.warn("Shortcut update failed:", error);
      shortcutError = t(appLanguage, "shortcutInvalid");
    } finally {
      shortcutSaving = false;
    }
  }

  // Use selected model for translations (instead of env variable)
  let currentModel = $derived(
    selectedModel ||
      (getDefaultModelForProvider(selectedProvider) as AiModel) ||
      ((import.meta.env.VITE_PREFERRED_MODEL || "gemini-1.5-flash") as AiModel),
  );

  let inputQuery = $state("");

  const AUTO_DETECT_LABEL = "自動検出";

  // Language direction
  let isAutoDetect = $state(true);
  let detectedLang = $state("");
  let sourceLang = $state(AUTO_DETECT_LABEL);
  let targetLang = $state("日本語");
  let showSourceLangMenu = $state(false);
  let showTargetLangMenu = $state(false);

  const languages = [
    "英語",
    "日本語",
    "中国語",
    "韓国語",
    "フランス語",
    "ドイツ語",
    "スペイン語",
  ];

  let isSparkling = $state(false);
  let canReplaceSelection = $derived(clipboardOpsEnabled && !isLinux);

  function toggleClipboardOps() {
    if (!clipboardOpsEnabled) {
      const approved = confirm(t(appLanguage, "clipboardOpsConfirmEnable"));
      if (!approved) return;
    }
    clipboardOpsEnabled = !clipboardOpsEnabled;
  }

  function applySourceLangFromSync(lang: string, detected?: string) {
    if (lang === AUTO_DETECT_LABEL) {
      isAutoDetect = true;
      sourceLang = AUTO_DETECT_LABEL;
      detectedLang = detected || "";
      return;
    }

    isAutoDetect = false;
    sourceLang = lang;
    detectedLang = "";
  }

  function selectSourceLang(lang: string | null) {
    if (lang === null) {
      isAutoDetect = true;
      sourceLang = AUTO_DETECT_LABEL;
      detectedLang = ""; // Clear previous detection
      // Trigger temporary sparkle animation
      isSparkling = true;
      setTimeout(() => {
        isSparkling = false;
      }, 1000);
    } else {
      isAutoDetect = false;
      sourceLang = lang;
      detectedLang = ""; // Clear detection when manually selecting
      isDetecting = false;
    }
    console.log(
      `[UI] Source Language Selected: ${sourceLang} (Auto: ${isAutoDetect})`,
    );
    showSourceLangMenu = false;
    scheduleSyncSharedState();
  }

  function selectTargetLang(lang: string) {
    console.log(`[UI] Target Language Selected: ${lang}`);
    targetLang = lang;
    showTargetLangMenu = false;
    scheduleSyncSharedState();
  }

  function formatHistoryLanguage(lang: string, isAuto = false) {
    if (isAuto && lang && lang !== AUTO_DETECT_LABEL) {
      return `${t(appLanguage, "autoDetect")} (${getTargetLanguageName(appLanguage, lang)})`;
    }
    if (isAuto || lang === AUTO_DETECT_LABEL) {
      return t(appLanguage, "autoDetect");
    }
    return getTargetLanguageName(appLanguage, lang);
  }

  // Prevent same-language translation if allowRewrite is false
  $effect(() => {
    if (allowRewrite) return;

    // Determine actual source language
    const actualSource = isAutoDetect ? detectedLang : sourceLang;
    if (!actualSource) return;

    if (actualSource === targetLang) {
      const fallback = "英語"; // Hardcoded backup

      if (actualSource === defaultTargetLang) {
        // Source IS default, so switch to fallback
        if (targetLang !== fallback) {
          targetLang = fallback;
          console.log(
            `[Auto-Switch] Source (${actualSource}) == Target, switched target to ${fallback}`,
          );
        }
      } else {
        // Source is foreign, switch to default
        if (targetLang !== defaultTargetLang) {
          targetLang = defaultTargetLang;
          console.log(
            `[Auto-Switch] Source (${actualSource}) == Target, switched target to ${defaultTargetLang}`,
          );
        }
      }
    }
  });

  // Close menus when clicking outside
  $effect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        !target.closest(".lang-selector") &&
        !target.closest(".style-dropdown-wrapper") &&
        !target.closest(".settings-panel") &&
        !target.closest(".compact-style") &&
        !target.closest(".action-menu")
      ) {
        showSourceLangMenu = false;
        showTargetLangMenu = false;
        styleOverflowOpen = false;
        compactStylesOpen = false;
        actionMenuOpenId = null;
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  });

  // Style levels: 0 = オフ, 1 = 弱, 2 = 強

  // Copy feedback state
  let copiedId: number | null = $state(null);
  let replacedId: number | null = $state(null);
  let actionMenuOpenId: number | null = $state(null);

  async function handleCopy(id: number, text: string) {
    console.log(`[UI] Copy triggered for ID: ${id}`);
    try {
      await navigator.clipboard.writeText(text);
      copiedId = id;
      setTimeout(() => {
        copiedId = null;
      }, 1500);
    } catch (error) {
      console.warn("Copy failed:", error);
    }
  }

  async function handleReplace(id: number, text: string) {
    console.log(`[UI] Replace triggered for ID: ${id}`);
    actionMenuOpenId = null;
    if (!canReplaceSelection) {
      errorMessage = isLinux
        ? t(appLanguage, "replaceUnavailableLinux")
        : t(appLanguage, "clipboardOpsDisabled");
      return;
    }
    try {
      await invoke("replace_selection", { text });
      replacedId = id;
      setTimeout(() => {
        if (replacedId === id) replacedId = null;
      }, 1500);
    } catch (error) {
      console.warn("Replace failed:", error);
    }
  }

  function toggleActionMenu(id: number) {
    actionMenuOpenId = actionMenuOpenId === id ? null : id;
  }

  // Button animation states (to prevent animation interruption on hover end)
  let settingsAnimating = $state(false);
  let settingsAnimTimer: ReturnType<typeof setTimeout> | null = null;
  let speakAnimating: Record<number, boolean> = $state({});
  let copyAnimating: Record<number, boolean> = $state({});
  let isSpeakingId: number | null = $state(null);

  function triggerSettingsAnim() {
    // 既存のタイマーをクリアして即座に再開可能に
    if (settingsAnimTimer) clearTimeout(settingsAnimTimer);
    settingsAnimating = true;
    settingsAnimTimer = setTimeout(() => {
      settingsAnimating = false;
    }, 400);
  }

  function handleSpeak(id: number, text: string, lang: string) {
    if (!ttsAvailable) {
      errorMessage = t(appLanguage, "ttsUnavailable");
      return;
    }

    // If already speaking THIS card, stop it
    if (isSpeakingId === id) {
      window.speechSynthesis.cancel();
      isSpeakingId = null;
      return;
    }

    // Stop currently playing
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    isSpeakingId = id;

    // Simple language mapping ...
    let langCode = "en-US";
    switch (lang) {
      case "日本語":
        langCode = "ja-JP";
        break;
      case "英語":
        langCode = "en-US";
        break;
      case "中国語":
        langCode = "zh-CN";
        break;
      case "韓国語":
        langCode = "ko-KR";
        break;
      case "フランス語":
        langCode = "fr-FR";
        break;
      case "ドイツ語":
        langCode = "de-DE";
        break;
      case "スペイン語":
        langCode = "es-ES";
        break;
    }

    utterance.lang = langCode;
    utterance.onend = () => {
      if (isSpeakingId === id) isSpeakingId = null;
    };
    utterance.onerror = () => {
      if (isSpeakingId === id) isSpeakingId = null;
    };

    console.log(
      `[UI] TTS triggered for: "${text.substring(0, 20)}..." (Lang: ${langCode})`,
    );
    window.speechSynthesis.speak(utterance);
  }

  function triggerSpeakAnim(id: number) {
    if (speakAnimating[id]) return;
    speakAnimating[id] = true;
    setTimeout(() => {
      speakAnimating[id] = false;
    }, 1200);
  }

  function triggerCopyAnim(id: number) {
    if (copyAnimating[id]) return;
    copyAnimating[id] = true;
    setTimeout(() => {
      copyAnimating[id] = false;
    }, 600);
  }

  let isDragging = false;

  function cycleLevel(styleId: string) {
    if (isDragging) return;
    const nextLevel = ((styleLevels[styleId] || 0) + 1) % 3;
    // Reassign to trigger reactivity
    styleLevels = { ...styleLevels, [styleId]: nextLevel };
    console.log(`[UI] Style cycled: ${styleId} -> ${nextLevel}`);
    scheduleSyncSharedState();
  }

  function handleDrag(styleId: string, event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const startX = event.clientX;
    const startLevel = styleLevels[styleId] || 0;
    isDragging = false;
    let hasMoved = false;

    const onMove = (e: PointerEvent) => {
      const deltaX = e.clientX - startX;

      // Determine if dragging started
      if (!hasMoved && Math.abs(deltaX) > 3) {
        hasMoved = true;
        isDragging = true;
      }

      const width = rect.width;
      const levelChange = Math.round(deltaX / (width / 2));
      const newLevel = Math.max(0, Math.min(2, startLevel + levelChange));
      // Reassign to trigger reactivity during drag
      styleLevels = { ...styleLevels, [styleId]: newLevel };
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Sync state after drag completes
      if (hasMoved) {
        scheduleSyncSharedState();
      }
      // Reset isDragging after a short delay to allow click event to fire and check it
      setTimeout(() => {
        isDragging = false;
      }, 50);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Auto-resize textarea
  let textareaEl = $state<HTMLTextAreaElement>();
  let isLongText = $state(false);

  async function autoResize() {
    if (!textareaEl) return;

    // Determine font size based on character count (stable)
    // Dynamic threshold: 90 for Japanese (Multibyte), 200 for English
    const isJapanese =
      /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(
        inputQuery,
      );
    const threshold = isJapanese ? 90 : 200;
    isLongText = inputQuery.length > threshold;

    // Wait for DOM update if font size changed
    await tick();

    // Auto-resize height with max limit
    textareaEl.style.height = "auto";
    textareaEl.style.minHeight = "0";
    const scrollHeight = textareaEl.scrollHeight;
    textareaEl.style.minHeight = "";

    // Limit to approx 10 lines (13px * 1.5 * 10 = ~195px, let's say 200px)
    // If shrinking font isn't enough, we cap it and allow scroll
    const maxHeight = isCompactMode ? 120 : 200;

    if (scrollHeight > maxHeight) {
      textareaEl.style.height = maxHeight + "px";
      textareaEl.style.overflowY = "auto";
    } else {
      textareaEl.style.height = scrollHeight + "px";
      textareaEl.style.overflowY = "auto";
    }

    // Update scroll fade
    checkScroll();
  }

  let showFade = $state(false);

  function checkScroll() {
    if (!textareaEl) {
      showFade = false;
      return;
    }
    // Show fade if content is scrollable AND not at the bottom
    // Tolerance of 2px
    const isScrollable = textareaEl.scrollHeight > textareaEl.clientHeight;
    const isAtBottom =
      Math.abs(
        textareaEl.scrollHeight -
          textareaEl.scrollTop -
          textareaEl.clientHeight,
      ) < 2;
    showFade = isScrollable && !isAtBottom;
  }

  // Unified scroll state
  let scrollContainerEl = $state<HTMLElement>();
  let isScrolledDown = $state(false);

  let isScrolling = $state(false);
  let scrollTimeout: any;
  let scrollThumbTop = $state(0);
  let scrollThumbHeight = $state(0);

  // Auto-scroll during streaming (like modern AI chat apps)
  let autoScrollEnabled = $state(true);
  let lastScrollTop = 0;
  let isAtBottom = $state(true);
  let lastStreamCharCount = $state(0);

  function onMainScroll() {
    if (!scrollContainerEl || !textareaEl) return;

    // Manage scrolling state for scrollbar visibility
    isScrolling = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
    }, 1000);

    // Calculate scrollbar thumb position and size
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerEl;
    const trackHeight = clientHeight;
    const thumbHeight = Math.max(
      (clientHeight / scrollHeight) * trackHeight,
      30,
    );
    const scrollableHeight = scrollHeight - clientHeight;
    const thumbTop =
      scrollableHeight > 0
        ? (scrollTop / scrollableHeight) * (trackHeight - thumbHeight)
        : 0;

    scrollThumbTop = thumbTop;
    scrollThumbHeight = thumbHeight;

    const threshold = textareaEl.clientHeight + 40;
    isScrolledDown = scrollContainerEl.scrollTop > threshold;

    // Auto-scroll logic: detect if user scrolled up
    if (isTranslating) {
      // Allow slight tolerance for "bottom"
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 30;

      if (isNearBottom) {
        // If user is at the bottom, force enable auto-scroll
        autoScrollEnabled = true;
      } else {
        // Only disable if user explicitly scrolls up away from bottom
        const scrollDelta = scrollTop - lastScrollTop;
        if (scrollDelta < -10) {
          autoScrollEnabled = false;
        }
      }
    }
    lastScrollTop = scrollTop;

    // Track if at bottom for fade effect
    isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
  }

  // Debounced auto-scroll to prevent erratic behavior
  let autoScrollRafId: number | null = null;
  function autoScrollToBottom() {
    if (scrollContainerEl && autoScrollEnabled) {
      // Cancel any pending scroll to prevent stacking
      if (autoScrollRafId !== null) {
        cancelAnimationFrame(autoScrollRafId);
        autoScrollRafId = null;
      }
      autoScrollRafId = requestAnimationFrame(() => {
        autoScrollRafId = null;
        if (scrollContainerEl && autoScrollEnabled) {
          scrollContainerEl.scrollTo({
            top: scrollContainerEl.scrollHeight,
            behavior: "smooth",
          });
        }
      });
    }
  }

  function checkBottomPosition() {
    if (!scrollContainerEl) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerEl;
    isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
  }

  function scrollToTop() {
    if (scrollContainerEl) {
      scrollContainerEl.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  $effect(() => {
    if (!scrollContainerEl) return;
    translations;
    const currentCharCount = translations.reduce(
      (sum, t) => sum + (t.text ? t.text.length : 0),
      0,
    );
    if (isTranslating && currentCharCount > lastStreamCharCount) {
      void tick().then(autoScrollToBottom);
    }
    lastStreamCharCount = currentCharCount;
  });

  $effect(() => {
    if (inputQuery !== undefined) {
      autoResize();
    }
  });

  let lastTranslatedText = $state("");

  $effect(() => {
    if (isTranslating) return;
    if (inputQuery !== lastTranslatedText) {
      if (detailedExplanation) {
        detailedExplanation = null;
      }
      if (showExplanation) {
        showExplanation = false;
      }
    }
  });

  // Mock Data
  // Mock Data
  let translations: { id: number; text: string; reason: string }[] = $state([
    { id: 1, text: "", reason: "" },
    { id: 2, text: "", reason: "" },
    { id: 3, text: "", reason: "" },
  ]);
  let detailedExplanation: {
    points: { term: string; explanation: string }[];
  } | null = $state(null);
  let isTranslating = $state(false);
  let showExplanation = $state(true);
  let isDetecting = $state(false);

  let errorMessage = $state("");

  // ====== Permission State (macOS only) ======
  let permissions = $state({
    screen_recording: null as boolean | null,
    accessibility: null as boolean | null,
  });

  async function checkPermissions() {
    if (!isMac) return;
    try {
      const status = await invoke<any>("check_permissions");
      permissions = status;
      console.log("[permissions] Check status:", status);
    } catch (e) {
      console.warn("[permissions] Failed to check permissions", e);
    }
  }

  async function requestPermission(type: "screen_recording" | "accessibility") {
    try {
      await invoke("request_permissions", { permissionType: type });
      // After requesting, start a periodic check to detect when user grants it
      const start = Date.now();
      const interval = setInterval(async () => {
        const status = await invoke<any>("check_permissions");
        permissions = status;
        if (permissions[type] || Date.now() - start > 60000) {
          clearInterval(interval);
        }
      }, 2000);
    } catch (e) {
      console.warn("[permissions] Failed to request permission", e);
    }
  }

  // Technical Info
  type HistoryItem = {
    id: string;
    timestamp: number;
    sourceText: string;
    sourceLang: string;
    targetLang: string;
    isAutoDetect?: boolean;
    detectedLang?: string;
    translations: { text: string; reason: string }[];
    detailedExplanation?: {
      points: { term: string; explanation: string }[];
    } | null;
    styleLevels: Record<string, number>;
  };

  type LastResultSnapshot = {
    timestamp: number;
    sourceText: string;
    sourceLang: string;
    targetLang: string;
    detectedLang: string;
    isAutoDetect: boolean;
    translations: { text: string; reason: string }[];
    detailedExplanation: {
      points: { term: string; explanation: string }[];
    } | null;
    styleLevels: Record<string, number>;
  };

  let history: HistoryItem[] = $state([]);
  let favorites: HistoryItem[] = $state([]);
  let showHistory = $state(false);
  let historyTab = $state("recent"); // "recent" | "saved"
  let historySlideDirection = $state(1);
  const historyTabOrder = ["recent", "saved"];

  function changeHistoryTab(newTab: string) {
    const currentIndex = historyTabOrder.indexOf(historyTab);
    const newIndex = historyTabOrder.indexOf(newTab);
    historySlideDirection = newIndex > currentIndex ? 1 : -1;
    historyTab = newTab;
  }

  let starAnimatingId = $state("");

  function triggerStarAnim(id: string) {
    starAnimatingId = id;
    setTimeout(() => {
      if (starAnimatingId === id) starAnimatingId = "";
    }, 600);
  }

  function buildFavoriteKey(item: {
    sourceText: string;
    translations: { text: string; reason: string }[];
  }): string {
    const normalizedTranslations = (item.translations || [])
      .map((t) => ({
        text: t.text || "",
        reason: t.reason || "",
      }))
      .sort((a, b) =>
        (a.text + a.reason).localeCompare(b.text + b.reason),
      );
    return JSON.stringify({
      sourceText: item.sourceText || "",
      translations: normalizedTranslations,
    });
  }

  function toggleFavorite(item: HistoryItem) {
    const itemKey = buildFavoriteKey(item);
    const existingIdx = favorites.findIndex(
      (f) => f.id === item.id || buildFavoriteKey(f) === itemKey,
    );
    if (existingIdx >= 0) {
      favorites = favorites.filter((_, i) => i !== existingIdx);
      triggerStarAnim(item.id); // Animate unfavorite too
    } else {
      // Ensure the item has a valid id
      const newItem = { ...item, id: item.id || crypto.randomUUID() };
      favorites = [newItem, ...favorites];
      triggerStarAnim(newItem.id);
    }
    localStorage.setItem("howlingual_favorites", JSON.stringify(favorites));
  }

  function isFavorited(sourceText: string): boolean {
    const key = buildFavoriteKey({
      sourceText,
      translations: translations.map((t) => ({
        text: t.text,
        reason: t.reason,
      })),
    });
    return favorites.some((f) => buildFavoriteKey(f) === key);
  }

  function isFavoritedById(id: string): boolean {
    const item = history.find((h) => h.id === id);
    if (item) {
      const key = buildFavoriteKey(item);
      return favorites.some((f) => f.id === id || buildFavoriteKey(f) === key);
    }
    return favorites.some((f) => f.id === id);
  }

  function deleteHistoryItem(id: string) {
    history = history.filter((h) => h.id !== id);
    localStorage.setItem("howlingual_history", JSON.stringify(history));
  }

  function moveFavorite(index: number, direction: "up" | "down") {
    const newIdx = direction === "up" ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= favorites.length) return;
    const newFavs = [...favorites];
    [newFavs[index], newFavs[newIdx]] = [newFavs[newIdx], newFavs[index]];
    favorites = newFavs;
    localStorage.setItem("howlingual_favorites", JSON.stringify(favorites));
  }

  function deleteFavorite(id: string) {
    favorites = favorites.filter((f) => f.id !== id);
    localStorage.setItem("howlingual_favorites", JSON.stringify(favorites));
  }

  onMount(() => {
    // Scroll handling
    const container = scrollContainerEl;
    if (container) {
      // ... (existing resize observer logic inside onMount if any? No, existing code uses actions)
    }

    const savedHistory = localStorage.getItem("howlingual_history");
    if (savedHistory) {
      try {
        history = JSON.parse(savedHistory);
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }

    const savedFavs = localStorage.getItem("howlingual_favorites");
    if (savedFavs) {
      try {
        favorites = JSON.parse(savedFavs);
      } catch (e) {
        console.error("Failed to load favorites", e);
      }
    }

    /* Duplicate customStyles loading removed - already handled in first onMount */

    /* Last result loading disabled by user request */
  });

  function loadHistory(item: HistoryItem) {
    inputQuery = item.sourceText;
    lastTranslatedText = item.sourceText;
    // We try to match sourceLang/targetLang to available options if possible,
    // or just set them if they are strings.
    // For now assuming strings are compatible.
    if (
      item.sourceLang !== "自動検出" &&
      !languages.includes(item.sourceLang)
    ) {
      // Logic for unsupported lang if needed
    }
    // sourceLang = item.sourceLang; // Might conflict with select binding if value not in list
    // simplified:
    inputQuery = item.sourceText;
    translations = item.translations.map((t, i) => ({ ...t, id: i + 1 }));

    // Restore explanation
    if (item.detailedExplanation) {
      detailedExplanation = item.detailedExplanation;
      showExplanation = true;
    } else {
      detailedExplanation = null;
      showExplanation = false;
    }

    // Restore source/target if they exist in current list
    if (languages.includes(item.targetLang)) {
      targetLang = item.targetLang;
    }
    const shouldAutoDetect =
      item.isAutoDetect ?? item.sourceLang === AUTO_DETECT_LABEL;
    if (shouldAutoDetect) {
      isAutoDetect = true;
      sourceLang = AUTO_DETECT_LABEL;
      detectedLang = item.detectedLang || "";
      isDetecting = false;
    } else if (languages.includes(item.sourceLang)) {
      isAutoDetect = false;
      sourceLang = item.sourceLang;
      detectedLang = "";
      isDetecting = false;
    }

    // Restore style levels
    if (item.styleLevels) {
      styleLevels = { ...styleLevels, ...item.styleLevels };
    }

    persistLastResult();

    closeHistory();
  }

  function clearHistory() {
    history = [];
    localStorage.removeItem("howlingual_history");
  }

  const LAST_RESULT_KEY = "howlingual_last_result";

  function persistLastResult() {
    if (!translations.some((t) => t.text)) return;
    const snapshot: LastResultSnapshot = {
      timestamp: Date.now(),
      sourceText: inputQuery,
      sourceLang: sourceLang,
      targetLang: targetLang,
      detectedLang: detectedLang,
      isAutoDetect: isAutoDetect,
      translations: translations.map((t) => ({
        text: t.text,
        reason: t.reason,
      })),
      detailedExplanation: detailedExplanation
        ? $state.snapshot(detailedExplanation)
        : null,
      styleLevels: $state.snapshot(styleLevels),
    };
    localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(snapshot));
  }

  function applyLastResult(snapshot: LastResultSnapshot) {
    if (!snapshot || isTranslating) return;
    if (!Array.isArray(snapshot.translations)) return;
    inputQuery = snapshot.sourceText || "";
    lastTranslatedText = inputQuery;
    isAutoDetect = snapshot.isAutoDetect;
    sourceLang = snapshot.sourceLang || sourceLang;
    targetLang = snapshot.targetLang || targetLang;
    detectedLang = snapshot.detectedLang || "";
    translations = snapshot.translations.map((t, i) => ({
      id: i + 1,
      text: t.text,
      reason: t.reason,
    }));
    if (snapshot.detailedExplanation?.points?.length) {
      detailedExplanation = snapshot.detailedExplanation;
      showExplanation = true;
    } else {
      detailedExplanation = null;
      showExplanation = false;
    }
    styleLevels = { ...styleLevels, ...snapshot.styleLevels };
  }

  function loadLastResult() {
    if (isTranslating) return;
    const saved = localStorage.getItem(LAST_RESULT_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as LastResultSnapshot;
      if (parsed && parsed.sourceText) {
        applyLastResult(parsed);
      }
    } catch (error) {
      console.warn("Failed to load last result", error);
    }
  }

  let showTechInfo = $state(false);
  let showTechInfoInitialized = $state(false);

  function syncShowTechInfoFromStorage() {
    const stored = localStorage.getItem("howlingual_showTechInfo");
    if (stored !== null) {
      showTechInfo = stored === "true";
    }
  }

  // Load showTechInfo from localStorage on first mount
  onMount(() => {
    syncShowTechInfoFromStorage();
    showTechInfoInitialized = true;
    console.log("[TechInfo] Initialized, showTechInfo =", showTechInfo);
  });

  // Save showTechInfo only after initialized (prevent overwriting on load)
  $effect(() => {
    if (showTechInfoInitialized) {
      localStorage.setItem("howlingual_showTechInfo", String(showTechInfo));
    }
  });

  type TechMetrics = {
    time: number;
    waitTime: number; // Time until first token
    genTime: number; // Time for generation after first token
    model: string;
    inputTokens: number;
    outputTokens: number;
    tokensPerSec: number;
    streamMode: boolean;
    isReal: boolean;
    firstTokenReceived: boolean;
  };

  const EMPTY_TECH_METRICS: TechMetrics = {
    time: 0,
    waitTime: 0,
    genTime: 0,
    model: "",
    inputTokens: 0,
    outputTokens: 0,
    tokensPerSec: 0,
    streamMode: true,
    isReal: false,
    firstTokenReceived: false,
  };

  let techMetrics = $state<TechMetrics>({ ...EMPTY_TECH_METRICS });
  let techMetricsBaseTime = 0;
  let techMetricsLastSyncAt = 0;

  function syncTechMetrics(next: TechMetrics) {
    const now = Date.now();
    let merged = next;
    if (next.time < techMetrics.time && next.time > 0) {
      merged = {
        ...next,
        time: techMetrics.time,
        waitTime: techMetrics.waitTime,
        genTime: techMetrics.genTime,
      };
    }
    techMetrics = merged;
    techMetricsBaseTime = merged.time ?? 0;
    techMetricsLastSyncAt = now;
  }

  function resetTechMetrics() {
    syncTechMetrics({ ...EMPTY_TECH_METRICS });
  }

  onMount(() => {
    const interval = setInterval(() => {
      if (!isTranslating || techMetricsLastSyncAt === 0) return;
      const elapsed = (Date.now() - techMetricsLastSyncAt) / 1000;
      const time = techMetricsBaseTime + elapsed;
      if (time <= techMetrics.time) return;
      techMetrics.time = time;
      if (techMetrics.firstTokenReceived) {
        techMetrics.genTime = Math.max(0, time - techMetrics.waitTime);
        if (techMetrics.genTime > 0) {
          techMetrics.tokensPerSec = techMetrics.outputTokens / techMetrics.genTime;
        }
      } else {
        techMetrics.waitTime = time;
        techMetrics.genTime = 0;
      }
    }, 100);

    return () => {
      clearInterval(interval);
    };
  });

  type TranslationCandidateState = {
    id: number;
    text: string;
    reason: string;
  };

  type TranslationServiceState = {
    inputQuery: string;
    sourceLang: string;
    detectedLang: string;
    targetLang: string;
    translations: TranslationCandidateState[];
    detailedExplanation: AiResponse["detailed_explanation"] | null;
    styleLevels: Record<string, number>;
    techMetrics: TechMetrics;
    isTranslating: boolean;
    errorMessage: string;
  };

  type TranslationCommandPayload = {
    text: string;
    sourceLang: string;
    targetLang: string;
    styles: Record<string, number>;
    styleMeta?: Record<string, { name: string; prompt?: string }>;
    model: AiModel;
    provider?: AiProvider | null;
    explanationLang?: string;
    apiKeys?: Record<string, string>;
    initialTokens?: number;
    candidateCount?: number;
  };

  const makeEmptyTranslationSlots = (count: number) =>
    Array.from({ length: Math.max(1, count) }, (_, index) => ({
      id: index + 1,
      text: "",
      reason: "",
    }));

  let translationServiceAbortController: AbortController | null = null;
  let translationServiceState: TranslationServiceState = {
    inputQuery: "",
    sourceLang: AUTO_DETECT_LABEL,
    detectedLang: "",
    targetLang: "日本語",
    translations: [],
    detailedExplanation: null,
    styleLevels: {},
    techMetrics: { ...EMPTY_TECH_METRICS },
    isTranslating: false,
    errorMessage: "",
  };

  function getTranslationServiceMetrics(params: {
    startedAt: number;
    firstTokenAt: number;
    model: string;
    text: string;
    translations: TranslationCandidateState[];
    initialTokens?: number;
    usage?: UsageMetadata;
    isStreaming: boolean;
  }): TechMetrics {
    const now = Date.now();
    const time = Math.max(0, (now - params.startedAt) / 1000);
    const translatedChars = params.translations.reduce(
      (sum, item) => sum + item.text.length + item.reason.length,
      0,
    );
    const firstTokenAt =
      params.firstTokenAt || (translatedChars > 0 || params.usage ? now : 0);
    const waitTime = firstTokenAt
      ? Math.max(0, (firstTokenAt - params.startedAt) / 1000)
      : time;
    const genTime = firstTokenAt ? Math.max(0, time - waitTime) : 0;
    const outputTokens =
      params.usage?.output_tokens ?? Math.max(0, Math.ceil(translatedChars / 4));

    return {
      time,
      waitTime,
      genTime,
      model: params.model,
      inputTokens:
        params.usage?.input_tokens ??
        params.initialTokens ??
        Math.max(0, Math.ceil(params.text.length / 1.5)),
      outputTokens,
      tokensPerSec: genTime > 0 ? outputTokens / genTime : 0,
      streamMode: params.isStreaming,
      isReal: Boolean(params.usage),
      firstTokenReceived: Boolean(firstTokenAt),
    };
  }

  function mergeTranslationPartial(
    current: TranslationCandidateState[],
    partial: Partial<AiResponse>,
    candidateCount: number,
  ) {
    const next =
      current.length > 0
        ? current.map((item) => ({ ...item }))
        : makeEmptyTranslationSlots(candidateCount);

    partial.candidates?.forEach((candidate, index) => {
      next[index] = {
        id: index + 1,
        text: candidate.text ?? next[index]?.text ?? "",
        reason: candidate.reason ?? next[index]?.reason ?? "",
      };
    });

    return next;
  }

  async function emitTranslationServiceUpdate(
    patch: Partial<TranslationServiceState> = {},
  ) {
    translationServiceState = {
      ...translationServiceState,
      ...patch,
    };
    await emit("translation_update", translationServiceState);
  }

  async function handleTranslationCommand(payload: TranslationCommandPayload) {
    translationServiceAbortController?.abort();
    const abortController = new AbortController();
    translationServiceAbortController = abortController;

    const candidateCount = payload.candidateCount ?? 3;
    const startedAt = Date.now();
    let firstTokenAt = 0;
    let nextTranslations = makeEmptyTranslationSlots(candidateCount);

    await emitTranslationServiceUpdate({
      inputQuery: payload.text,
      sourceLang: payload.sourceLang,
      detectedLang: "",
      targetLang: payload.targetLang,
      translations: nextTranslations,
      detailedExplanation: null,
      styleLevels: payload.styles,
      techMetrics: {
        ...EMPTY_TECH_METRICS,
        model: payload.model,
        inputTokens:
          payload.initialTokens ?? Math.max(0, Math.ceil(payload.text.length / 1.5)),
        streamMode: true,
      },
      isTranslating: true,
      errorMessage: "",
    });

    try {
      await translateTextStream(
        payload.text,
        payload.sourceLang,
        payload.targetLang,
        payload.styles,
        payload.model,
        (partial, usage) => {
          if (abortController.signal.aborted) return;
          nextTranslations = mergeTranslationPartial(
            nextTranslations,
            partial,
            candidateCount,
          );
          if (
            firstTokenAt === 0 &&
            (nextTranslations.some((item) => item.text || item.reason) || usage)
          ) {
            firstTokenAt = Date.now();
          }
          void emitTranslationServiceUpdate({
            detectedLang:
              partial.detected_source_language ??
              translationServiceState.detectedLang,
            sourceLang:
              partial.detected_source_language ??
              translationServiceState.sourceLang,
            translations: nextTranslations,
            detailedExplanation:
              partial.detailed_explanation ??
              translationServiceState.detailedExplanation,
            techMetrics: getTranslationServiceMetrics({
              startedAt,
              firstTokenAt,
              model: payload.model,
              text: payload.text,
              translations: nextTranslations,
              initialTokens: payload.initialTokens,
              usage,
              isStreaming: true,
            }),
          });
        },
        payload.explanationLang ?? "日本語",
        payload.styleMeta ?? {},
        payload.apiKeys ?? {},
        {
          provider: payload.provider,
          signal: abortController.signal,
        },
        candidateCount,
      );

      if (!abortController.signal.aborted) {
        await emitTranslationServiceUpdate({
          isTranslating: false,
          techMetrics: getTranslationServiceMetrics({
            startedAt,
            firstTokenAt,
            model: payload.model,
            text: payload.text,
            translations: nextTranslations,
            initialTokens: payload.initialTokens,
            isStreaming: true,
          }),
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      await emitTranslationServiceUpdate({
        isTranslating: false,
        errorMessage: getFriendlyServiceError(error),
        techMetrics: getTranslationServiceMetrics({
          startedAt,
          firstTokenAt,
          model: payload.model,
          text: payload.text,
          translations: nextTranslations,
          initialTokens: payload.initialTokens,
          isStreaming: true,
        }),
      });
    } finally {
      if (translationServiceAbortController === abortController) {
        translationServiceAbortController = null;
      }
    }
  }

  function getFriendlyServiceError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  function shouldHandleTranslationServiceEvents() {
    try {
      return getCurrentWindow().label === "main";
    } catch {
      return true;
    }
  }

  onMount(() => {
    if (!shouldHandleTranslationServiceEvents()) return;

    const unlistenStart = listen<TranslationCommandPayload>(
      "start_translation_command",
      (event) => {
        void handleTranslationCommand(event.payload);
      },
    );
    const unlistenStop = listen("stop_translation_command", () => {
      translationServiceAbortController?.abort();
      void emitTranslationServiceUpdate({ isTranslating: false });
    });
    const unlistenSync = listen<any>("sync_input_command", (event) => {
      const payload = event.payload ?? {};
      const textChanged =
        payload.text !== undefined &&
        payload.text !== translationServiceState.inputQuery;
      const resetTranslations =
        Boolean(payload.resetTranslations) ||
        (textChanged && !translationServiceState.isTranslating);
      void emitTranslationServiceUpdate({
        inputQuery: payload.text ?? translationServiceState.inputQuery,
        sourceLang: payload.sourceLang ?? translationServiceState.sourceLang,
        detectedLang: payload.detectedLang ?? translationServiceState.detectedLang,
        targetLang: payload.targetLang ?? translationServiceState.targetLang,
        styleLevels: payload.styles ?? translationServiceState.styleLevels,
        translations: resetTranslations ? [] : translationServiceState.translations,
        detailedExplanation: resetTranslations
          ? null
          : translationServiceState.detailedExplanation,
        errorMessage: resetTranslations ? "" : translationServiceState.errorMessage,
        techMetrics: resetTranslations
          ? { ...EMPTY_TECH_METRICS }
          : translationServiceState.techMetrics,
      });
    });
    const unlistenRequest = listen("request_sync_state", () => {
      void emitTranslationServiceUpdate();
    });

    return () => {
      translationServiceAbortController?.abort();
      void Promise.all([
        unlistenStart,
        unlistenStop,
        unlistenSync,
        unlistenRequest,
      ]).then((unlisteners) => {
        unlisteners.forEach((unlisten) => unlisten());
      });
    };
  });

  type DailyUsage = {
    date: string;
    count: number;
    tokens: number;
  };

  const USAGE_STORAGE_KEY = "howlingual_usage_daily_v1";
  let usageToday = $state<DailyUsage>({ date: "", count: 0, tokens: 0 });
  let weeklyUsage = $state<DailyUsage[]>([]);
  let usageReady = $state(false);

  const usageChartConfig = {
    width: 320,
    height: 200,
    paddingX: 18,
    paddingTop: 18,
    baseline: 140,
    gap: 22,
    barMaxHeight: 92,
    labelY: 186,
  };

  const pad2 = (n: number) => String(n).padStart(2, "0");

  function getDateKey(date: Date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
      date.getDate(),
    )}`;
  }

  function buildEmptyDay(dateKey: string): DailyUsage {
    return { date: dateKey, count: 0, tokens: 0 };
  }

  function loadUsageMap(): Record<string, DailyUsage> {
    try {
      const raw = localStorage.getItem(USAGE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (e) {
      console.warn("[Usage] Failed to load usage stats", e);
    }
    return {};
  }

  function saveUsageMap(map: Record<string, DailyUsage>) {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(map));
  }

  function refreshUsageStats() {
    const map = loadUsageMap();
    const todayKey = getDateKey(new Date());
    if (!map[todayKey]) {
      map[todayKey] = buildEmptyDay(todayKey);
      saveUsageMap(map);
    }

    usageToday = map[todayKey];

    const days: DailyUsage[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = getDateKey(date);
      days.push(map[key] || buildEmptyDay(key));
    }
    weeklyUsage = days;
    usageReady = true;
  }

  function recordUsage(countIncrement: number, tokenIncrement: number) {
    const map = loadUsageMap();
    const todayKey = getDateKey(new Date());
    const current = map[todayKey] || buildEmptyDay(todayKey);
    current.count += countIncrement;
    current.tokens += tokenIncrement;
    map[todayKey] = current;
    saveUsageMap(map);
    refreshUsageStats();
  }

  const shortDate = (dateKey: string) => {
    const [_, m, d] = dateKey.split("-");
    if (!m || !d) return dateKey;
    return `${m}/${d}`;
  };

  let weeklyMaxCount = $derived(
    Math.max(1, ...weeklyUsage.map((d) => d.count)),
  );
  let weeklyMaxTokens = $derived(
    Math.max(1, ...weeklyUsage.map((d) => d.tokens)),
  );

  let usageChartWrapper = $state<HTMLDivElement | null>(null);
  let usageChartViewportWidth = $state(usageChartConfig.width);
  let usageChartMetrics = $derived.by(() => {
    const width = Math.max(
      usageChartConfig.width,
      Math.floor(usageChartViewportWidth || usageChartConfig.width),
    );
    const paddingX = usageChartConfig.paddingX;
    const gap = usageChartConfig.gap;
    const barWidth = Math.max(
      10,
      (width - paddingX * 2 - gap * 6) / 7,
    );
    return { width, paddingX, gap, barWidth };
  });
  let usageHover = $state<{
    x: number;
    y: number;
    day: DailyUsage;
  } | null>(null);

  $effect(() => {
    if (!usageChartWrapper) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const nextWidth = entry.contentRect.width;
        if (nextWidth) {
          usageChartViewportWidth = nextWidth;
        }
      }
    });
    observer.observe(usageChartWrapper);
    return () => observer.disconnect();
  });

  function getTokenLinePoints() {
    return weeklyUsage
      .map((day, i) => {
        const x =
          usageChartMetrics.paddingX +
          i * (usageChartMetrics.barWidth + usageChartMetrics.gap) +
          usageChartMetrics.barWidth / 2;
        const y =
          usageChartConfig.baseline -
          (day.tokens / weeklyMaxTokens) * usageChartConfig.barMaxHeight;
        return `${x},${y}`;
      })
      .join(" ");
  }

  function showUsageHover(event: MouseEvent, day: DailyUsage) {
    if (!usageChartWrapper) return;
    const rect = usageChartWrapper.getBoundingClientRect();
    usageHover = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      day,
    };
  }

  function clearUsageHover() {
    usageHover = null;
  }
  async function startTranslation() {
    if (isTranslating || !inputQuery.trim()) return;
    syncShowTechInfoFromStorage();
    isTranslating = true;
    autoScrollEnabled = true; // Enable auto-scroll for new translation
    showExplanation = false; // Hide explanation during translation
    showSourceLangMenu = false; // Close menu if open
    showTargetLangMenu = false; // Close menu if open
    // Clear content and set slots based on translationCount setting
    const slots: { id: number; text: string; reason: string }[] = [];
    for (let i = 1; i <= translationCount; i++) {
      slots.push({ id: i, text: "", reason: "" });
    }
    translations = slots;
    detailedExplanation = null; // Clear explanation
    errorMessage = "";
    lastStreamCharCount = 0;

    // Handle Auto-detect mock logic
    if (isAutoDetect) {
      // isDetecting = true; // Removed to prevent UI jitter/flash
      // Pre-emptive detection to save tokens on Auto-Switch
      const preDetected = detectLanguageSimple(inputQuery);
      // Update UI immediately (can be overwritten by LLM later)
      detectedLang = preDetected;

      if (!allowRewrite && preDetected === targetLang) {
        console.log(
          `[Auto-Switch] Pre-detected '${preDetected}' matches Target. Switching...`,
        );
        let newTarget = "英語";
        if (preDetected === "英語") newTarget = "日本語";
        else if (preDetected === defaultTargetLang) newTarget = "英語";
        targetLang = newTarget;
      }
    }

    try {
      // Use service-based translation to keep quick/main in sync
      const styleMeta = Object.fromEntries(
        customStyles.map((s) => [s.id, { name: s.name, prompt: s.prompt }]),
      );
      await emit("start_translation_command", {
        text: inputQuery,
        sourceLang,
        targetLang,
        styles: styleLevels,
        styleMeta,
        model: currentModel,
        provider: selectedProvider,
        explanationLang: getLanguageName(appLanguage),
        apiKeys: $state.snapshot(apiKeys),
        initialTokens: Math.ceil(inputQuery.length / 1.5) + 40,
        candidateCount: translationCount,
      });
    } catch (error) {
      console.error("Translation failed:", error);
      errorMessage = "Translation failed: " + String(error);
      isTranslating = false;
    }
  }

  let isHoveringTranslate = $state(false);

  async function stopTranslation() {
    isTranslating = false;
    try {
      await emit("stop_translation_command");
    } catch (e) {
      console.error("Failed to stop translation:", e);
    }
  }

  // Initial load (optional: remove if we want it empty by default)
  // Initial load: Start empty
  $effect(() => {
    // No initial data
  });

  // Cleanup on component destroy
  onDestroy(() => {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
      scrollTimeout = null;
    }
    if (autoScrollRafId !== null) {
      cancelAnimationFrame(autoScrollRafId);
      autoScrollRafId = null;
    }
    if (styleLevelsSaveTimer !== null) {
      clearTimeout(styleLevelsSaveTimer);
      styleLevelsSaveTimer = null;
    }
    if (styleLevelsReady) {
      persistStyleLevels();
    }
    if (handleBeforeUnloadRef) {
      window.removeEventListener("beforeunload", handleBeforeUnloadRef);
    }
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} onresize={checkBottomPosition} />

{#if isCaptureMode}
  <CaptureOverlay {appLanguage} />
{:else if isCompactMode}
  <main class="compact-shell" class:visible={isWindowVisible}>
    <header class="compact-header">
      <div class="compact-brand" data-tauri-drag-region>
        <img
          src={theme === "light" ? "/icon-light.svg" : "/icon-dark.svg"}
          alt="Howlingual"
          class="app-icon compact-icon"
        />
        <span class="compact-name">Howlingual</span>
      </div>

      <!-- Spacer that acts as the main drag handle - CRITICAL for allowing drag without blocking buttons -->
      <div class="header-drag-spacer" data-tauri-drag-region></div>

      <div class="compact-header-actions">
        <button
          class="compact-main-btn"
          onpointerdown={(e) => e.stopPropagation()}
          onmousedown={(e) => e.stopPropagation()}
          onclick={async () => {
            // Stop consuming pending text in this window
            isOpeningMain = true;
            // Use proper handover logic
            await openMainScreen();
          }}
          title={t(appLanguage, "openMain")}
        >
          <span>{t(appLanguage, "openMain")}</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 12h14"></path>
            <path d="M13 5l7 7-7 7"></path>
          </svg>
        </button>
        <button
          class="compact-close-btn"
          onpointerdown={(e) => e.stopPropagation()}
          onmousedown={(e) => e.stopPropagation()}
          onclick={async () => {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().hide();
          }}
          aria-label={t(appLanguage, "closeWindow")}
          title={t(appLanguage, "closeWindow")}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </header>

    <div class="compact-lang-row">
      <!-- Left Actions Group -->
      <div
        class="compact-left-actions"
        class:hidden={isScrolledDown}
      >
        <!-- (Paste/Clear buttons moved inside textarea) -->

        <!-- OCR Button -->
        <button
          class="icon-btn compact-ocr-btn"
          onclick={startOCR}
          title={t(appLanguage, "startOCR") || "画面から文字を読み取る"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <path d="M7 9h10v6H7z" />
          </svg>
        </button>
      </div>
      <div class="lang-selector-group compact-lang-group">
        <div class="lang-selector">
          <button
            class="lang-btn"
            class:open={showSourceLangMenu}
            disabled={isTranslating}
            onclick={(e) => {
              e.stopPropagation();
              showSourceLangMenu = !showSourceLangMenu;
              showTargetLangMenu = false;
            }}
          >
            {#if isAutoDetect}
              <svg
                class="sparkle-icon"
                class:is-active={isSparkling}
                class:is-detecting={isDetecting}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  class="star-1"
                  d="M14 2C14 2 15 8 19 9C15 10 14 16 14 16C14 16 13 10 9 9C13 8 14 2 14 2Z"
                ></path>
                <path
                  class="star-2"
                  d="M6 10C6 10 6.5 13 10 14C6.5 15 6 18 6 18C6 18 5.5 15 2 14C5.5 13 6 10 6 10Z"
                ></path>
                <path
                  class="star-3"
                  d="M17 16C17 16 17.5 18 20 19C17.5 20 17 22 17 22C17 22 16.5 20 14 19C16.5 18 17 16 17 16Z"
                ></path>
              </svg>
            {/if}
            {#if isAutoDetect && detectedLang && translations.length > 0}
              {getTargetLanguageName(appLanguage, detectedLang)} -
              {t(appLanguage, "detected")}
            {:else if isAutoDetect && isDetecting}
              {t(appLanguage, "detecting")}
            {:else if isAutoDetect}
              {t(appLanguage, "autoDetect")}
            {:else}
              {getTargetLanguageName(appLanguage, sourceLang)}
            {/if}
            <svg
              class="chevron-icon"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>
          {#if showSourceLangMenu}
            <div
              class="lang-menu"
              in:fly={{ y: -5, duration: 200 }}
              out:fade={{ duration: 150 }}
            >
              <button
                class="lang-option auto-detect {isAutoDetect ? 'active' : ''}"
                onclick={() => selectSourceLang(null)}
              >
                <svg
                  class="sparkle-icon"
                  class:is-active={isSparkling}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path
                    class="star-1"
                    d="M14 2C14 2 15 8 19 9C15 10 14 16 14 16C14 16 13 10 9 9C13 8 14 2 14 2Z"
                  ></path>
                  <path
                    class="star-2"
                    d="M6 10C6 10 6.5 13 10 14C6.5 15 6 18 6 18C6 18 5.5 15 2 14C5.5 13 6 10 6 10Z"
                  ></path>
                  <path
                    class="star-3"
                    d="M17 16C17 16 17.5 18 20 19C17.5 20 17 22 17 22C17 22 16.5 20 14 19C16.5 18 17 16 17 16Z"
                  ></path>
                </svg>
                {t(appLanguage, "autoDetect")}
              </button>
              <div class="menu-divider"></div>
              {#each languages as lang}
                <button
                  class="lang-option {!isAutoDetect && lang === sourceLang
                    ? 'active'
                    : ''}"
                  onclick={() => selectSourceLang(lang)}
                  >{getTargetLanguageName(appLanguage, lang)}</button
                >
              {/each}
            </div>
          {/if}
        </div>

        <svg
          class="arrow-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M5 12h14M12 5l7 7-7 7"></path>
        </svg>

        <div class="lang-selector">
          <button
            class="lang-btn"
            class:open={showTargetLangMenu}
            disabled={isTranslating}
            onclick={(e) => {
              e.stopPropagation();
              showTargetLangMenu = !showTargetLangMenu;
              showSourceLangMenu = false;
            }}
          >
            {getTargetLanguageName(appLanguage, targetLang)}
            <svg
              class="chevron-icon"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>
          {#if showTargetLangMenu}
            <div
              class="lang-menu"
              in:fly={{ y: -5, duration: 200 }}
              out:fade={{ duration: 150 }}
            >
              {#each languages as lang}
                <button
                  class="lang-option {lang === targetLang ? 'active' : ''}"
                  onclick={() => selectTargetLang(lang)}
                  >{getTargetLanguageName(appLanguage, lang)}</button
                >
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div
      class="scroll-wrapper compact-scroll-wrapper"
      class:at-bottom={isAtBottom}
    >
      <section
        class="main-scroll glass compact-scroll"
        class:is-scrolling={isScrolling}
        bind:this={scrollContainerEl}
        onscroll={onMainScroll}
      >
        <!-- Original Text Input -->
        <div class="input-area compact-input-area">
          <div class="textarea-container" class:has-overflow={showFade}>
            <div class="textarea-actions">
              {#if inputQuery.trim()}
                <button
                  class="textarea-action-btn"
                  onclick={clearInput}
                  title={t(appLanguage, "clearText") || "テキストをクリア"}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              {:else}
                <button
                  class="textarea-action-btn"
                  onclick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) inputQuery = text;
                    } catch (e) {
                      console.error("Failed to read clipboard:", e);
                    }
                  }}
                  title={t(appLanguage, "pasteFromClipboard") ||
                    "クリップボードから貼り付け"}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                    ></path>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                  </svg>
                </button>
              {/if}
            </div>
            <textarea
              bind:this={textareaEl}
              bind:value={inputQuery}
              oninput={handleInputChange}
              onscroll={checkScroll}
              class:long-text={isLongText}
              class="compact-textarea"
              aria-label={t(appLanguage, "inputPlaceholder")}
              placeholder={t(appLanguage, "inputPlaceholder")}
            ></textarea>
            <div class="fade-overlay"></div>
          </div>
        </div>

        <!-- Sticky Controls Bar (morphs based on scroll state) -->
        <div
          class="controls-bar glass compact-controls"
          class:scrolled={isScrolledDown}
        >
          <p class="text-preview" class:visible={isScrolledDown}>
            {inputQuery}
          </p>
          <div class="compact-style-row" class:hidden={isScrolledDown}>
            <!-- Horizontal style chips like main window -->
            <div
              class="styles-row compact-styles-row"
              class:fade-out={isTranslating}
            >
              <div class="style-chip-track compact">
                {#each customStyles.slice(0, 3) as style, i (style.id)}
                  <button
                    class="style-chip"
                    data-level={styleLevels[style.id] || 0}
                    onclick={() => cycleLevel(style.id)}
                    onpointerdown={(e) => handleDrag(style.id, e)}
                    in:fly={{
                      y: 10,
                      duration: 250,
                      delay: isWindowVisible ? i * 50 : 0,
                      easing: quintOut,
                    }}
                  >
                    <span
                      class="chip-fill"
                      style="width: {(styleLevels[style.id] || 0) * 50}%"
                    ></span>
                    <span class="chip-text">{style.name}</span>
                  </button>
                {/each}
              </div>

              {#if customStyles.length > 3}
                <div class="style-dropdown-wrapper">
                  <button
                    class="style-chip add-chip"
                    onclick={() => (compactStylesOpen = !compactStylesOpen)}
                    class:active={compactStylesOpen}
                  >
                    ･･･
                  </button>
                  {#if compactStylesOpen}
                    <div
                      class="style-dropdown glass"
                      transition:fade={{ duration: 100 }}
                    >
                      {#each customStyles.slice(3) as style (style.id)}
                        <button
                          class="dropdown-item"
                          data-level={styleLevels[style.id] || 0}
                          onclick={(e) => {
                            e.stopPropagation();
                            cycleLevel(style.id);
                          }}
                          onpointerdown={(e) => handleDrag(style.id, e)}
                        >
                          <span
                            class="dropdown-item-fill"
                            style="width: {(styleLevels[style.id] || 0) * 50}%"
                          ></span>
                          <div class="dropdown-item-content">
                            <span>{style.name}</span>
                          </div>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>

          <button
            class="action-btn"
            class:translate-mode={!isScrolledDown}
            class:scroll-mode={isScrolledDown}
            class:loading={!isScrolledDown &&
              isTranslating &&
              !isHoveringTranslate}
            class:stop-mode={!isScrolledDown &&
              isTranslating &&
              isHoveringTranslate}
            title={isScrolledDown
              ? t(appLanguage, "scrollToTop")
              : isTranslating
                ? t(appLanguage, "stopTranslation") || "翻訳を停止"
                : t(appLanguage, "translate")}
            onclick={isScrolledDown
              ? scrollToTop
              : isTranslating
                ? stopTranslation
                : startTranslation}
            disabled={!isScrolledDown && !isTranslating && !inputQuery.trim()}
            onmouseenter={() => (isHoveringTranslate = true)}
            onmouseleave={() => (isHoveringTranslate = false)}
          >
            {#if isScrolledDown}
              <svg
                class="btn-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m18 15-6-6-6 6" />
              </svg>
            {:else if isTranslating && isHoveringTranslate}
              <svg
                class="btn-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="0"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            {:else if isTranslating}
              <span class="loading-spinner"></span>
            {:else}
              <svg
                class="btn-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m5 8 6 6" />
                <path d="m4 14 6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
            {/if}
          </button>
        </div>

        {#if showTechInfo && (isTranslating || techMetrics.time > 0)}
          <div class="tech-info-display" transition:fade>
            <div class="tech-row">
              <span class="tech-item">
                <span class="tech-label">Wait:</span>
                {#if isTranslating && !techMetrics.firstTokenReceived}
                  {techMetrics.time.toFixed(1)}s
                {:else}
                  {techMetrics.waitTime.toFixed(2)}s
                {/if}
              </span>
              {#if techMetrics.streamMode}
                <span class="tech-divider">→</span>
                <span class="tech-item">
                  <span class="tech-label">Gen:</span>
                  {#if isTranslating}
                    {techMetrics.genTime.toFixed(1)}s
                  {:else}
                    {techMetrics.genTime.toFixed(2)}s
                  {/if}
                </span>
              {/if}
              <span class="tech-divider">=</span>
              <span class="tech-item">
                <span class="tech-label">Total:</span>
                {techMetrics.time.toFixed(1)}s
              </span>
            </div>
            <div class="tech-row">
              <span class="tech-item">
                <span class="tech-label">Model:</span>
                {techMetrics.model}
              </span>
              <span class="tech-divider">|</span>
              <span class="tech-item tech-tokens">
                <span class="token-row">
                  <span class="tech-label">↑</span>
                  {#if isTranslating && !techMetrics.isReal}
                    <span class="loading-dots-inline">...</span>
                  {:else}
                    {techMetrics.inputTokens}
                  {/if}
                </span>
                <span class="token-row">
                  <span class="tech-label">↓</span>
                  {#if isTranslating && !techMetrics.isReal}
                    <span class="loading-dots-inline">...</span>
                  {:else}
                    {techMetrics.outputTokens}
                  {/if}
                  {#if techMetrics.tokensPerSec > 0}
                    <span style="opacity: 0.6; margin-left: 4px;"
                      >({techMetrics.tokensPerSec.toFixed(1)}/s)</span
                    >
                  {/if}
                </span>
              </span>
            </div>
          </div>
        {/if}

        <!-- Error Display -->
        {#if errorMessage}
          <div class="error-display">
            <div class="error-icon-wrapper">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="error-icon"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p class="error-message">{errorMessage}</p>
          </div>
        {/if}

        <!-- Translation Results -->
        <div class="output-area compact-output">
          {#each translations as item, i (item.id)}
            <!-- Show if expanded OR if it's the first item -->
            {#if isCompactMode ? isStackExpanded || i === 0 : true}
              <div class="candidate-card" out:fade={{ duration: 200 }}>
                <div class="card-inner-content">
                  {#if isTranslating && !item.text}
                    <div
                      class="skeleton-line primary"
                      style="margin-top: 8px;"
                    ></div>
                    <div class="skeleton-line secondary"></div>
                  {:else}
                    <p class="translated-text">{item.text}</p>
                  {/if}
                  <div class="card-footer">
                    {#if item.reason}
                      <p class="reason">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          style="flex-shrink: 0; margin-top: 2px;"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="16" x2="12" y2="12"></line>
                          <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                        <span>{item.reason}</span>
                      </p>
                    {/if}
                    <div class="candidate-actions" class:hide={!item.text}>
                      <button
                        class="icon-btn replace-btn"
                        class:replaced={replacedId === item.id}
                        title={t(appLanguage, "replaceSelection")}
                        disabled={!canReplaceSelection}
                        onclick={() => handleReplace(item.id, item.text)}
                      >
                        {#if replacedId === item.id}
                          <svg
                            class="check-icon"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        {:else}
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <path d="M16 3l5 5-11 11H5v-5L16 3z"></path>
                            <path d="M15 5l4 4"></path>
                          </svg>
                        {/if}
                      </button>
                      <div class="action-menu">
                        <button
                          class="icon-btn action-menu-trigger"
                          title={t(appLanguage, "moreActions")}
                          aria-expanded={actionMenuOpenId === item.id}
                          onclick={() => toggleActionMenu(item.id)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <circle cx="12" cy="6" r="1.5"></circle>
                            <circle cx="12" cy="12" r="1.5"></circle>
                            <circle cx="12" cy="18" r="1.5"></circle>
                          </svg>
                        </button>
                        {#if actionMenuOpenId === item.id}
                          <div
                            class="action-menu-dropdown glass"
                            transition:fade={{ duration: 120 }}
                          >
                            <button
                              class="action-menu-item copy-item"
                              class:animating={copyAnimating[item.id]}
                              class:copied={copiedId === item.id}
                              onclick={() => handleCopy(item.id, item.text)}
                              onmouseenter={() => triggerCopyAnim(item.id)}
                            >
                              <span class="action-menu-icon">
                                {#if copiedId === item.id}
                                  <svg
                                    class="check-icon"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2.5"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                  >
                                    <polyline points="20 6 9 17 4 12"
                                    ></polyline>
                                  </svg>
                                {:else}
                                  <svg
                                    class="copy-icon"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                  >
                                    <rect
                                      x="9"
                                      y="9"
                                      width="13"
                                      height="13"
                                      rx="2"
                                      ry="2"
                                    ></rect>
                                    <path
                                      d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                                    ></path>
                                  </svg>
                                {/if}
                              </span>
                              <span>{t(appLanguage, "copy")}</span>
                            </button>
                            <button
                              class="action-menu-item speak-item"
                              class:active={isSpeakingId === item.id}
                              class:animating={speakAnimating[item.id]}
                              onclick={() =>
                                handleSpeak(item.id, item.text, targetLang)}
                              onmouseenter={() => triggerSpeakAnim(item.id)}
                              disabled={!ttsAvailable}
                            >
                              <span class="action-menu-icon">
                                {#if isSpeakingId === item.id}
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    stroke="none"
                                  >
                                    <rect
                                      x="6"
                                      y="6"
                                      width="12"
                                      height="12"
                                      rx="1"
                                    />
                                  </svg>
                                {:else}
                                  <svg
                                    class="speak-icon"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    style="overflow: visible;"
                                  >
                                    <polygon
                                      points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"
                                    ></polygon>
                                    <path
                                      class="sound-wave wave-1"
                                      d="M15.54 8.46a5 5 0 0 1 0 7.07"
                                    ></path>
                                    <path
                                      class="sound-wave wave-2"
                                      d="M19.07 4.93a10 10 0 0 1 0 14.14"
                                    ></path>
                                    <path
                                      class="sound-wave wave-3"
                                      d="M22.07 1.93a14 14 0 0 1 0 20.14"
                                    ></path>
                                  </svg>
                                {/if}
                              </span>
                              <span>
                                {isSpeakingId === item.id
                                  ? t(appLanguage, "stop")
                                  : t(appLanguage, "speak")}
                              </span>
                            </button>
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          {/each}

          <!-- Stack Indicator -->
          {#if isCompactMode && !isStackExpanded && (translations.filter((t) => t.text).length > 1 || (detailedExplanation && detailedExplanation.points && detailedExplanation.points.length > 0))}
            <button
              class="stack-indicator"
              onclick={() => (isStackExpanded = true)}
              title={t(appLanguage, "showMore") || "もっと見る"}
            >
              <div class="stack-layer layer-1"></div>
              <div class="stack-layer layer-2"></div>
              <span class="stack-text">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><polyline points="6 9 12 15 18 9"></polyline></svg
                >
              </span>
            </button>
          {/if}
          {#if isCompactMode && isStackExpanded}
            <div class="stack-collapse-row">
              <button
                class="collapse-btn"
                onclick={() => (isStackExpanded = false)}
                title={t(appLanguage, "showLess")}
              >
                {t(appLanguage, "showLess")}
              </button>
            </div>
          {/if}

          <!-- Explanation -->
          {#if (!isCompactMode || isStackExpanded) && detailedExplanation && detailedExplanation.points && detailedExplanation.points.length > 0}
            <div class="explanation-card" transition:fade={{ duration: 200 }}>
              <h3>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="sparkle-icon"
                >
                  <path
                    d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
                  />
                  <path d="M20 3v4" />
                  <path d="M22 5h-4" />
                  <path d="M4 17v2" />
                  <path d="M5 18H3" />
                </svg>
                {t(appLanguage, "explanation")}
              </h3>
              <ul class="explanation-list">
                {#each detailedExplanation.points as point}
                  <li>
                    <strong>{point.term}</strong>: {point.explanation}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          <!-- Bottom Favorite Button (Small) -->
          {#if translations.some((t) => t.text) && !isTranslating}
            <div
              class="favorite-action-row"
            >
              <button
                class="save-favorite-btn"
                class:active={isFavorited(inputQuery)}
                class:animating={starAnimatingId === "current"}
                onclick={() => {
                    const itemToSave = {
                      id: crypto.randomUUID(),
                      timestamp: Date.now(),
                      sourceText: inputQuery,
                      sourceLang: detectedLang || sourceLang,
                      targetLang: targetLang,
                      isAutoDetect: isAutoDetect,
                      detectedLang: detectedLang || "",
                      translations: translations.map((t) => ({
                        text: t.text,
                        reason: t.reason,
                      })),
                    detailedExplanation: detailedExplanation
                      ? $state.snapshot(detailedExplanation)
                      : undefined,
                    styleLevels: $state.snapshot(styleLevels),
                  };
                  toggleFavorite(itemToSave);
                  if (starAnimatingId === "") triggerStarAnim("current");
                }}
                aria-label={t(appLanguage, "favoriteCurrentTranslation")}
              >
                <svg
                  class="save-star-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill={isFavorited(inputQuery) ? "currentColor" : "none"}
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polygon
                    points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                  ></polygon>
                </svg>
                <span class="save-label"
                  >{t(appLanguage, "saveToFavorites")}</span
                >
              </button>
            </div>
          {/if}
        </div>
      </section>
      <div
        class="scroll-indicator"
        class:visible={isScrolling}
        style="top: {scrollThumbTop}px; height: {scrollThumbHeight}px;"
      ></div>
    </div>
  </main>
{:else}
  <main class="container" class:visible={isWindowVisible}>
    <!-- App Header -->
    <!-- App Header -->
    <header class="app-header" class:mac-padding={isMac} data-tauri-drag-region>
      <div class="header-left" data-tauri-drag-region>
        <img
          src={theme === "light" ? "/icon-light.svg" : "/icon-dark.svg"}
          alt="Howlingual"
          class="app-icon"
        />
        <h1 class="app-title">Howlingual</h1>
      </div>

      <!-- Spacer that acts as the main drag handle -->
      <div class="header-drag-spacer" data-tauri-drag-region></div>
    </header>

    <!-- Header Right Actions -->
    <div class="header-right-standalone">
      <button
        class="icon-btn header-btn history-btn"
        class:animating={historyAnimating}
        title={t(appLanguage, "history")}
        onclick={openHistory}
        onmouseenter={triggerHistoryAnim}
      >
        <svg
          class="history-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <polyline class="clock-hands" points="12 6 12 12 16 14"></polyline>
        </svg>
      </button>
      <button
        class="icon-btn header-btn settings-btn"
        class:animating={settingsAnimating}
        title={t(appLanguage, "settings")}
        onclick={openSettings}
        onmouseenter={triggerSettingsAnim}
      >
        <svg
          class="settings-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3"></circle>
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
          ></path>
        </svg>
      </button>
      {#if isWindows}
        <div
          class="window-controls-inline"
          onpointerdown={(e) => e.stopPropagation()}
        >
          <button
            class="win-btn-inline minimize"
            onclick={() => getCurrentWindow().minimize()}
            title={t(appLanguage, "minimizeWindow")}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><line x1="5" y1="12" x2="19" y2="12"></line></svg
            >
          </button>
          <button
            class="win-btn-inline maximize"
            onclick={() => getCurrentWindow().toggleMaximize()}
            title={t(appLanguage, "maximizeWindow")}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><polyline points="15 3 21 3 21 9"></polyline><polyline
                points="9 21 3 21 3 15"
              ></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line
                x1="3"
                y1="21"
                x2="10"
                y2="14"
              ></line></svg
            >
          </button>
          <button
            class="win-btn-inline close"
            onclick={() => hideWindow()}
            title={t(appLanguage, "closeWindow")}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><line x1="18" y1="6" x2="6" y2="18"></line><line
                x1="6"
                y1="6"
                x2="18"
                y2="18"
              ></line></svg
            >
          </button>
        </div>
      {/if}
    </div>

    <!-- Language Selector Row - Moved outside of scroll area -->
    <div
      class="header-actions-row"
    >
      <!-- (Clipboard/Clear buttons moved inside textarea) -->

      <div
        class="lang-selector-group"
      >
        <div class="lang-selector">
          <button
            class="lang-btn"
            class:open={showSourceLangMenu}
            disabled={isTranslating}
            onclick={(e) => {
              e.stopPropagation();
              showSourceLangMenu = !showSourceLangMenu;
              showTargetLangMenu = false;
            }}
          >
            {#if isAutoDetect}
              <svg
                class="sparkle-icon"
                class:is-active={isSparkling}
                class:is-detecting={isDetecting}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  class="star-1"
                  d="M14 2C14 2 15 8 19 9C15 10 14 16 14 16C14 16 13 10 9 9C13 8 14 2 14 2Z"
                ></path>
                <path
                  class="star-2"
                  d="M6 10C6 10 6.5 13 10 14C6.5 15 6 18 6 18C6 18 5.5 15 2 14C5.5 13 6 10 6 10Z"
                ></path>
                <path
                  class="star-3"
                  d="M17 16C17 16 17.5 18 20 19C17.5 20 17 22 17 22C17 22 16.5 20 14 19C16.5 18 17 16 17 16Z"
                ></path>
              </svg>
            {/if}
            {#if isAutoDetect && detectedLang}
              {getTargetLanguageName(appLanguage, detectedLang)} -
              {t(appLanguage, "detected")}
            {:else if isAutoDetect && isDetecting}
              <span class="detecting-label">
                {t(appLanguage, "detecting")}
              </span>
            {:else if isAutoDetect}
              {t(appLanguage, "autoDetect")}
            {:else}
              {getTargetLanguageName(appLanguage, sourceLang)}
            {/if}
            <svg
              class="chevron-icon"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>
          {#if showSourceLangMenu}
            <div
              class="lang-menu"
              in:fly={{ y: -5, duration: 200 }}
              out:fade={{ duration: 150 }}
            >
              <button
                class="lang-option auto-detect {isAutoDetect ? 'active' : ''}"
                onclick={() => selectSourceLang(null)}
              >
                <svg
                  class="sparkle-icon"
                  class:is-active={isSparkling}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path
                    class="star-1"
                    d="M14 2C14 2 15 8 19 9C15 10 14 16 14 16C14 16 13 10 9 9C13 8 14 2 14 2Z"
                  ></path>
                  <path
                    class="star-2"
                    d="M6 10C6 10 6.5 13 10 14C6.5 15 6 18 6 18C6 18 5.5 15 2 14C5.5 13 6 10 6 10Z"
                  ></path>
                  <path
                    class="star-3"
                    d="M17 16C17 16 17.5 18 20 19C17.5 20 17 22 17 22C17 22 16.5 20 14 19C16.5 18 17 16 17 16Z"
                  ></path>
                </svg>
                {t(appLanguage, "autoDetect")}
              </button>
              <div class="menu-divider"></div>
              {#each languages as lang}
                <button
                  class="lang-option {!isAutoDetect && lang === sourceLang
                    ? 'active'
                    : ''}"
                  onclick={() => selectSourceLang(lang)}
                  >{getTargetLanguageName(appLanguage, lang)}</button
                >
              {/each}
            </div>
          {/if}
        </div>

        <svg
          class="arrow-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M5 12h14M12 5l7 7-7 7"></path>
        </svg>

        <div class="lang-selector">
          <button
            class="lang-btn"
            class:open={showTargetLangMenu}
            disabled={isTranslating}
            onclick={(e) => {
              e.stopPropagation();
              showTargetLangMenu = !showTargetLangMenu;
              showSourceLangMenu = false;
            }}
          >
            {getTargetLanguageName(appLanguage, targetLang)}
            <svg
              class="chevron-icon"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>
          {#if showTargetLangMenu}
            <div
              class="lang-menu"
              in:fly={{ y: -5, duration: 200 }}
              out:fade={{ duration: 150 }}
            >
              {#each languages as lang}
                <button
                  class="lang-option {lang === targetLang ? 'active' : ''}"
                  onclick={() => selectTargetLang(lang)}
                  >{getTargetLanguageName(appLanguage, lang)}</button
                >
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Unified Scroll Container -->
    <div class="scroll-wrapper" class:at-bottom={isAtBottom}>
      <section
        class="main-scroll glass"
        class:is-scrolling={isScrolling}
        bind:this={scrollContainerEl}
        onscroll={onMainScroll}
      >
        <!-- Original Text Input -->
        <div class="input-area">
          <div class="textarea-container" class:has-overflow={showFade}>
            <div class="textarea-actions">
              {#if inputQuery.trim()}
                <button
                  class="textarea-action-btn"
                  onclick={() => (inputQuery = "")}
                  title={t(appLanguage, "clearText") || "テキストをクリア"}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              {:else}
                <button
                  class="textarea-action-btn"
                  onclick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) inputQuery = text;
                    } catch (e) {
                      console.error("Failed to read clipboard:", e);
                    }
                  }}
                  title={t(appLanguage, "pasteFromClipboard") ||
                    "クリップボードから貼り付け"}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                    ></path>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                  </svg>
                </button>
              {/if}
            </div>
            <textarea
              bind:this={textareaEl}
              bind:value={inputQuery}
              oninput={handleInputChange}
              onscroll={checkScroll}
              class:long-text={isLongText}
              aria-label={t(appLanguage, "inputPlaceholder")}
              placeholder={t(appLanguage, "inputPlaceholder")}
            ></textarea>
            <div class="fade-overlay"></div>
          </div>
        </div>

        <!-- Sticky Controls Bar (morphs based on scroll state) -->
        <div class="controls-bar glass" class:scrolled={isScrolledDown}>
          <!-- Scrolled state: show text preview -->
          <p class="text-preview" class:visible={isScrolledDown}>
            {inputQuery}
          </p>
          <!-- Default state: show style chips -->
          <div
            class="styles-row"
            class:fade-out={isTranslating}
            class:hidden={isScrolledDown}
            bind:this={styleContainerRef}
          >
            <!-- Clipper Container for smooth "infinite" feel -->
            <div class="style-chip-track main">
              {#each visibleStyles as style, i (style.id)}
                <button
                  class="style-chip"
                  data-level={styleLevels[style.id] || 0}
                  onclick={() => cycleLevel(style.id)}
                  onpointerdown={(e) => handleDrag(style.id, e)}
                  animate:flip={{ duration: 300, easing: quintOut }}
                  in:fly={{
                    y: 10,
                    duration: 250,
                    delay: isWindowVisible ? i * 50 : 0,
                    easing: quintOut,
                  }}
                  out:send={{ key: style.id }}
                >
                  <span
                    class="chip-fill"
                    style="width: {(styleLevels[style.id] || 0) * 50}%"
                  ></span>
                  <span class="chip-text">{style.name}</span>
                </button>
              {/each}
            </div>

            <div class="style-dropdown-wrapper">
              <button
                class="style-chip add-chip"
                onclick={() => (styleOverflowOpen = !styleOverflowOpen)}
                class:active={styleOverflowOpen}
                class:has-active={hasActiveHiddenStyles}
              >
                ･･･
              </button>
              {#if styleOverflowOpen}
                <div
                  class="style-dropdown glass"
                  transition:fade={{ duration: 100 }}
                >
                  {#if hiddenStyles.length > 0}
                    <div class="dropdown-section-label">
                      {t(appLanguage, "tabStyles")}
                    </div>
                    {#each hiddenStyles as style (style.id)}
                      <button
                        class="dropdown-item"
                        data-level={styleLevels[style.id] || 0}
                        onclick={() => cycleLevel(style.id)}
                        onpointerdown={(e) => handleDrag(style.id, e)}
                        animate:flip={{
                          duration: 300,
                          easing: quintOut,
                        }}
                        in:receive={{ key: style.id }}
                        out:send={{ key: style.id }}
                      >
                        <span
                          class="dropdown-item-fill"
                          style="width: {(styleLevels[style.id] || 0) * 50}%"
                        ></span>
                        <div class="dropdown-item-content">
                          <span>{style.name}</span>
                        </div>
                      </button>
                    {/each}
                    <div class="dropdown-divider"></div>
                  {/if}
                  <button
                    class="dropdown-item settings-link"
                    onclick={() => {
                      styleOverflowOpen = false;
                      openStyles();
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      class="icon-left"
                    >
                      <path d="M12 20h9"></path>
                      <path
                        d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                      ></path>
                    </svg>
                    {t(appLanguage, "settingsTitle")}
                  </button>
                </div>
              {/if}
            </div>
          </div>

          <!-- OCR Button (Main) -->
          <button
            class="action-btn ocr-main-btn ocr-btn-animated"
            class:hidden={isScrolledDown}
            onclick={startOCR}
            title={t(appLanguage, "startOCR") || "画面から文字を読み取る"}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 7V5a2 2 0 0 1 2-2h2" />
              <path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
              <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <path d="M7 9h10v6H7z" />
            </svg>
          </button>

          <!-- Single action button that morphs -->
          <button
            class="action-btn translate-btn-animated"
            class:translate-mode={!isScrolledDown}
            class:scroll-mode={isScrolledDown}
            class:loading={!isScrolledDown &&
              isTranslating &&
              !isHoveringTranslate}
            class:stop-mode={!isScrolledDown &&
              isTranslating &&
              isHoveringTranslate}
            title={isScrolledDown
              ? t(appLanguage, "scrollToTop")
              : isTranslating
                ? t(appLanguage, "stopTranslation") || "翻訳を停止"
                : t(appLanguage, "translate")}
            onclick={isScrolledDown
              ? scrollToTop
              : isTranslating
                ? stopTranslation
                : startTranslation}
            disabled={!isScrolledDown && !isTranslating && !inputQuery.trim()}
            onmouseenter={() => (isHoveringTranslate = true)}
            onmouseleave={() => (isHoveringTranslate = false)}
            class:hidden={!isScrolledDown &&
              !isTranslating &&
              !inputQuery.trim()}
          >
            {#if isScrolledDown}
              <svg
                class="btn-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m18 15-6-6-6 6" />
              </svg>
            {:else if isTranslating && isHoveringTranslate}
              <svg
                class="btn-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="0"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            {:else if isTranslating}
              <span class="loading-spinner"></span>
            {:else}
              <svg
                class="btn-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m5 8 6 6" />
                <path d="m4 14 6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="m22 22-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
            {/if}
          </button>
        </div>

        {#if showTechInfo && (isTranslating || techMetrics.time > 0)}
          <div class="tech-info-display" transition:fade>
            <span class="tech-item">
              <span class="tech-label">Wait:</span>
              {#if isTranslating && !techMetrics.firstTokenReceived}
                {techMetrics.time.toFixed(1)}s
              {:else}
                {techMetrics.waitTime.toFixed(2)}s
              {/if}
            </span>
            {#if techMetrics.streamMode}
              <span class="tech-divider">→</span>
              <span class="tech-item">
                <span class="tech-label">Gen:</span>
                {#if isTranslating}
                  {techMetrics.genTime.toFixed(1)}s
                {:else}
                  {techMetrics.genTime.toFixed(2)}s
                {/if}
              </span>
            {/if}
            <span class="tech-divider">=</span>
            <span class="tech-item">
              <span class="tech-label">Total:</span>
              {techMetrics.time.toFixed(1)}s
            </span>
            <span class="tech-divider">|</span>
            <span class="tech-item">
              <span class="tech-label">Model:</span>
              {techMetrics.model}
            </span>
            <span class="tech-divider">|</span>
            <span class="tech-item tech-tokens">
              <span class="token-row">
                <span class="tech-label">In:</span>
                {#if isTranslating && !techMetrics.isReal}
                  <div
                    class="skeleton-line"
                    style="width: 40px; display: inline-block; vertical-align: middle;"
                  ></div>
                {:else}
                  {techMetrics.inputTokens}
                {/if}
              </span>
              <span class="token-row">
                <span class="tech-label">Out:</span>
                {#if isTranslating && !techMetrics.isReal}
                  <div
                    class="skeleton-line"
                    style="width: 40px; display: inline-block; vertical-align: middle;"
                  ></div>
                {:else}
                  {techMetrics.outputTokens}
                {/if}
                {#if techMetrics.tokensPerSec > 0}
                  <span style="opacity: 0.6; margin-left: 4px;"
                    >({techMetrics.tokensPerSec.toFixed(1)}/s)</span
                  >
                {/if}
              </span>
            </span>
          </div>
        {/if}

        <!-- Error Display -->
        {#if errorMessage}
          <div class="error-display">
            <div class="error-icon-wrapper">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="error-icon"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p class="error-message">{errorMessage}</p>
          </div>
        {/if}

        <!-- Translation Results -->
        <div class="output-area">
          {#if !isTranslating && !inputQuery.trim() && translations.every((t) => !t.text)}
            <!-- Empty State - No Input -->
            <div
              class="empty-state-container horizontal"
              in:fade={{ duration: 300 }}
            >
              <div class="empty-state-content">
                <h3 class="empty-title">
                  {t(appLanguage, "emptyTitle")}
                </h3>
                <p class="empty-description">
                  {t(appLanguage, "emptyDescription")}
                </p>
              </div>
              <div class="empty-hints vertical">
                <div class="empty-hint">
                  <span class="hint-icon">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect x="2" y="4" width="20" height="16" rx="2" ry="2"
                      ></rect><line x1="6" y1="8" x2="6" y2="8"></line><line
                        x1="10"
                        y1="8"
                        x2="10"
                        y2="8"
                      ></line><line x1="14" y1="8" x2="14" y2="8"></line><line
                        x1="18"
                        y1="8"
                        x2="18"
                        y2="8"
                      ></line><line x1="6" y1="12" x2="6" y2="12"></line><line
                        x1="10"
                        y1="12"
                        x2="10"
                        y2="12"
                      ></line><line x1="14" y1="12" x2="14" y2="12"></line><line
                        x1="18"
                        y1="12"
                        x2="18"
                        y2="12"
                      ></line><line x1="6" y1="16" x2="18" y2="16"></line></svg
                    >
                  </span>
                  <span>{t(appLanguage, "emptyHintType")}</span>
                </div>
                <div class="empty-hint">
                  <span class="hint-icon">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path
                        d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                      ></path><rect
                        x="8"
                        y="2"
                        width="8"
                        height="4"
                        rx="1"
                        ry="1"
                      ></rect></svg
                    >
                  </span>
                  <span>{t(appLanguage, "emptyHintPaste")}</span>
                </div>
                <div class="empty-hint">
                  <span class="hint-icon">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path
                        d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
                      ></path><circle cx="12" cy="13" r="4"></circle></svg
                    >
                  </span>
                  <span>{t(appLanguage, "emptyHintOcr")}</span>
                </div>
              </div>
            </div>
          {:else if isTranslating && translations.every((t) => !t.text)}
            <!-- Loading State -->
            <div class="loading-state-container" in:fade={{ duration: 200 }}>
              <div
                class="shortcut-hint"
                style="margin-bottom: 8px; text-align: center;"
              >
                {techMetrics.firstTokenReceived
                  ? "ストリーム受信中..."
                  : "ストリーム待機中..."}
                {#if techMetrics.time > 0}
                  <span style="margin-left: 6px;"
                    >({techMetrics.time.toFixed(1)}s)</span
                  >
                {/if}
              </div>
              {#each Array.from({ length: translationCount }, (_, i) => i + 1) as idx}
                <div
                  class="skeleton-card"
                  style="animation-delay: {idx * 0.1}s"
                >
                  <div class="skeleton-line primary"></div>
                  <div class="skeleton-line secondary"></div>
                </div>
              {/each}
            </div>
          {:else}
            {#each translations as item (item.id)}
              <div class="candidate-card" out:fade={{ duration: 200 }}>
                <div class="card-inner-content">
                  {#if isTranslating && !item.text}
                    <div
                      class="skeleton-line primary"
                      style="margin-top: 8px;"
                    ></div>
                    <div class="skeleton-line secondary"></div>
                  {:else}
                    <p class="translated-text">{item.text}</p>
                  {/if}
                  <div class="card-footer">
                    {#if item.reason}
                      <p class="reason">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          style="flex-shrink: 0; margin-top: 2px;"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="16" x2="12" y2="12"></line>
                          <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                        <span>{item.reason}</span>
                      </p>
                    {/if}
                    <div
                      class="candidate-actions"
                      class:hide={!item.text}
                      style="gap: 4px;"
                    >
                      <!-- Speak Button -->
                      <button
                        class="icon-btn"
                        class:active={isSpeakingId === item.id}
                        class:animating={speakAnimating[item.id]}
                        title={isSpeakingId === item.id
                          ? t(appLanguage, "stop")
                          : t(appLanguage, "speak")}
                        onclick={() =>
                          handleSpeak(item.id, item.text, targetLang)}
                        onmouseenter={() => triggerSpeakAnim(item.id)}
                      >
                        {#if isSpeakingId === item.id}
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="none"
                          >
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                          </svg>
                        {:else}
                          <svg
                            class="speak-icon"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            style="overflow: visible;"
                          >
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"
                            ></polygon>
                            <path
                              class="sound-wave wave-1"
                              d="M15.54 8.46a5 5 0 0 1 0 7.07"
                            ></path>
                            <path
                              class="sound-wave wave-2"
                              d="M19.07 4.93a10 10 0 0 1 0 14.14"
                            ></path>
                            <path
                              class="sound-wave wave-3"
                              d="M22.07 1.93a14 14 0 0 1 0 20.14"
                            ></path>
                          </svg>
                        {/if}
                      </button>

                      <!-- Copy Button -->
                      <button
                        class="icon-btn"
                        class:animating={copyAnimating[item.id]}
                        class:copied={copiedId === item.id}
                        title={t(appLanguage, "copy")}
                        onclick={() => handleCopy(item.id, item.text)}
                        onmouseenter={() => triggerCopyAnim(item.id)}
                      >
                        {#if copiedId === item.id}
                          <svg
                            class="check-icon"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        {:else}
                          <svg
                            class="copy-icon"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <rect
                              x="9"
                              y="9"
                              width="13"
                              height="13"
                              rx="2"
                              ry="2"
                            ></rect>
                            <path
                              d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                            ></path>
                          </svg>
                        {/if}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          {/if}

          <!-- Explanation -->
          {#if detailedExplanation && detailedExplanation.points && detailedExplanation.points.length > 0}
            <div class="explanation-card" transition:fade={{ duration: 200 }}>
              <h3>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="sparkle-icon"
                >
                  <path
                    d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
                  />
                  <path d="M20 3v4" />
                  <path d="M22 5h-4" />
                  <path d="M4 17v2" />
                  <path d="M5 18H3" />
                </svg>
                {t(appLanguage, "explanation")}
              </h3>
              <ul class="explanation-list">
                {#each detailedExplanation.points as point}
                  <li>
                    <strong>{point.term}</strong>: {point.explanation}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          <!-- Bottom Favorite Button (Small) -->
          {#if translations.some((t) => t.text) && !isTranslating}
            <div
              class="favorite-action-row"
            >
              <button
                class="save-favorite-btn"
                class:active={isFavorited(inputQuery)}
                class:animating={starAnimatingId === "current"}
                onclick={() => {
                  const itemToSave = {
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    sourceText: inputQuery,
                    sourceLang: detectedLang || sourceLang,
                    targetLang: targetLang,
                    translations: translations.map((t) => ({
                      text: t.text,
                      reason: t.reason,
                    })),
                    detailedExplanation: detailedExplanation
                      ? $state.snapshot(detailedExplanation)
                      : undefined,
                    styleLevels: $state.snapshot(styleLevels),
                  };
                  toggleFavorite(itemToSave);
                  if (starAnimatingId === "") triggerStarAnim("current");
                }}
                aria-label={t(appLanguage, "favoriteCurrentTranslation")}
              >
                <svg
                  class="save-star-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill={isFavorited(inputQuery) ? "currentColor" : "none"}
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polygon
                    points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                  ></polygon>
                </svg>
                <span class="save-label"
                  >{t(appLanguage, "saveToFavorites")}</span
                >
              </button>
            </div>
          {/if}
        </div>
      </section>
      <!-- Custom scrollbar indicator with fade animation -->
      <div
        class="scroll-indicator"
        class:visible={isScrolling}
        style="top: {scrollThumbTop}px; height: {scrollThumbHeight}px;"
      ></div>
    </div>
  </main>
{/if}

<!-- Settings Modal -->
{#if showSettings && !isCompactMode && !isCaptureMode}
  <div
    class="settings-overlay"
    transition:fade={{ duration: 200 }}
  >
    <button
      type="button"
      class="overlay-dismiss"
      aria-label={t(appLanguage, "close")}
      onclick={closeSettings}
      tabindex="-1"
    ></button>
    <div
      class="settings-panel glass history-panel"
      class:style-editor-mode={!!editingStyle}
      transition:fly={{ y: 20, duration: 300 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      {#if editingStyle}
        <!-- Dedicated Style Editor View -->
        <div class="settings-header">
          <button
            class="back-btn"
            onclick={cancelEditStyle}
            aria-label={t(appLanguage, "back")}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <h2 id="settings-title">
            {editingStyle.id !== "" &&
            customStyles.some((s) => s.id === editingStyle?.id)
              ? t(appLanguage, "editStyle") || "文体を編集"
              : t(appLanguage, "addStyle")}
          </h2>
          <div style="width: 20px;"></div>
        </div>

        <div class="settings-content style-editor-content">
          <div class="settings-section">
            <label class="settings-label" for="edit-style-name">
              {t(appLanguage, "styleName")}
            </label>
            <input
              id="edit-style-name"
              type="text"
              class="settings-input"
              bind:value={editingStyle.name}
              placeholder={t(appLanguage, "styleName")}
              oninput={() => {
                if (editingStyle) editingStyle.isDefault = false;
              }}
            />
          </div>

          <div class="settings-section full-height">
            <label class="settings-label" for="edit-style-prompt">
              {t(appLanguage, "stylePrompt")}
            </label>
            <textarea
              id="edit-style-prompt"
              class="settings-textarea"
              bind:value={editingStyle.prompt}
              placeholder={t(appLanguage, "stylePrompt")}
              oninput={() => {
                if (editingStyle) editingStyle.isDefault = false;
              }}
            ></textarea>
            <p class="input-hint">
              {t(appLanguage, "stylePromptHint")}
            </p>
          </div>
        </div>

        <div class="settings-footer" style="justify-content: flex-end;">
          <button
            class="save-btn primary"
            style="width: auto; min-width: 120px;"
            onclick={saveStyle}
          >
            {t(appLanguage, "save") || "保存"}
          </button>
        </div>
      {:else}
        <div class="settings-header">
          <h2 id="settings-title">{t(appLanguage, "settingsTitle")}</h2>
          <button
            class="close-btn"
            onclick={closeSettings}
            aria-label={t(appLanguage, "close")}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="settings-body-container">
          <!-- Sidebar Tabs -->
          <div class="settings-sidebar">
            <button
              class="settings-tab vertical"
              class:active={settingsTab === "appearance"}
              onclick={() => changeTab("appearance")}
            >
              {t(appLanguage, "tabAppearance")}
            </button>
            <button
              class="settings-tab vertical"
              class:active={settingsTab === "translation"}
              onclick={() => changeTab("translation")}
            >
              {t(appLanguage, "tabTranslation")}
            </button>
            <button
              class="settings-tab vertical"
              class:active={settingsTab === "system"}
              onclick={() => changeTab("system")}
            >
              {t(appLanguage, "tabSystem")}
            </button>
            <button
              class="settings-tab vertical"
              class:active={settingsTab === "api"}
              onclick={() => changeTab("api")}
            >
              {t(appLanguage, "tabAi")}
            </button>
            <button
              class="settings-tab vertical"
              class:active={settingsTab === "styles"}
              onclick={() => changeTab("styles")}
            >
              {t(appLanguage, "tabStyles")}
            </button>
            <div style="flex: 1;"></div>
            <button
              class="settings-tab vertical"
              class:active={settingsTab === "about"}
              onclick={() => changeTab("about")}
            >
              {t(appLanguage, "tabAbout")}
            </button>
          </div>

          <!-- Content with Transitions -->
          <div class="settings-main-content">
            {#key settingsTab}
              <div
                class="tab-content-wrapper"
                in:fly={{
                  y: slideDirection * 20,
                  duration: 250,
                  delay: 20,
                  opacity: 0,
                  easing: quintOut,
                }}
                out:fly={{
                  y: -slideDirection * 20,
                  duration: 200,
                  opacity: 0,
                  easing: quintOut,
                }}
              >
                {#if settingsTab === "appearance"}
                  <!-- App Language -->
                  <div class="settings-section">
                    <label class="settings-label" for="app-lang-select"
                      >{t(appLanguage, "appLanguage")}</label
                    >
                    <select
                      id="app-lang-select"
                      class="settings-select"
                      bind:value={appLanguage}
                    >
                      <option value="ja">日本語</option>
                      <option value="en">English</option>
                      <option value="zh">中文</option>
                      <option value="ko">한국어</option>
                    </select>
                  </div>

                  <!-- Theme -->
                  <div class="settings-section">
                    <div class="settings-label">{t(appLanguage, "theme")}</div>
                    <div class="theme-toggle">
                      <button
                        class="theme-btn"
                        class:active={theme === "dark"}
                        onclick={() => (theme = "dark")}
                      >
                        {t(appLanguage, "themeDark")}
                      </button>
                      <button
                        class="theme-btn"
                        class:active={theme === "light"}
                        onclick={() => (theme = "light")}
                      >
                        {t(appLanguage, "themeLight")}
                      </button>
                    </div>
                  </div>
                {:else if settingsTab === "translation"}
                  <!-- Default Target Language -->
                  <div class="settings-section">
                    <label class="settings-label" for="target-lang-select"
                      >{t(appLanguage, "defaultTargetLang")}</label
                    >
                    <select
                      id="target-lang-select"
                      class="settings-select"
                      bind:value={defaultTargetLang}
                    >
                      <option value="日本語"
                        >{getTargetLanguageName(appLanguage, "日本語")}</option
                      >
                      <option value="英語"
                        >{getTargetLanguageName(appLanguage, "英語")}</option
                      >
                      <option value="中国語"
                        >{getTargetLanguageName(appLanguage, "中国語")}</option
                      >
                      <option value="韓国語"
                        >{getTargetLanguageName(appLanguage, "韓国語")}</option
                      >
                      <option value="フランス語"
                        >{getTargetLanguageName(
                          appLanguage,
                          "フランス語",
                        )}</option
                      >
                      <option value="ドイツ語"
                        >{getTargetLanguageName(
                          appLanguage,
                          "ドイツ語",
                        )}</option
                      >
                      <option value="スペイン語"
                        >{getTargetLanguageName(
                          appLanguage,
                          "スペイン語",
                        )}</option
                      >
                    </select>
                  </div>

                  <!-- Allow Rewrite -->
                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "allowRewrite")}
                    </div>
                    <div class="settings-card-row">
                      <span
                        id="allow-rewrite-label"
                        class="settings-row-description"
                      >
                        {t(appLanguage, "allowRewriteDescription")}
                      </span>
                      <button
                        class="toggle-switch"
                        class:on={allowRewrite}
                        onclick={() => (allowRewrite = !allowRewrite)}
                        aria-labelledby="allow-rewrite-label"
                        aria-pressed={allowRewrite}
                      >
                        <span class="toggle-knob"></span>
                      </button>
                    </div>
                  </div>

                  <!-- Translation Count -->
                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "translationCount") || "翻訳案の個数"}
                    </div>
                    <div class="settings-card-row">
                      <span
                        class="settings-row-description"
                      >
                        {t(appLanguage, "translationCountDesc") ||
                          "1回の翻訳で生成する翻訳案の数"}
                      </span>
                      <div class="segmented-control" role="group" aria-label={t(appLanguage, "translationCount")}>
                        {#each [1, 2, 3] as count}
                          <button
                            class="segmented-option"
                            class:active={translationCount === count}
                            onclick={() =>
                              (translationCount = count as 1 | 2 | 3)}
                            aria-pressed={translationCount === count}
                          >
                            {count}
                          </button>
                        {/each}
                      </div>
                    </div>
                  </div>

                  <!-- Auto Run Quick Translate -->
                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "autoRunQuick") ||
                        "クイック翻訳の自動実行"}
                    </div>
                    <div class="settings-card-row">
                      <span
                        id="auto-run-label"
                        class="settings-row-description"
                      >
                        {t(appLanguage, "autoRunQuickDesc") ||
                          "ショートカット呼出時に自動で翻訳を開始します"}
                      </span>
                      <button
                        class="toggle-switch"
                        class:on={autoRunQuick}
                        onclick={() => (autoRunQuick = !autoRunQuick)}
                        aria-labelledby="auto-run-label"
                        aria-pressed={autoRunQuick}
                      >
                        <span class="toggle-knob"></span>
                      </button>
                    </div>
                  </div>

                  <!-- Technical Info -->
                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "showTechInfo") || "技術情報を表示"}
                    </div>
                    <div class="settings-card-row">
                      <span
                        id="tech-info-label"
                        class="settings-row-description"
                      >
                        {t(appLanguage, "showTechInfoDesc") ||
                          "翻訳時に処理時間やトークン数を表示します"}
                      </span>
                      <button
                        class="toggle-switch"
                        class:on={showTechInfo}
                        onclick={() => (showTechInfo = !showTechInfo)}
                        aria-labelledby="tech-info-label"
                        aria-pressed={showTechInfo}
                      >
                        <span class="toggle-knob"></span>
                      </button>
                    </div>
                  </div>
                {:else if settingsTab === "system"}
                  <!-- Auto Start -->
                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "autoStart") || "スタートアップ起動"}
                    </div>
                    <div class="settings-card-row">
                      <span
                        class="settings-row-description"
                      >
                        {t(appLanguage, "autoStartDesc") ||
                          "OS 起動時にアプリを自動で起動します"}
                      </span>
                      <button
                        class="toggle-switch"
                        class:on={autoStartEnabled}
                        onclick={toggleAutoStart}
                        aria-label={t(appLanguage, "autoStart")}
                        aria-pressed={autoStartEnabled}
                      >
                        <span class="toggle-knob"></span>
                      </button>
                    </div>
                  </div>

                  <!-- Start Minimized -->
                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "startMinimized") ||
                        "起動時はメイン画面を非表示"}
                    </div>
                    <div class="settings-card-row">
                      <span
                        class="settings-row-description"
                      >
                        {t(appLanguage, "startMinimizedDesc") ||
                          "起動時にメイン画面を非表示で開始します"}
                      </span>
                      <button
                        class="toggle-switch"
                        class:on={startMinimized}
                        onclick={() => (startMinimized = !startMinimized)}
                        aria-label={t(appLanguage, "startMinimized")}
                        aria-pressed={startMinimized}
                      >
                        <span class="toggle-knob"></span>
                      </button>
                    </div>
                  </div>

                  <!-- Replace Selection -->
                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "clipboardOps")}
                    </div>
                    <div class="settings-card-row">
                      <span
                        class="settings-row-description"
                      >
                        {t(appLanguage, "clipboardOpsDesc")}
                      </span>
                      <button
                        class="toggle-switch"
                        class:on={clipboardOpsEnabled}
                        onclick={toggleClipboardOps}
                        aria-label={t(appLanguage, "clipboardOps")}
                        aria-pressed={clipboardOpsEnabled}
                      >
                        <span class="toggle-knob"></span>
                      </button>
                    </div>
                    <div class="settings-note">
                      {t(appLanguage, "clipboardOpsWarning")}
                    </div>
                  </div>

                  {#if isMac}
                    <!-- Permissions (macOS) -->
                    <div class="settings-section">
                      <div class="settings-label">
                        {t(appLanguage, "permissions")}
                      </div>
                      <div class="settings-card-row settings-stack">
                        <!-- Screen Recording -->
                        <div class="permission-row">
                          <div class="permission-copy">
                            <div class="permission-name">
                              {t(appLanguage, "screenRecording")}
                            </div>
                            <div
                              class="permission-status"
                              class:pending={permissions.screen_recording === null}
                              class:granted={permissions.screen_recording === true}
                              class:denied={permissions.screen_recording === false}
                            >
                              {permissions.screen_recording === null
                                ? t(appLanguage, "checking")
                                : permissions.screen_recording
                                  ? t(appLanguage, "granted")
                                  : t(appLanguage, "denied")}
                            </div>
                          </div>
                          {#if permissions.screen_recording === false}
                            <button
                              onclick={() =>
                                requestPermission("screen_recording")}
                              class="permission-btn"
                            >
                              {t(appLanguage, "grant")}
                            </button>
                            <button
                              onclick={async () => {
                                await invoke("open_screen_recording_settings");
                              }}
                              class="permission-btn"
                            >
                              {t(appLanguage, "openSystemSettings")}
                            </button>
                          {/if}
                        </div>

                        <!-- Accessibility -->
                        <div class="permission-row divided">
                          <div class="permission-copy">
                            <div class="permission-name">
                              {t(appLanguage, "accessibility")}
                            </div>
                            <div
                              class="permission-status"
                              class:pending={permissions.accessibility === null}
                              class:granted={permissions.accessibility === true}
                              class:denied={permissions.accessibility === false}
                            >
                              {permissions.accessibility === null
                                ? t(appLanguage, "checking")
                                : permissions.accessibility
                                  ? t(appLanguage, "granted")
                                  : t(appLanguage, "denied")}
                            </div>
                          </div>
                          {#if permissions.accessibility === false}
                            <button
                              onclick={() =>
                                requestPermission("accessibility")}
                              class="permission-btn"
                            >
                              {t(appLanguage, "grant")}
                            </button>
                            <button
                              onclick={async () => {
                                await invoke("open_accessibility_settings");
                              }}
                              class="permission-btn"
                            >
                              {t(appLanguage, "openSystemSettings")}
                            </button>
                          {/if}
                        </div>
                      </div>
                    </div>
                  {/if}
                  {#if isWindows}
                    <!-- OCR Engine -->
                    <div class="settings-section">
                      <div class="settings-label">
                        {t(appLanguage, "ocrEngine")}
                      </div>
                      <div class="settings-card-row settings-stack option-stack">
                        <label class="option-row">
                          <input
                            type="radio"
                            name="ocrEngine"
                            value="paddle"
                            bind:group={ocrEngine}
                          />
                          <span class="option-copy">
                            <div class="option-title">
                              {t(appLanguage, "ocrHighAccuracy")}
                            </div>
                            <div class="option-description">
                              {t(appLanguage, "ocrHighAccuracyDesc")}
                            </div>
                          </span>
                        </label>
                        <label class="option-row">
                          <input
                            type="radio"
                            name="ocrEngine"
                            value="windows"
                            bind:group={ocrEngine}
                          />
                          <span class="option-copy">
                            <div class="option-title">
                              {t(appLanguage, "ocrFast")}
                            </div>
                            <div class="option-description">
                              {t(appLanguage, "ocrFastDesc")}
                            </div>
                          </span>
                        </label>
                      </div>
                    </div>
                  {/if}
                  
                  <!-- Quick Shortcut -->
                  <div class="settings-section">
                    <label class="settings-label" for="quick-shortcut-input"
                      >{t(appLanguage, "quickShortcut")}</label
                    >
                    <div class="shortcut-row">
                      <input
                        id="quick-shortcut-input"
                        class="settings-input"
                        bind:value={shortcutDraft}
                        placeholder={t(appLanguage, "quickShortcutHint")}
                        onkeydown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();

                          // Ignore standalone modifier keys
                          if (
                            ["Control", "Shift", "Alt", "Meta"].includes(e.key)
                          ) {
                            return;
                          }

                          // Reset current draft
                          let parts = [];
                          const isMac = navigator.userAgent.includes("Mac");

                          if (e.metaKey) {
                            if (isMac) parts.push("Command");
                            else parts.push("Super");
                          }
                          if (e.ctrlKey) parts.push("Ctrl");
                          if (e.altKey) parts.push("Alt");
                          if (e.shiftKey) parts.push("Shift");

                          // Handle key
                          let key = e.key.toUpperCase();
                          if (key === " ") key = "Space";
                          // Function keys
                          if (
                            key.length > 1 &&
                            !key.startsWith("F") &&
                            key !== "Space" &&
                            key !== "ENTER" &&
                            key !== "TAB"
                          ) {
                            // E.g. "PageUp"
                            // Just use as is
                          }

                          parts.push(key);
                          shortcutDraft = parts.join("+");
                        }}
                      />
                      <button
                        class="save-btn apply-shortcut-btn"
                        onclick={() => void applyShortcut()}
                        disabled={shortcutSaving ||
                          shortcutDraft.trim() === "" ||
                          shortcutDraft === quickShortcut}
                      >
                        {t(appLanguage, "applyShortcut")}
                      </button>
                    </div>
                    <div class="shortcut-hint">
                      {t(appLanguage, "quickShortcutHint")}
                    </div>
                    {#if shortcutError}
                      <div class="shortcut-error">{shortcutError}</div>
                    {/if}
                  </div>
                {:else if settingsTab === "api"}
                  <!-- AI Settings Tab -->
                  <p
                    class="settings-description"
                    style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;"
                  >
                    {t(appLanguage, "aiTabDescription") ||
                      "選択したAIプロバイダーのモデルが有効になります。"}
                  </p>

                  <!-- Provider Switcher -->
                  <div class="provider-switcher">
                    <button
                      class="provider-btn"
                      class:active={selectedProvider === "openai"}
                      onclick={() => selectProvider("openai")}
                    >
                      OpenAI
                    </button>
                    <button
                      class="provider-btn"
                      class:active={selectedProvider === "gemini"}
                      onclick={() => selectProvider("gemini")}
                    >
                      Gemini
                    </button>
                    <button
                      class="provider-btn"
                      class:active={selectedProvider === "anthropic"}
                      onclick={() => selectProvider("anthropic")}
                    >
                      Anthropic
                    </button>
                    <button
                      class="provider-btn"
                      class:active={selectedProvider === "groq"}
                      onclick={() => selectProvider("groq")}
                    >
                      Groq
                    </button>
                    <button
                      class="provider-btn"
                      class:active={selectedProvider === "cerebras"}
                      onclick={() => selectProvider("cerebras")}
                    >
                      Cerebras
                    </button>
                  </div>

                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "rememberApiKeys")}
                    </div>
                    <div class="settings-card-row">
                      <span
                        class="settings-row-description"
                      >
                        {t(appLanguage, "rememberApiKeysDesc")}
                      </span>
                      <button
                        class="toggle-switch"
                        class:on={rememberApiKeys}
                        onclick={() =>
                          (rememberApiKeys = !rememberApiKeys)}
                        aria-label={t(appLanguage, "rememberApiKeys")}
                        aria-pressed={rememberApiKeys}
                      >
                        <span class="toggle-knob"></span>
                      </button>
                    </div>
                    <div class="settings-note">
                      {t(appLanguage, "apiKeyWarning")}
                    </div>
                  </div>

                  <!-- API Key for Selected Provider -->
                  <div class="settings-section">
                    <label class="settings-label" for="api-key-input">
                      {getApiKeyLabel(selectedProvider)}
                    </label>
                    <input
                      id="api-key-input"
                      type="password"
                      class="settings-input"
                      bind:value={apiKeys[selectedProvider]}
                      placeholder={getApiKeyPlaceholder(selectedProvider)}
                    />
                  </div>

                  <!-- Model Selection (Filtered) -->
                  <div class="settings-section">
                    <label class="settings-label" for="model-select"
                      >{t(appLanguage, "aiModel")}</label
                    >
                    <select
                      id="model-select"
                      class="settings-select"
                      bind:value={selectedModel}
                    >
                      {#each filteredModels as model}
                        <option value={model.value}>{model.label}</option>
                      {/each}
                    </select>
                  </div>

                  {#if selectedProviderDoc}
                    <div class="settings-section">
                      <div class="settings-label">
                        {t(appLanguage, "apiOverview")}
                      </div>
                      <div class="settings-note top">
                        {t(appLanguage, "apiOverviewDesc")}
                      </div>
                      <button
                        class="settings-card-row provider-docs-btn"
                        onclick={() => openProviderDocs(selectedProviderDoc.url)}
                      >
                        <div class="provider-docs-text">
                          <div class="provider-docs-title">
                            {selectedProviderDoc.label}
                          </div>
                          <div class="provider-docs-action">
                            {t(appLanguage, "openDocs")}
                          </div>
                        </div>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M14 3h7v7" />
                          <path d="M10 14L21 3" />
                          <path d="M5 5v16h16" />
                        </svg>
                      </button>
                    </div>
                  {/if}
                {:else if settingsTab === "styles"}
                  <!-- Styles Tab -->
                  <div class="styles-actions-top">
                    <button
                      class="rich-btn primary"
                      onclick={() => openStyleEditor()}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        class="btn-icon-left"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      {t(appLanguage, "addStyle")}
                    </button>
                    <button
                      class="rich-btn danger"
                      onclick={triggerResetStyles}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        class="btn-icon-left"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path
                          d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                        ></path>
                        <path d="M3 3v5h5"></path>
                      </svg>
                      {t(appLanguage, "resetStyles")}
                    </button>
                  </div>

                  <div class="styles-list-container">
                    {#each customStyles as style, i (style.id)}
                      <div class="style-item-card">
                        <div class="style-header-row">
                          <span class="style-name-display">{style.name}</span>
                          <div class="style-header-actions">
                            <div
                              class="move-actions"
                              style="display: flex; gap: 2px; margin-right: 8px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 8px;"
                            >
                              <button
                                class="icon-btn-small"
                                onclick={() => moveStyle(i, "up")}
                                disabled={i === 0}
                                title={t(appLanguage, "moveUp")}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                >
                                  <polyline points="18 15 12 9 6 15"></polyline>
                                </svg>
                              </button>
                              <button
                                class="icon-btn-small"
                                onclick={() => moveStyle(i, "down")}
                                disabled={i === customStyles.length - 1}
                                title={t(appLanguage, "moveDown")}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                >
                                  <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                              </button>
                            </div>
                            <div
                              style="display: flex; flex-direction: column; gap: 4px;"
                            >
                              <button
                                class="icon-btn-small"
                                title={t(appLanguage, "editStyle")}
                                onclick={() => openStyleEditor(style)}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                >
                                  <path
                                    d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                                  ></path>
                                  <path
                                    d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                                  ></path>
                                </svg>
                              </button>
                              <button
                                class="icon-btn-small danger"
                                title={t(appLanguage, "delete")}
                                onclick={() => deleteStyle(style.id)}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                >
                                  <polyline points="3 6 5 6 21 6"></polyline>
                                  <path
                                    d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                                  ></path>
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                        <p class="style-prompt-text">{style.prompt}</p>
                      </div>
                    {/each}
                  </div>
                {:else if settingsTab === "about"}
                  <!-- About Tab -->
                  <div
                    class="about-tab-content"
                  >
                    <div class="about-brand-section">
                      <div class="about-logo-wrapper">
                        <img
                          src={theme === "light"
                            ? "icon-full-light.svg"
                            : "icon-full-dark.svg"}
                          alt="Howlingual Logo"
                          style="width: 100px; height: 100px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2));"
                        />
                      </div>
                      <div class="about-text-content">
                        <h2>Howlingual</h2>
                        <p>Version {appVersion}</p>
                      </div>
                    <div class="about-footer-info">
                      <p>© 2026 tomakura</p>
                    </div>
                    <div style="margin-top: 12px;">
                      <button
                        class="rich-btn danger"
                        onclick={() => invoke("quit_app")}
                      >
                        {t(appLanguage, "quit")}
                      </button>
                    </div>
                  </div>

                    <div class="about-usage-section">
                      <div class="usage-cards">
                        <div class="usage-card">
                          <span class="usage-label">
                            {t(appLanguage, "usageToday") || "今日の使用回数"}
                          </span>
                          <span class="usage-value">{usageToday.count}</span>
                        </div>
                        <div class="usage-card">
                          <span class="usage-label">
                            {t(appLanguage, "usageTokensToday") ||
                              "今日のトークン"}
                          </span>
                          <span class="usage-value">
                            {usageToday.tokens.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div class="usage-chart-card">
                        <div class="usage-chart-header">
                          {t(appLanguage, "usageWeeklyTrend") ||
                            "1週間の推移"}
                        </div>
                        <div
                          class="usage-chart-wrapper"
                          bind:this={usageChartWrapper}
                        >
                          {#if usageReady}
                            <svg
                              class="usage-chart"
                              viewBox={`0 0 ${usageChartMetrics.width} ${usageChartConfig.height}`}
                              preserveAspectRatio="xMidYMid meet"
                              role="img"
                              aria-label={t(appLanguage, "weeklyUsageTrendLabel")}
                              onmouseleave={clearUsageHover}
                            >
                              <line
                                class="usage-chart-baseline"
                                x1="12"
                                x2={usageChartMetrics.width - 12}
                                y1={usageChartConfig.baseline}
                                y2={usageChartConfig.baseline}
                              />
                              {#each weeklyUsage as day, i}
                                <g class="usage-day">
                                  <rect
                                    class="usage-hover-hit"
                                    x={usageChartMetrics.paddingX +
                                      i *
                                        (usageChartMetrics.barWidth +
                                          usageChartMetrics.gap) -
                                      usageChartMetrics.gap}
                                    y="0"
                                    width={usageChartMetrics.barWidth +
                                      usageChartMetrics.gap * 2}
                                    height={usageChartConfig.height}
                                    rx="0"
                                    role="presentation"
                                    aria-hidden="true"
                                    onmousemove={(event) =>
                                      showUsageHover(event, day)}
                                    onmouseleave={clearUsageHover}
                                  />
                                  <rect
                                    class="usage-bar"
                                    x={usageChartMetrics.paddingX +
                                      i *
                                        (usageChartMetrics.barWidth +
                                          usageChartMetrics.gap)}
                                    y={usageChartConfig.baseline -
                                      (day.count / weeklyMaxCount) *
                                        usageChartConfig.barMaxHeight}
                                    width={usageChartMetrics.barWidth}
                                    height={(day.count / weeklyMaxCount) *
                                      usageChartConfig.barMaxHeight}
                                    rx="4"
                                  />
                                  <circle
                                    class="usage-line-dot"
                                    cx={usageChartMetrics.paddingX +
                                      i *
                                        (usageChartMetrics.barWidth +
                                          usageChartMetrics.gap) +
                                      usageChartMetrics.barWidth / 2}
                                    cy={usageChartConfig.baseline -
                                      (day.tokens / weeklyMaxTokens) *
                                        usageChartConfig.barMaxHeight}
                                    r="3"
                                  />
                                  <text
                                    class="usage-chart-label"
                                    x={usageChartMetrics.paddingX +
                                      i *
                                        (usageChartMetrics.barWidth +
                                          usageChartMetrics.gap) +
                                      usageChartMetrics.barWidth / 2}
                                    y={usageChartConfig.labelY}
                                    text-anchor="middle"
                                  >
                                    {shortDate(day.date)}
                                  </text>
                                </g>
                              {/each}
                              <polyline
                                class="usage-line"
                                points={getTokenLinePoints()}
                              />
                            </svg>
                            {#if usageHover}
                              <div
                                class="usage-tooltip"
                                style={`left: ${usageHover.x}px; top: ${usageHover.y}px;`}
                              >
                                <div class="usage-tooltip-date">
                                  {shortDate(usageHover.day.date)}
                                </div>
                                <div class="usage-tooltip-row">
                                  <span class="legend-dot count"></span>
                                  <span>
                                    {t(appLanguage, "usageCountLabel") ||
                                      "回数"}: {usageHover.day.count}
                                  </span>
                                </div>
                                <div class="usage-tooltip-row">
                                  <span class="legend-dot tokens"></span>
                                  <span>
                                    {t(appLanguage, "usageTokensLabel") ||
                                      "トークン"}: {usageHover.day.tokens.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            {/if}
                          {:else}
                            <div class="usage-chart-skeleton"></div>
                          {/if}
                        </div>
                        <div class="usage-chart-legend">
                          <span class="legend-item">
                            <span class="legend-dot count"></span>
                            {t(appLanguage, "usageCountLabel") || "回数"}
                          </span>
                          <span class="legend-item">
                            <span class="legend-dot tokens"></span>
                            {t(appLanguage, "usageTokensLabel") ||
                              "トークン"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            {/key}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if showHistory && !isCompactMode}
  <div
    class="settings-overlay"
    transition:fade={{ duration: 200 }}
  >
    <button
      type="button"
      class="overlay-dismiss"
      aria-label={t(appLanguage, "close")}
      onclick={closeHistory}
      tabindex="-1"
    ></button>
    <div
      class="settings-panel glass"
      transition:fly={{ y: 20, duration: 300 }}
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="settings-header">
        <h2 id="history-title">{t(appLanguage, "history")}</h2>
        <button
          class="close-btn"
          onclick={closeHistory}
          aria-label={t(appLanguage, "close")}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="settings-body-container">
        <!-- Sidebar Tabs -->
        <div class="settings-sidebar">
          <button
            class="settings-tab vertical"
            class:active={historyTab === "recent"}
            onclick={() => changeHistoryTab("recent")}
          >
            {t(appLanguage, "tabRecent")}
          </button>
          <button
            class="settings-tab vertical"
            class:active={historyTab === "saved"}
            onclick={() => changeHistoryTab("saved")}
          >
            {t(appLanguage, "tabFavorites")}
          </button>
        </div>

        <!-- Main Content -->
        <div class="settings-main-content">
          {#key historyTab}
            <div
              class="tab-content-wrapper"
              in:fly={{
                y: historySlideDirection * 20,
                duration: 300,
                delay: 200,
              }}
              out:fly={{ y: -historySlideDirection * 20, duration: 200 }}
              style="padding: 24px;"
            >
              {#if historyTab === "recent"}
                {#if history.length === 0}
                  <div class="empty-state">
                    <p>{t(appLanguage, "noHistory")}</p>
                  </div>
                {:else}
                  <div class="history-actions-top">
                    <button class="rich-btn danger" onclick={clearHistory}>
                      {t(appLanguage, "clearHistory")}
                    </button>
                  </div>
                  <div class="history-list">
                    {#each history as item (item.id)}
                      <div
                        class="style-item-card history-item"
                        in:fly={{ x: 20, duration: 250, delay: 50 }}
                        out:fly={{ x: -20, duration: 200 }}
                      >
                        <button
                          class="history-item-main"
                          onclick={() => loadHistory(item)}
                        >
                          <div class="history-meta">
                            <span
                              >{new Date(item.timestamp).toLocaleString()}</span
                            >
                            <span
                              >{formatHistoryLanguage(item.sourceLang, item.isAutoDetect)} → {formatHistoryLanguage(item.targetLang)}</span
                            >
                          </div>
                          <div class="history-source">{item.sourceText}</div>
                          <div class="history-preview">
                            {item.translations[0]?.text}
                          </div>
                        </button>
                        <div class="history-item-actions">
                          <button
                            class="star-btn small"
                            class:active={isFavoritedById(item.id)}
                            class:animating={starAnimatingId === item.id}
                            onclick={() => toggleFavorite(item)}
                            aria-label={t(appLanguage, "toggleFavorite")}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill={isFavoritedById(item.id)
                                ? "currentColor"
                                : "none"}
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <polygon
                                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                              ></polygon>
                            </svg>
                          </button>
                          <button
                            class="icon-btn-small delete-btn"
                            onclick={() => deleteHistoryItem(item.id)}
                            aria-label={t(appLanguage, "delete")}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              ><polyline points="3 6 5 6 21 6"></polyline><path
                                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                              ></path></svg
                            >
                          </button>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              {:else if historyTab === "saved"}
                {#if favorites.length === 0}
                  <div class="empty-state">
                    <p>{t(appLanguage, "noFavorites")}</p>
                  </div>
                {:else}
                  <div class="history-list">
                    {#each favorites as item, i (item.id)}
                      <div
                        class="style-item-card history-item"
                        in:fly={{ x: 20, duration: 250, delay: 50 }}
                        out:fly={{ x: -20, duration: 200 }}
                      >
                        <button
                          class="history-item-main"
                          onclick={() => loadHistory(item)}
                        >
                          <div class="history-meta">
                            <span
                              >{new Date(item.timestamp).toLocaleString()}</span
                            >
                            <span
                              >{formatHistoryLanguage(item.sourceLang, item.isAutoDetect)} → {formatHistoryLanguage(item.targetLang)}</span
                            >
                          </div>
                          <div class="history-source">{item.sourceText}</div>
                          <div class="history-preview">
                            {item.translations[0]?.text}
                          </div>
                        </button>
                        <div class="history-item-actions vertical">
                          <div class="move-actions">
                            <button
                              class="icon-btn-small"
                              onclick={() => moveFavorite(i, "up")}
                              disabled={i === 0}
                              aria-label={t(appLanguage, "moveUp")}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                ><polyline points="18 15 12 9 6 15"
                                ></polyline></svg
                              >
                            </button>
                            <button
                              class="icon-btn-small"
                              onclick={() => moveFavorite(i, "down")}
                              disabled={i === favorites.length - 1}
                              aria-label={t(appLanguage, "moveDown")}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                ><polyline points="6 9 12 15 18 9"
                                ></polyline></svg
                              >
                            </button>
                          </div>
                          <button
                            class="icon-btn-small delete-btn"
                            onclick={() => deleteFavorite(item.id)}
                            aria-label={t(appLanguage, "deleteFavorite")}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              ><polyline points="3 6 5 6 21 6"></polyline><path
                                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                              ></path></svg
                            >
                          </button>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/key}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showResetConfirmation && !isCaptureMode}
  <div
    class="modal-overlay"
    transition:fade={{ duration: 200 }}
  >
    <button
      type="button"
      class="overlay-dismiss"
      aria-label={t(appLanguage, "close")}
      onclick={() => (showResetConfirmation = false)}
      tabindex="-1"
    ></button>
    <div
      class="modal-card glass"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <h3>{t(appLanguage, "confirmReset")}</h3>
      <div class="modal-actions">
        <button
          class="rich-btn secondary"
          onclick={() => (showResetConfirmation = false)}
          >{t(appLanguage, "close")}</button
        >
        <button class="rich-btn danger" onclick={confirmResetStyles}
          >{t(appLanguage, "resetStyles")}</button
        >
      </div>
    </div>
  </div>
{/if}

{#if showDiscardConfirmation && !isCaptureMode}
  <div
    class="modal-overlay"
    transition:fade={{ duration: 200 }}
  >
    <button
      type="button"
      class="overlay-dismiss"
      aria-label={t(appLanguage, "close")}
      onclick={() => (showDiscardConfirmation = false)}
      tabindex="-1"
    ></button>
    <div
      class="modal-card glass"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <h3>{t(appLanguage, "confirmDiscard")}</h3>
      <div class="modal-actions">
        <button
          class="rich-btn secondary"
          onclick={() => (showDiscardConfirmation = false)}
        >
          {t(appLanguage, "cancel")}
        </button>
        <button class="rich-btn danger" onclick={confirmDiscardStyle}>
          {t(appLanguage, "discard")}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .permission-btn {
    padding: 4px 10px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }
  .permission-btn:hover {
    background: #2563eb;
  }
  .settings-note {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-muted);
  }
  .settings-note.top {
    margin-top: 0;
    margin-bottom: 8px;
  }
  .container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100vh;
    padding: 0;
    overflow: hidden;
    opacity: 0;
    transition: opacity 250ms ease-out;
  }

  .container.visible {
    opacity: 1;
  }

  .compact-shell {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100vh;
    padding: 10px;
    border-radius: 0;
    border: none;
    background: var(--bg-color);
    position: relative;
    overflow: visible;
    opacity: 0;
    transition: opacity 250ms ease-out;
  }

  .compact-shell.visible {
    opacity: 1;
  }

  .compact-shell::before {
    display: none;
  }

  .compact-header {
    height: 40px;
    display: flex;
    align-items: center;
    /* justify-content: space-between;  Removed to allow spacer to grow */
    z-index: 3000;
    user-select: none;
    cursor: default;
    background: transparent;
  }

  .compact-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 4px;
    padding-right: 10px;
    /* pointer-events: none; REMOVED: Needs to catch drag events now */
  }

  .header-drag-spacer {
    flex-grow: 1;
    height: 100%;
    background: transparent;
  }

  .compact-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 4px;
    z-index: 3001;
  }

  .compact-close-btn {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .compact-close-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  .compact-icon {
    width: 32px;
    height: 32px;
  }

  .compact-name {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--text-main);
    background: none;
  }

  .compact-main-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.35);
    color: #93c5fd;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .compact-main-btn:hover {
    background: rgba(59, 130, 246, 0.3);
  }

  .compact-lang-row {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 4px;
    position: relative;
    z-index: 2500;
    padding: 0 12px;
    width: 100%;
    box-sizing: border-box;
    height: 32px; /* Ensure height for absolute positioning context */
  }

  .compact-left-actions {
    position: absolute;
    left: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    transition:
      opacity 0.25s ease,
      transform 0.25s ease;
  }

  .compact-left-actions.hidden {
    opacity: 0;
    transform: translateY(6px);
    pointer-events: none;
  }

  .compact-lang-group {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    flex-shrink: 1;
  }

  .lang-selector-group {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .compact-shell .lang-btn {
    padding: 4px 6px;
    font-size: 11px;
    flex-shrink: 1;
    min-width: 0;
  }

  .scroll-wrapper.compact-scroll-wrapper {
    margin: 0 6px 6px;
    border-radius: 16px;
    overflow: visible;
  }

  .main-scroll.compact-scroll {
    padding: 12px 12px 14px;
    gap: 10px;
  }

  .compact-textarea {
    width: 100%;
    min-height: 72px;
    max-height: 120px;
    background: transparent;
    border: none;
    color: var(--text-main);
    resize: none;
    font-size: 13px;
    line-height: 1.45;
  }

  .compact-textarea::placeholder {
    color: var(--text-muted);
  }

  .controls-bar.compact-controls {
    top: -12px;
    padding: 8px 10px;
    gap: 8px;
  }

  .compact-shell .text-preview {
    font-size: 12px;
    line-height: 1.4;
  }

  .compact-style-row {
    flex: 1;
    display: flex;
    align-items: center;
    transition:
      opacity 0.3s ease,
      transform 0.3s ease;
  }

  .compact-style-row.hidden {
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
  }

  .compact-style-row .style-dropdown {
    max-height: 220px;
    overflow-y: auto;
  }

  .chip-text {
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.3px;
  }

  .output-area.compact-output {
    gap: 10px;
  }

  .stack-collapse-row,
  .favorite-action-row {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .stack-collapse-row {
    margin-top: 8px;
  }

  .favorite-action-row {
    gap: 6px;
    margin-top: 16px;
    padding-bottom: 16px;
  }

  .compact-ocr-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-main);
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .compact-ocr-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* App Header & Layout */
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 10px;
    height: 45px;
    flex-shrink: 0;
    margin-top: 10px;
    margin-bottom: 0px;
    position: relative;
    z-index: 200; /* Ensure dropdowns stay above main content */
    width: 100%;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    transform: translateY(-2px); /* Shift up slightly */
  }

  .app-title {
    font-family: "Jost", var(--font-display), sans-serif;
    font-weight: 600;
    font-size: 26px;
    color: var(--text-main);
    background: none;
  }

  .header-drag-spacer {
    flex: 1;
    min-width: 40px;
    height: 100%;
  }

  /* Language Selector Row - below header */
  .header-actions-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 0px 20px 10px 20px;
    position: relative;
    z-index: 200;
    width: 100%;
  }

  @keyframes starPop {
    0% {
      transform: scale(1) rotate(0deg);
    }
    50% {
      transform: scale(1.35) rotate(-8deg);
    }
    100% {
      transform: scale(1) rotate(0deg);
    }
  }

  @keyframes sparkleFloat {
    0% {
      transform: translateY(0) scale(0.6);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    100% {
      transform: translateY(-10px) scale(1.1);
      opacity: 0;
    }
  }

  /* Header Right Standalone - positioned to the right */
  .header-right-standalone {
    position: absolute;
    top: 15px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 4px;
    z-index: 250;
  }

  /* Inline Window Controls - Windows角丸四角スタイル */
  .window-controls-inline {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-right: 8px;
  }

  .win-btn-inline {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.06);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    padding: 0;
    color: rgba(255, 255, 255, 0.6);
  }

  .win-btn-inline svg {
    opacity: 1;
    transition: all 0.2s ease;
  }

  .win-btn-inline:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.9);
  }

  .win-btn-inline.close:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  .win-btn-inline:active {
    transform: scale(0.95);
  }

  .header-btn {
    padding: 6px;
    color: var(--text-muted);
    border-radius: 4px;
    transition: all 0.2s;
  }
  .header-btn:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.1);
  }
  .header-btn:active {
    transform: scale(0.94);
  }

  /* 履歴ボタン: 時計の針が反時計回りに回転 */
  .history-btn.animating .clock-hands {
    transform-origin: 12px 12px;
    animation: rewindTime 1s var(--easing);
  }

  @keyframes rewindTime {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(-360deg);
    }
  }

  /* 設定ボタン: 歯車がゆっくり回転 */
  .settings-btn.animating .settings-icon {
    animation: gearSpin 1s var(--easing);
  }

  @keyframes gearSpin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .loading-dots-inline {
    display: inline-block;
    animation: inlineTwinkle 1.5s infinite;
    letter-spacing: 2px;
    font-weight: bold;
    color: var(--primary-color);
    width: 24px;
    text-align: left;
  }

  @keyframes inlineTwinkle {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  .lang-selector {
    position: relative;
    flex-shrink: 1;
    min-width: 0;
  }

  .lang-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: var(--text-main);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    padding: 8px 8px;
    border-radius: 4px;
    transition: all 0.2s var(--easing);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .lang-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .lang-btn:active {
    transform: scale(0.96);
  }

  .chevron-icon {
    transition: transform 0.3s var(--easing);
  }

  .lang-btn.open .chevron-icon {
    transform: rotate(180deg);
  }

  .lang-menu {
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 4px;
    background: rgba(30, 30, 35, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 4px;
    z-index: 5000; /* Ensure above compact scroll surface */
    min-width: 100px;
  }

  .lang-option {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .lang-option:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-main);
  }
  .lang-option.active {
    color: var(--primary-color);
  }

  .app-icon {
    width: 40px;
    height: 40px;
    object-fit: contain;
    border-radius: 8px;
    transform: translateY(-2px); /* Shift icon specifically upwards */
  }

  /* Sparkle Icon Animation */
  .sparkle-icon {
    color: var(--primary-color);
    transition: all 0.3s var(--easing);
  }

  .sparkle-icon.is-active {
    filter: drop-shadow(0 0 4px var(--primary-color));
  }

  .sparkle-icon.is-detecting {
    filter: drop-shadow(0 0 4px var(--primary-color));
  }

  .sparkle-icon.is-active .star-1 {
    animation: twinkle 1s var(--easing);
  }
  .sparkle-icon.is-active .star-2 {
    animation: twinkle 1s var(--easing) 0.15s backwards;
  }
  .sparkle-icon.is-active .star-3 {
    animation: twinkle 1s var(--easing) 0.3s backwards;
  }

  .sparkle-icon.is-detecting .star-1 {
    animation: twinkle 1s var(--easing) infinite;
  }
  .sparkle-icon.is-detecting .star-2 {
    animation: twinkle 1s var(--easing) 0.15s infinite;
  }
  .sparkle-icon.is-detecting .star-3 {
    animation: twinkle 1s var(--easing) 0.3s infinite;
  }

  @keyframes twinkle {
    0% {
      transform: scale(0.8);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.2);
      opacity: 1;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .menu-divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 0;
  }

  .auto-detect {
    color: var(--text-main);
  }

  /* Scroll Wrapper for custom scrollbar */
  .scroll-wrapper {
    flex: 1;
    display: flex;
    position: relative;
    /* Responsive margins: Top(0) Right Bottom Left */
    margin: 0px 15px 15px 15px;
    border-radius: 20px;
    overflow: hidden; /* Ensure content respects border-radius */
    border: 1px solid var(--border-color); /* Optional: distinct edge */
    min-height: 0;
  }

  /* Bottom fade effect */
  .scroll-wrapper::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 40px;
    background: linear-gradient(to top, var(--bg-color), transparent);
    pointer-events: none;
    z-index: 5;
    border-radius: 0 0 20px 20px;
    opacity: 1;
    transition: opacity 0.3s ease;
  }

  .scroll-wrapper.at-bottom::after {
    opacity: 0;
  }

  /* Custom Scrollbar Indicator (Fade Animation) */
  .scroll-indicator {
    position: absolute;
    right: 0;
    width: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.8s ease-out;
  }

  .scroll-indicator.visible {
    opacity: 1;
    transition: opacity 0.15s ease-in;
  }

  /* Main Scroll Container */
  .main-scroll {
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
    padding: 14px 16px 14px 16px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
  }

  /* Hide native scrollbar completely - use custom overlay */
  .main-scroll::-webkit-scrollbar {
    width: 0;
    display: none;
  }

  .input-area {
    flex-shrink: 0;
  }

  /* Sticky Controls Bar */
  .controls-bar {
    position: sticky;
    top: -14px;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    margin: -14px -14px 8px -14px; /* Expand to container edges */
    border-radius: var(--radius-md);
    transition: all 0.3s var(--easing);
  }

  .controls-bar.scrolled {
    padding: 10px 14px; /* Slightly reduced padding when scrolled */
    box-shadow: 0 3px 15px rgba(0, 0, 0, 0.5);
    background: rgba(10, 10, 10, 0.85); /* Semi-transparent dark */
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08); /* Optional detail */
  }

  :global([data-theme="light"]) .controls-bar.scrolled {
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 3px 15px rgba(0, 0, 0, 0.1);
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }

  .text-preview {
    position: absolute;
    left: 14px;
    right: 60px;
    font-size: 13px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    margin: 0;
    opacity: 0;
    transform: translateY(-8px);
    pointer-events: none;
    transition:
      opacity 0.3s ease,
      transform 0.3s ease;
    /* Soft wipe reveal + Right side blur fade */
    mask-image: linear-gradient(
      to right,
      black 0%,
      black 45%,
      transparent 50%,
      transparent 100%
    );
    -webkit-mask-image: linear-gradient(
      to right,
      black 0%,
      black 45%,
      transparent 50%,
      transparent 100%
    );
    mask-size: 200% 100%;
    -webkit-mask-size: 200% 100%;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
    mask-position: 100% 0;
    -webkit-mask-position: 100% 0;
  }

  .text-preview.visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
    animation: wipeInSoft 1s cubic-bezier(0.5, 1, 0.89, 1) forwards;
  }

  @keyframes wipeInSoft {
    0% {
      mask-position: 100% 0;
      -webkit-mask-position: 100% 0;
    }
    100% {
      mask-position: 0% 0;
      -webkit-mask-position: 0% 0;
    }
  }

  /* Action Button (base) */
  .action-btn {
    width: 46px;
    height: 46px;
    border: none;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      transform 0.25s var(--easing-bounce),
      background 0.3s var(--easing),
      box-shadow 0.3s var(--easing);
  }

  .ocr-main-btn {
    width: 50px;
    position: relative;
    overflow: hidden;
    padding-left: 2px;
    border: 1px solid var(--border-color);
    background: var(--bg-card);
    color: var(--text-color);
    transition:
      opacity 0.25s ease,
      transform 0.25s var(--easing-bounce),
      background 0.3s var(--easing),
      box-shadow 0.3s var(--easing);
  }

  .ocr-main-btn.hidden {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
    pointer-events: none;
  }

  .action-btn:hover {
    transform: scale(1.06);
  }

  .action-btn:active {
    transform: scale(0.95);
  }

  /* Translate mode (accent color) */
  .action-btn.translate-mode {
    background: var(--primary-color);
    color: #fff;
    box-shadow: 0 4px 16px rgba(99, 102, 241, 0.25);
  }

  .action-btn.translate-mode:hover {
    background: var(--primary-hover);
    box-shadow: 0 6px 24px rgba(99, 102, 241, 0.35);
  }

  .action-btn.translate-mode:disabled {
    background: rgba(99, 102, 241, 0.3);
    box-shadow: none;
    transform: none;
  }

  /* Stop Mode (Red) */
  .action-btn.stop-mode {
    background: #ef4444;
    color: #fff;
    box-shadow: 0 4px 16px rgba(239, 68, 68, 0.25);
  }

  .action-btn.stop-mode:hover {
    background: #dc2626;
    box-shadow: 0 6px 24px rgba(239, 68, 68, 0.35);
  }

  /* Scroll-to-top mode (white) */
  .action-btn.scroll-mode {
    background: var(--text-main);
    color: var(--bg-color);
  }

  .action-btn.scroll-mode:hover {
    background: #fff;
  }

  :global([data-theme="light"]) .action-btn.scroll-mode {
    background: #1a1a1a;
    color: #fff;
  }

  :global([data-theme="light"]) .action-btn.scroll-mode:hover {
    background: #333;
  }

  .btn-icon {
    animation: iconPop 0.25s var(--easing);
  }

  @keyframes iconPop {
    0% {
      transform: scale(0.6);
      opacity: 0;
    }
    60% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .textarea-container {
    position: relative;
    width: 100%;
  }

  .textarea-container:focus-within {
    border-radius: 10px;
    box-shadow: 0 0 0 2px rgba(var(--primary-rgb, 59, 130, 246), 0.28);
  }

  textarea {
    width: 100%;
    min-height: 40px;
    background: transparent;
    border: none;
    color: var(--text-main);
    font-size: 15px;
    resize: none;
    outline: none;
    font-family: inherit;
    line-height: 1.5;
    overflow-y: auto;
    display: block;
    max-height: 200px;
    padding-bottom: 20px;
    padding-right: 44px;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.32) transparent;
  }

  textarea::-webkit-scrollbar {
    width: 8px;
  }

  textarea::-webkit-scrollbar-track {
    background: transparent;
  }

  textarea::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.32);
    border-radius: 8px;
  }

  textarea::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.45);
  }

  :global([data-theme="light"]) textarea {
    scrollbar-color: rgba(0, 0, 0, 0.32) transparent;
  }

  :global([data-theme="light"]) textarea::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.32);
  }

  :global([data-theme="light"]) textarea::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.45);
  }

  .textarea-actions {
    position: absolute;
    top: 6px;
    right: 8px;
    display: flex;
    gap: 4px;
    z-index: 10;
  }

  .textarea-action-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-color);
    transition: all 0.2s;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .textarea-action-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: scale(1.05);
  }

  :global([data-theme="light"]) .textarea-action-btn {
    background: rgba(0, 0, 0, 0.05);
    color: var(--text-main);
  }

  :global([data-theme="light"]) .textarea-action-btn:hover {
    background: rgba(0, 0, 0, 0.1);
  }

  /* Fade effect only when overflowing - blur only, no color */
  .fade-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 40px;
    background: transparent;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .textarea-container.has-overflow .fade-overlay {
    opacity: 1;
  }

  textarea.long-text {
    font-size: 13px;
  }

  .output-area {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Style Chips with Progress Bar */
  .styles-row {
    flex: 1;
    display: flex;
    gap: 8px;
    overflow: visible;
    padding: 2px 4px;
    scrollbar-width: none;
    transition:
      opacity 0.3s ease,
      transform 0.3s ease;
  }

  .styles-row.hidden {
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
    visibility: hidden;
  }

  .styles-row.fade-out {
    opacity: 0.15;
    pointer-events: none;
    mask-image: linear-gradient(to right, black 70%, transparent 100%);
  }

  .style-chip-track {
    flex: 1;
    display: flex;
    align-items: center;
    overflow: hidden;
    height: 100%;
  }

  .style-chip-track.compact {
    gap: 6px;
  }

  .style-chip-track.main {
    gap: 8px;
    mask-image: linear-gradient(to right, black 90%, transparent 100%);
  }

  .style-chip {
    position: relative;
    display: flex;
    align-items: center;
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--border-color);
    background: rgba(255, 255, 255, 0.03);
    cursor: pointer;
    overflow: hidden;
    transition: all 0.25s var(--easing);
    user-select: none;
    touch-action: none;
    white-space: nowrap;
  }

  .style-chip:hover {
    border-color: var(--border-color-strong);
    background: rgba(255, 255, 255, 0.06);
    transform: translateY(-1px);
  }

  .style-chip:active {
    transform: translateY(0) scale(0.98);
  }

  .style-chip[data-level="1"],
  .style-chip[data-level="2"] {
    border-color: rgba(99, 102, 241, 0.3);
    background: rgba(99, 102, 241, 0.08);
    box-shadow: 0 0 12px rgba(99, 102, 241, 0.1);
  }

  .style-chip[data-level="2"] {
    border-color: rgba(99, 102, 241, 0.5);
    background: rgba(99, 102, 241, 0.15);
    box-shadow: 0 0 16px rgba(99, 102, 241, 0.15);
  }

  .chip-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: var(--primary-color);
    opacity: 0;
    transition:
      width 0.25s var(--easing),
      opacity 0.25s var(--easing);
    border-radius: 20px 0 0 20px;
  }

  .style-chip[data-level="1"] .chip-fill {
    opacity: 0.15;
  }

  .style-chip[data-level="2"] .chip-fill {
    opacity: 0.25;
  }

  .add-chip.has-active {
    border-color: var(--primary-color);
    border-style: solid;
    color: var(--primary-color);
    box-shadow: 0 0 8px rgba(var(--primary-rgb, 59, 130, 246), 0.2);
  }

  .chip-text {
    position: relative;
    z-index: 1;
    color: var(--text-main);
  }

  .add-chip {
    background: transparent;
    border: 1px dashed var(--border-color);
    color: var(--text-muted);
  }

  @keyframes popIn {
    0% {
      opacity: 0;
      transform: translateY(20px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Translation Cards */
  .candidate-card {
    padding: 16px 18px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-color);
    transition: all 0.3s var(--easing);
    flex-shrink: 0;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    animation: slideInUp 0.4s var(--easing-smooth) backwards;
    position: relative;
    overflow: hidden;
  }

  .candidate-card::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--primary-color);
    opacity: 0;
    transition: opacity 0.3s var(--easing);
  }

  .candidate-card:hover::before {
    opacity: 1;
  }

  .candidate-card:hover {
    border-color: var(--border-color-strong);
    background: rgba(255, 255, 255, 0.06);
    transform: translateX(2px);
    box-shadow: var(--shadow-md);
  }

  .card-inner-content {
    width: 100%;
    transition: opacity 0.4s var(--easing);
  }

  .candidate-actions.hide {
    display: none;
  }

  /* Staggered backgrounds and animation delays */
  .candidate-card:nth-child(1) {
    background: rgba(255, 255, 255, 0.08);
    animation-delay: 0s;
  }
  .candidate-card:nth-child(2) {
    background: rgba(255, 255, 255, 0.05);
    animation-delay: 0.08s;
  }
  .candidate-card:nth-child(3) {
    background: rgba(255, 255, 255, 0.03);
    animation-delay: 0.16s;
  }
  .candidate-card:nth-child(n + 4) {
    background: rgba(255, 255, 255, 0.02);
    animation-delay: 0.24s;
  }

  /* Light mode - use darker backgrounds */
  :global([data-theme="light"]) .candidate-card:nth-child(1) {
    background: rgba(0, 0, 0, 0.02);
  }
  :global([data-theme="light"]) .candidate-card:nth-child(2) {
    background: rgba(0, 0, 0, 0.04);
  }
  :global([data-theme="light"]) .candidate-card:nth-child(3) {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .candidate-card:nth-child(n + 4) {
    background: rgba(0, 0, 0, 0.06);
  }
  :global([data-theme="light"]) .candidate-card {
    border-color: rgba(0, 0, 0, 0.06);
  }
  :global([data-theme="light"]) .candidate-card:hover {
    border-color: rgba(0, 0, 0, 0.12);
    background: rgba(0, 0, 0, 0.04);
  }

  /* Empty State Styles */
  .empty-state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    text-align: center;
    gap: 24px;
    animation: fadeInScale 0.4s var(--easing-smooth);
  }

  .empty-state-container.horizontal {
    flex-direction: row;
    text-align: left;
    padding: 32px 24px;
    gap: 32px;
  }

  .empty-hints.vertical {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 0;
  }

  .empty-state-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-main);
    margin: 0;
  }

  .empty-description {
    font-size: 14px;
    color: var(--text-muted);
    margin: 0;
    max-width: 320px;
    line-height: 1.5;
  }

  .empty-hints {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .empty-hint {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text-secondary);
    padding: 8px 16px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    transition: all 0.2s var(--easing);
  }

  .empty-hint:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: var(--border-color-strong);
  }

  .hint-icon {
    font-size: 16px;
  }

  :global([data-theme="light"]) .empty-hint {
    background: rgba(0, 0, 0, 0.02);
  }

  :global([data-theme="light"]) .empty-hint:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  /* Loading Skeleton State */
  .loading-state-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .skeleton-card {
    padding: 16px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-color);
    animation: skeletonPulse 1.5s ease-in-out infinite;
  }

  /* Staggered backgrounds for skeleton cards */
  .skeleton-card:nth-child(1) {
    background: rgba(255, 255, 255, 0.08);
  }
  .skeleton-card:nth-child(2) {
    background: rgba(255, 255, 255, 0.05);
    animation-delay: 0.1s;
  }
  .skeleton-card:nth-child(3) {
    background: rgba(255, 255, 255, 0.03);
    animation-delay: 0.2s;
  }

  .skeleton-line {
    height: 14px;
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 25%,
      rgba(255, 255, 255, 0.08) 50%,
      rgba(255, 255, 255, 0.04) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .skeleton-line.primary {
    width: 80%;
    margin-bottom: 12px;
  }

  .skeleton-line.secondary {
    width: 60%;
    opacity: 0.6;
  }

  @keyframes skeletonPulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  :global([data-theme="light"]) .skeleton-card {
    background: rgba(0, 0, 0, 0.03);
  }

  :global([data-theme="light"]) .skeleton-line {
    background: linear-gradient(
      90deg,
      rgba(0, 0, 0, 0.04) 25%,
      rgba(0, 0, 0, 0.08) 50%,
      rgba(0, 0, 0, 0.04) 75%
    );
    background-size: 200% 100%;
  }

  .translated-text {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 12px;
    color: var(--text-main);
    line-height: 1.6;
    user-select: text;
    cursor: text;
    white-space: pre-wrap; /* Preserve newlines */
  }

  /* Error Display */
  .error-display {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px 16px;
    text-align: center;
    color: #f87171; /* Soft Red */
    background: rgba(248, 113, 113, 0.1);
    border-radius: var(--radius-md);
    border: 1px solid rgba(248, 113, 113, 0.2);
    margin-top: 10px;
    animation: fadeIn 0.3s ease-out;
  }

  /* ... skipping error-icon-wrapper ... */

  .error-icon {
    color: #f87171;
    animation: rotateIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; /* Overshoot effect */
  }

  @keyframes rotateIn {
    0% {
      opacity: 0;
      transform: rotate(-90deg) scale(0.5);
    }
    60% {
      transform: rotate(20deg) scale(1.1); /* Rotate past 0 */
    }
    100% {
      opacity: 1;
      transform: rotate(0) scale(1);
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .error-message {
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-line; /* Allow newlines */
  }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 10px;
  }

  .reason {
    font-size: 13px; /* Increased from 12px */
    color: var(
      --text-main
    ); /* Changed from muted to main for better visibility */
    opacity: 0.9;
    flex: 1;
    line-height: 1.4;
    display: flex;
    gap: 5px;
    align-items: flex-start;
  }

  .candidate-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.2s;
    flex-shrink: 0;
  }

  .compact-shell .candidate-actions {
    gap: 0;
  }

  .compact-shell .candidate-actions .icon-btn {
    padding: 3px;
  }

  .compact-shell .reason {
    flex: 1 1 auto;
    min-width: 0;
  }

  .compact-shell .action-menu-item {
    padding: 6px 8px;
    font-size: 12px;
  }

  .action-menu {
    position: relative;
    display: inline-flex;
  }

  .action-menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 6px;
    min-width: 150px;
    padding: 6px;
    background: rgba(24, 24, 28, 0.95);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 140;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .action-menu-item {
    border: none;
    background: transparent;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 12px;
    cursor: pointer;
    transition:
      background 0.2s,
      color 0.2s;
  }

  .action-menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--primary-hover);
  }
  .action-menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-menu-item.copied {
    color: #22c55e;
  }

  .action-menu-item.active {
    color: var(--primary-hover);
  }

  .action-menu-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
  }

  .action-menu-item.copy-item.animating .copy-icon {
    animation: copySlide 0.6s var(--easing);
  }

  .action-menu-item.speak-item.animating .wave-2 {
    animation: wavePulse 1.2s ease-in-out;
  }

  .action-menu-item.speak-item.animating .wave-3 {
    animation: wavePulse 1.2s ease-in-out 0.15s;
  }

  .candidate-card:hover .candidate-actions,
  .candidate-card:focus-within .candidate-actions {
    opacity: 1;
  }

  .icon-btn-small {
    background: transparent;
    border: none;
    cursor: pointer;
    min-width: 28px;
    min-height: 28px;
    padding: 4px;
    border-radius: 4px;
    color: var(--text-muted);
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn-small:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: var(--primary-color);
  }
  .icon-btn-small:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .icon-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    min-width: 32px;
    min-height: 32px;
    padding: 6px;
    border-radius: 4px;
    color: var(--text-muted);
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--primary-hover);
  }
  .icon-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .icon-btn:active {
    transform: scale(0.92);
  }

  .replace-btn.replaced {
    color: #34d399;
  }

  @keyframes copySlide {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(-2px, -2px);
    }
  }

  /* Spinning loader */
  .loading-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* 読み上げボタン: 音波が順番に現れて消える */
  .wave-1 {
    opacity: 1;
  }

  .wave-2,
  .wave-3 {
    opacity: 0;
  }

  @keyframes wavePulse {
    0% {
      opacity: 0;
      transform: translateX(-2px);
    }
    30% {
      opacity: 1;
      transform: translateX(0);
    }
    70% {
      opacity: 1;
      transform: translateX(0);
    }
    100% {
      opacity: 0;
      transform: translateX(-2px);
    }
  }

  .check-icon {
    animation: checkPop 0.3s var(--easing);
  }

  @keyframes checkPop {
    0% {
      transform: scale(0);
      opacity: 0;
    }
    50% {
      transform: scale(1.3);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* Explanation */
  .explanation-card {
    padding: 12px 12px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  h3 {
    font-size: 12px;
    margin-bottom: 8px;
    color: var(--text-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .explanation-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .explanation-list li {
    font-size: 12px;
    line-height: 1.5;
    color: #b0b0b0;
  }

  .explanation-list strong {
    color: var(--primary-hover);
    font-weight: 500;
  }
  .lang-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* Settings Modal Styles */
  .settings-overlay,
  .modal-overlay {
    all: unset;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 2000;
    display: flex;
    justify-content: center;
    align-items: center;
    backdrop-filter: blur(4px);
    cursor: default;
  }

  .overlay-dismiss {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .settings-panel {
    position: relative;
    z-index: 1;
    width: 95%;
    max-width: 800px;
    height: 95%;
    max-height: 800px;
    background: var(--glass-color);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    transition:
      max-width 0.3s cubic-bezier(0.16, 1, 0.3, 1),
      height 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .settings-panel.style-editor-mode {
    max-width: 1000px;
    height: 80vh;
  }

  /* History Panel Styles */

  .history-actions-top {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .style-item-card {
    background: rgba(255, 255, 255, 0.05); /* Slightly lighter */
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    padding: 8px 12px; /* Reduced from 12px */
    display: flex;
    flex-direction: column;
    gap: 4px; /* Reduced gap */
    transition: all 0.2s;
  }

  .history-item {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 12px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
  }

  .history-item:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: translateY(-1px);
  }

  .history-meta {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .history-source {
    font-size: 13px;
    color: var(--text-main);
    font-weight: 500;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-preview {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-state {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    border-bottom: 1px solid var(--border-color);
  }

  .settings-header h2 {
    font-size: 18px;
    font-weight: 600;
    padding-top: 10px;
    padding-bottom: 10px;
    padding-left: 15px;
    padding-right: 15px;
    color: var(--text-main);
    margin: 0;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 5px;
    margin-right: 15px;
    border-radius: 4px;
    transition: all 0.2s;
  }
  .close-btn:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.1);
  }

  .settings-body-container {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .settings-sidebar {
    width: 140px;
    border-right: 1px solid var(--border-color);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: rgba(0, 0, 0, 0.1);
  }

  .settings-tab {
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
  }
  .settings-tab:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.05);
  }
  .settings-tab.active {
    color: var(--primary-color);
    background: rgba(59, 130, 246, 0.1); /* Primary subtle bg */
  }

  .settings-main-content {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.1); /* Slightly darker content area */
  }

  /* The scrolling container for the tab content */
  .tab-content-wrapper {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .settings-row-description {
    flex: 1;
    padding-right: 10px;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .toggle-switch {
    width: 46px;
    height: 28px;
    flex: 0 0 auto;
    position: relative;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition:
      background 0.2s var(--easing),
      border-color 0.2s var(--easing);
  }

  .toggle-switch.on {
    background: var(--primary-color);
    border-color: var(--primary-color);
  }

  .toggle-switch:focus-visible {
    box-shadow: var(--focus-ring-strong);
  }

  .toggle-knob {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
    transition: transform 0.2s var(--easing);
  }

  .toggle-switch.on .toggle-knob {
    transform: translateX(18px);
  }

  .segmented-control {
    display: flex;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.18);
  }

  .segmented-option {
    min-width: 36px;
    min-height: 30px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition:
      background 0.2s var(--easing),
      color 0.2s var(--easing);
  }

  .segmented-option:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-main);
  }

  .segmented-option.active {
    background: var(--primary-color);
    color: #fff;
  }

  .settings-stack {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .permission-row {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .permission-row.divided {
    border-top: 1px solid var(--border-color);
    padding-top: 12px;
  }

  .permission-copy {
    flex: 1;
    min-width: 0;
  }

  .permission-name {
    color: var(--text-main);
    font-size: 13px;
    font-weight: 600;
  }

  .permission-status {
    margin-top: 2px;
    font-size: 11px;
  }

  .permission-status.pending {
    color: var(--text-muted);
  }

  .permission-status.granted {
    color: var(--success-color);
  }

  .permission-status.denied {
    color: var(--error-color);
  }

  .option-stack {
    align-items: stretch;
  }

  .option-row {
    display: flex;
    width: 100%;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }

  .option-row input {
    margin-top: 3px;
    cursor: pointer;
  }

  .option-copy {
    flex: 1;
    min-width: 0;
  }

  .option-title {
    color: var(--text-main);
    font-size: 14px;
    font-weight: 600;
  }

  .option-description {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .shortcut-row .settings-input {
    flex: 1;
  }

  .apply-shortcut-btn {
    min-width: 88px;
    height: 40px; /* Match .settings-input height (10px*2 + 14px line + 1px*2 border approx) */
  }

  .save-btn.apply-shortcut-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .shortcut-hint {
    font-size: 12px;
    color: var(--text-muted);
  }

  .shortcut-error {
    font-size: 12px;
    color: #f87171;
  }

  /* Star Button Animation */
  .star-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 8px;
    border-radius: 50%;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .star-btn:hover {
    background: rgba(255, 235, 59, 0.1);
    color: #fdd835;
    transform: scale(1.1);
  }

  .star-btn.active {
    color: #fdd835;
  }

  .star-btn.animating svg {
    animation: starPop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  @keyframes starPop {
    0% {
      transform: scale(1);
    }
    15% {
      transform: scale(0.6) rotate(-10deg);
    }
    45% {
      transform: scale(1.6) rotate(15deg);
    }
    65% {
      transform: scale(1.2) rotate(-8deg);
    }
    85% {
      transform: scale(1.1) rotate(4deg);
    }
    100% {
      transform: scale(1) rotate(0);
    }
  }

  .star-btn.small {
    padding: 6px;
  }

  /* Main screen save favorite button */
  .save-favorite-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    position: relative;
    overflow: visible;
  }

  .save-favorite-btn:hover {
    background: rgba(255, 235, 59, 0.1);
    border-color: rgba(255, 235, 59, 0.2);
    color: #fdd835;
    transform: scale(1.02);
  }

  .save-favorite-btn.active {
    color: #fdd835;
    border-color: rgba(255, 235, 59, 0.3);
  }

  .save-favorite-btn.animating .save-star-icon {
    animation: starPop 0.75s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    filter: drop-shadow(0 0 6px rgba(253, 216, 53, 0.6));
  }
  .save-favorite-btn.animating {
    background: rgba(255, 235, 59, 0.15);
    border-color: rgba(255, 235, 59, 0.4);
    box-shadow: 0 0 15px rgba(255, 235, 59, 0.2);
  }
  .save-favorite-btn.animating::after {
    content: "✦";
    position: absolute;
    right: -6px;
    top: -8px;
    font-size: 12px;
    color: #fdd835;
    opacity: 0;
    animation: sparkleFloat 0.8s ease-out;
    pointer-events: none;
  }

  .save-label {
    font-weight: 500;
  }

  .history-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    align-items: stretch;
    cursor: default;
  }

  .history-item-main {
    flex: 1;
    min-width: 0;
    cursor: pointer;
    overflow: hidden;
    background: none;
    border: none;
    text-align: left;
    padding: 0;
    color: inherit;
    font: inherit;
    align-items: flex-start;
  }

  /* Prevent history modal content from centering text */
  .history-panel .settings-body-container,
  .history-panel .tab-content-wrapper,
  .history-panel .settings-main-content {
    align-items: stretch;
  }

  .history-item-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .history-item-actions.vertical {
    flex-direction: column;
  }

  .move-actions {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .settings-select,
  .settings-input,
  .settings-card-row {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 14px;
    color: var(--text-main);
    outline: none;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }

  .settings-card-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .settings-select:focus,
  .settings-input:focus {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px rgba(var(--primary-rgb, 100, 150, 255), 0.2);
  }

  .settings-select option {
    background: #1a1a2e;
    color: var(--text-main);
  }

  .settings-textarea {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 14px;
    color: var(--text-main);
    outline: none;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
    resize: vertical;
    min-height: 100px;
    font-family: inherit;
    line-height: 1.5;
  }

  .settings-textarea:focus {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px rgba(var(--primary-rgb, 100, 150, 255), 0.2);
  }

  .back-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s;
    margin-right: 8px;
  }
  .back-btn:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.1);
  }

  .input-hint {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 6px;
  }

  .settings-content.style-editor-content {
    padding: 30px;
  }

  .settings-content.style-editor-content .settings-section.full-height {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .settings-content.style-editor-content
    .settings-section.full-height
    textarea {
    flex: 1;
  }

  .settings-footer {
    padding: 20px;
    border-top: 1px solid var(--border-color);
    display: flex;
    gap: 10px;
  }

  .save-btn {
    width: 100%;
    padding: 12px;
    background: var(--primary-color);
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    cursor: pointer;
    transition: all 0.2s;
  }
  .save-btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  .save-btn:active {
    transform: translateY(0);
  }

  /* Styles Tab Improvements */
  .styles-actions-top {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
  }

  .rich-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 12px;
    font-weight: 500;
    font-size: 14px;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: all 0.2s ease;
    backdrop-filter: blur(4px);
  }

  .rich-btn.primary {
    background: linear-gradient(
      135deg,
      rgba(59, 130, 246, 0.2),
      rgba(59, 130, 246, 0.1)
    );
    color: #60a5fa;
    border-color: rgba(59, 130, 246, 0.2);
  }

  .rich-btn.primary:hover {
    background: linear-gradient(
      135deg,
      rgba(59, 130, 246, 0.3),
      rgba(59, 130, 246, 0.2)
    );
  }

  .rich-btn.danger {
    background: linear-gradient(
      135deg,
      rgba(239, 68, 68, 0.15),
      rgba(239, 68, 68, 0.05)
    );
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.2);
  }

  .rich-btn.danger:hover {
    background: linear-gradient(
      135deg,
      rgba(239, 68, 68, 0.25),
      rgba(239, 68, 68, 0.15)
    );
  }

  .rich-btn.secondary {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-secondary);
  }

  .rich-btn.secondary:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .btn-icon-left {
    margin-right: -4px;
  }

  .style-item-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
    transition: all 0.2s ease;
  }

  .style-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 32px;
  }

  .style-name-display {
    font-weight: 600;
    color: var(--text-main);
    font-size: 15px;
  }

  .style-header-actions {
    display: flex;
    gap: 2px;
  }

  .icon-btn-small {
    min-width: 28px;
    min-height: 28px;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .icon-btn-small:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .icon-btn-small.delete-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }

  /* Modal */

  .modal-card {
    position: relative;
    z-index: 1;
    width: 90%;
    max-width: 400px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }

  .modal-card h3 {
    margin-top: 0;
    margin-bottom: 24px;
    font-size: 18px;
    color: var(--text-main);
    text-align: center;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .theme-toggle {
    display: flex;
    gap: 8px;
  }

  .theme-btn {
    flex: 1;
    padding: 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    font-size: 13px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }
  .theme-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-main);
  }
  .theme-btn.active {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: #fff;
  }

  /* Provider Switcher */
  .provider-switcher {
    display: flex;
    background: rgba(0, 0, 0, 0.2);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    margin-bottom: 20px;
  }

  .provider-btn {
    flex: 1;
    padding: 8px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .provider-btn:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.05);
  }

  .provider-btn.active {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .provider-docs-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    text-align: left;
    border: 1px solid var(--border-color);
    background: rgba(0, 0, 0, 0.2);
    appearance: none;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .provider-docs-btn:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .provider-docs-btn:active {
    transform: translateY(1px);
  }

  .provider-docs-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .provider-docs-title {
    font-size: 14px;
    font-weight: 600;
  }

  .provider-docs-action {
    font-size: 12px;
    color: var(--text-muted);
  }

  .provider-docs-btn svg {
    opacity: 0.7;
  }

  /* Overflow Dropdown */
  .style-dropdown-wrapper {
    position: relative;
  }

  .style-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    width: 200px;
    background: rgba(30, 30, 35, 0.95);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 6px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    z-index: 100;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dropdown-section-label {
    font-size: 11px;
    color: var(--text-secondary);
    padding: 4px 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.7;
  }

  .dropdown-item {
    position: relative;
    overflow: hidden;
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--text-main);
    text-align: left;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
  }

  .dropdown-item:hover {
    background: rgba(255, 255, 255, 0.08); /* Hover effect on top of fill */
  }

  .dropdown-item-content {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    width: 100%;
    align-items: center;
  }

  .dropdown-item-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: var(--primary-color);
    opacity: 0.15;
    transition:
      width 0.2s cubic-bezier(0.2, 0, 0.2, 1),
      background-color 0.2s;
    z-index: 1;
    border-radius: 4px; /* Slightly smaller radius than container */
  }

  .dropdown-item[data-level="1"] .dropdown-item-fill {
    background: var(--primary-color);
    opacity: 0.2;
  }
  .dropdown-item[data-level="2"] .dropdown-item-fill {
    background: var(--primary-color);
    opacity: 0.4;
  }

  .dropdown-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 4px 0;
  }

  .dropdown-item.settings-link {
    color: var(--text-secondary);
    font-size: 13px;
  }

  .dropdown-item.settings-link:hover {
    color: var(--text-main);
  }

  .icon-left {
    margin-right: 8px;
    opacity: 0.8;
  }

  /* Active state for overflow button */
  .style-chip.add-chip.active {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.2);
  }
  .style-prompt-text {
    margin-top: 8px;
    font-size: 13px;
    color: var(--text-muted);
    white-space: pre-wrap;
    line-height: 1.6;
  }

  .tech-info-display {
    margin-top: 6px;
    margin-bottom: 12px;
    display: flex;
    justify-content: center;
    gap: 10px;
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0.8;
    align-items: center;
  }
  .tech-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .tech-item {
    display: flex;
    gap: 4px;
  }
  .tech-label {
    font-weight: 500;
    opacity: 0.7;
  }
  .tech-divider {
    opacity: 0.3;
  }
  .tech-tokens {
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    line-height: 1.3;
  }
  .token-row {
    display: flex;
    gap: 4px;
  }

  .compact-shell .tech-info-display {
    flex-wrap: wrap;
    justify-content: center;
    gap: 5px;
    font-size: 10px;
    align-items: center;
    white-space: normal;
    overflow: visible;
    flex-direction: column;
  }

  .compact-shell .tech-divider {
    display: inline;
    opacity: 0.4;
  }

  .compact-shell .tech-item {
    white-space: nowrap;
  }

  /* ==================== LIGHT MODE OVERRIDES ==================== */

  /* Style chips */
  :global([data-theme="light"]) .style-chip {
    border-color: rgba(0, 0, 0, 0.08);
    background: rgba(0, 0, 0, 0.02);
  }
  :global([data-theme="light"]) .style-chip:hover {
    border-color: rgba(0, 0, 0, 0.15);
    background: rgba(0, 0, 0, 0.04);
  }
  :global([data-theme="light"]) .style-chip[data-level="1"],
  :global([data-theme="light"]) .style-chip[data-level="2"] {
    border-color: rgba(99, 102, 241, 0.25);
    background: rgba(99, 102, 241, 0.06);
  }
  :global([data-theme="light"]) .style-chip[data-level="2"] {
    border-color: rgba(99, 102, 241, 0.4);
    background: rgba(99, 102, 241, 0.12);
  }
  :global([data-theme="light"]) .style-chip.add-chip.active {
    background: rgba(0, 0, 0, 0.06);
    border-color: rgba(0, 0, 0, 0.12);
  }

  /* Language menu */
  :global([data-theme="light"]) .lang-menu {
    background: rgba(255, 255, 255, 0.95);
  }
  :global([data-theme="light"]) .lang-option:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .action-menu-dropdown {
    background: rgba(255, 255, 255, 0.95);
    border-color: rgba(0, 0, 0, 0.08);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  :global([data-theme="light"]) .action-menu-item:hover {
    background: rgba(0, 0, 0, 0.06);
    color: #2563eb;
  }

  /* Icon buttons */
  :global([data-theme="light"]) .icon-btn:hover {
    background: rgba(0, 0, 0, 0.08);
  }
  :global([data-theme="light"]) .icon-btn-small:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.08);
  }

  /* Explanation card */
  :global([data-theme="light"]) .explanation-card {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.08);
  }
  :global([data-theme="light"]) .explanation-list li {
    color: #555;
  }

  /* History items */
  :global([data-theme="light"]) .history-item {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.08);
  }
  :global([data-theme="light"]) .history-item:hover {
    background: rgba(0, 0, 0, 0.06);
  }

  /* Settings inputs */
  :global([data-theme="light"]) .settings-select,
  :global([data-theme="light"]) .settings-input,
  :global([data-theme="light"]) .settings-textarea {
    background: rgba(0, 0, 0, 0.04);
  }
  :global([data-theme="light"]) .settings-select option {
    background: #fff;
    color: #1a1a1a;
  }

  /* Settings sidebar */
  :global([data-theme="light"]) .settings-sidebar {
    background: rgba(0, 0, 0, 0.03);
  }
  :global([data-theme="light"]) .settings-tab:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .settings-tab.active {
    background: rgba(59, 130, 246, 0.1);
  }

  /* Settings content area */
  :global([data-theme="light"]) .settings-main-content {
    background: #fff;
  }

  :global([data-theme="light"]) .settings-card-row,
  :global([data-theme="light"]) .settings-select,
  :global([data-theme="light"]) .settings-input {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
  }

  /* Dropdown */
  :global([data-theme="light"]) .style-dropdown {
    background: rgba(255, 255, 255, 0.98);
    border-color: rgba(0, 0, 0, 0.1);
  }
  :global([data-theme="light"]) .dropdown-item:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .dropdown-divider {
    background: rgba(0, 0, 0, 0.08);
  }

  /* Provider switcher */
  :global([data-theme="light"]) .provider-switcher {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .provider-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .provider-docs-btn {
    background: rgba(0, 0, 0, 0.03);
  }
  :global([data-theme="light"]) .provider-docs-btn:hover {
    background: rgba(0, 0, 0, 0.08);
  }

  /* Theme buttons */
  :global([data-theme="light"]) .theme-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  /* Toggle switch */
  :global([data-theme="light"]) .toggle-switch {
    background: rgba(0, 0, 0, 0.15);
  }

  /* Styles list in settings */
  :global([data-theme="light"]) .style-item-card {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.08);
  }
  :global([data-theme="light"]) .style-item-card:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  /* Rich buttons */
  :global([data-theme="light"]) .rich-btn.secondary {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .rich-btn.secondary:hover {
    background: rgba(0, 0, 0, 0.1);
  }

  /* Settings panel background */
  :global([data-theme="light"]) .settings-panel {
    background: rgba(255, 255, 255, 0.98);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  }

  /* Close button */
  :global([data-theme="light"]) .close-btn:hover {
    background: rgba(0, 0, 0, 0.08);
  }

  /* Description text */
  :global([data-theme="light"]) .settings-description {
    color: #444;
  }

  /* Input hints */
  :global([data-theme="light"]) .input-hint {
    color: #555;
  }

  /* Back button */
  :global([data-theme="light"]) .back-btn:hover {
    background: rgba(0, 0, 0, 0.08);
  }

  /* Settings textarea in light mode */
  :global([data-theme="light"]) .settings-textarea {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.12);
  }

  /* Modal overlay */
  :global([data-theme="light"]) .settings-overlay,
  :global([data-theme="light"]) .modal-overlay {
    background: rgba(0, 0, 0, 0.4);
  }

  /* Delete button in light mode */
  :global([data-theme="light"]) .delete-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #dc2626;
  }

  /* Star button */
  :global([data-theme="light"]) .star-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .star-btn.active {
    color: #f59e0b;
  }

  /* Tab content */
  :global([data-theme="light"]) .tab-content-wrapper {
    color: #1a1a1a;
  }

  /* Ensure App Title is visible in Light Mode */
  :global([data-theme="light"]) .app-title,
  :global([data-theme="light"]) .compact-name {
    color: var(--text-main);
  }

  :global([data-theme="light"]) .win-btn-inline {
    border-color: rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.6);
  }

  :global([data-theme="light"]) .win-btn-inline:hover {
    background: rgba(0, 0, 0, 0.1);
    border-color: rgba(0, 0, 0, 0.2);
    color: rgba(0, 0, 0, 0.8);
  }

  :global([data-theme="light"]) .win-btn-inline.close:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.2);
    color: #dc2626;
  }

  :global([data-theme="light"]) .compact-shell {
    background: var(--bg-color);
  }

  :global([data-theme="light"]) .compact-shell::before {
    display: none;
  }

  :global([data-theme="light"]) .compact-main-btn {
    background: rgba(59, 130, 246, 0.12);
    border-color: rgba(59, 130, 246, 0.2);
    color: #2563eb;
  }

  /* Fixed width for language buttons to prevent jitter */
  .lang-btn {
    min-width: 15rem; /* ~160px depending on base font */
    justify-content: center;
    position: relative;
  }

  /* Ensure text doesn't overflow */
  .lang-btn span,
  .detecting-label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* History & Settings Button Animation */
  .history-btn.animating svg {
    animation: historyPulse 0.4s ease-out;
  }

  .settings-btn.animating svg {
    animation: settingsSpin 0.4s ease-out;
  }

  @keyframes historyPulse {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.15);
    }
    100% {
      transform: scale(1);
    }
  }

  @keyframes settingsSpin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(90deg);
    }
  }

  .about-tab-content {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 24px;
    height: 100%;
  }

  .about-usage-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .usage-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .usage-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .usage-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .usage-value {
    font-size: 26px;
    font-weight: 700;
    color: var(--text-main);
  }

  .usage-chart-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 16px;
    margin-bottom: 16px;
  }

  .usage-chart-header {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-main);
    margin-bottom: 10px;
  }

  .usage-chart-wrapper {
    width: 100%;
    padding-bottom: 8px;
    position: relative;
  }

  .usage-chart {
    width: 100%;
    height: 200px;
  }

  .usage-chart-baseline {
    stroke: var(--border-color);
    stroke-width: 1;
    opacity: 0.7;
  }

  .usage-bar {
    fill: rgba(99, 102, 241, 0.35);
    pointer-events: none;
  }

  .usage-line {
    fill: none;
    stroke: #22d3ee;
    stroke-width: 2;
    pointer-events: none;
  }

  .usage-line-dot {
    fill: #22d3ee;
    pointer-events: none;
  }

  .usage-hover-hit {
    fill: transparent;
    pointer-events: all;
  }

  .usage-chart-label {
    font-size: 12px;
    fill: var(--text-muted);
  }

  .usage-tooltip {
    position: absolute;
    pointer-events: none;
    transform: translate(-50%, -120%);
    background: rgba(24, 24, 27, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 8px 10px;
    color: var(--text-main);
    font-size: 12px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
    white-space: nowrap;
    z-index: 1;
  }

  .usage-tooltip-date {
    font-weight: 600;
    margin-bottom: 4px;
    font-size: 12px;
  }

  .usage-tooltip-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 2px;
  }

  .usage-tooltip-row:last-child {
    margin-bottom: 0;
  }

  .usage-chart-legend {
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 8px;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .legend-dot.count {
    background: rgba(99, 102, 241, 0.6);
  }

  .legend-dot.tokens {
    background: #22d3ee;
  }

  .usage-chart-skeleton {
    width: 100%;
    height: 200px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px dashed rgba(255, 255, 255, 0.12);
  }

  .about-brand-section {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
  }

  .about-text-content h2 {
    font-size: 30px;
    font-weight: 700;
    margin: 0;
    color: var(--text-main);
  }

  .about-text-content p {
    font-size: 14px;
    color: var(--text-muted);
    margin: 0;
  }

  .about-footer-info {
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.6;
  }

  /* Prevent logo from being dragged */
  .about-logo-wrapper img,
  img[alt*="Logo"] {
    -webkit-user-drag: none;
    user-select: none;
    pointer-events: none;
  }

  /* OCR Button Animation */
  .ocr-btn-animated {
    position: relative;
    overflow: hidden;
  }

  .ocr-btn-animated:hover::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 2px;
    height: 100%;
    background: #22d3ee50;
    box-shadow: 0 0 10px #22d3ee;
    animation: ocrScan 0.5s ease-out forwards;
  }

  @keyframes ocrScan {
    0% {
      left: 0;
      opacity: 1;
    }
    99% {
      opacity: 1;
    }
    100% {
      left: 120%;
      opacity: 0;
    }
  }

  /* Translate Button Animation */
  @media (prefers-reduced-motion: no-preference) {
    .translate-btn-animated:hover:not(:disabled) {
      animation: translatePulse 2s infinite;
    }

    .translate-btn-animated:hover:not(:disabled) svg {
      animation: translateIconShake 0.5s ease-in-out infinite alternate;
    }

    @keyframes translateIconShake {
      0% {
        transform: scale(1);
      }
      100% {
        transform: scale(1.15) rotate(2deg);
      }
    }

    @keyframes translatePulse {
      0% {
        box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4);
      }
      70% {
        box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
      }
    }
  }
  /* Compact Mode Styles */
  .compact-header .compact-icon {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    transform: translateY(0);
  }

  .compact-header .compact-name {
    font-size: 20px;
    font-weight: 700;
    margin-left: 0px;
    opacity: 1;
    color: var(--text-main);
  }
  /* Custom Window Controls */
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* Card Stack UI */
  .stack-indicator {
    width: 100%;
    margin-top: -8px; /* Slight overlap */
    padding: 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 5;
  }

  .stack-layer {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    height: 10px;
    border-radius: 0 0 8px 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-top: none;
    transition: all 0.2s ease;
  }

  .stack-layer.layer-1 {
    width: 96%;
    bottom: 6px;
    z-index: 2;
  }

  .stack-layer.layer-2 {
    width: 92%;
    bottom: 0px;
    z-index: 1;
    background: rgba(255, 255, 255, 0.03);
  }

  .stack-indicator:hover .stack-layer.layer-1 {
    bottom: 4px;
    background: rgba(255, 255, 255, 0.08);
  }
  .stack-indicator:hover .stack-layer.layer-2 {
    bottom: -2px;
    background: rgba(255, 255, 255, 0.05);
  }

  .stack-text {
    position: relative;
    z-index: 3;
    font-size: 11px;
    color: var(--text-muted);
    background: rgba(30, 30, 40, 0.8);
    padding: 2px 8px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    backdrop-filter: blur(4px);
  }

  .collapse-btn {
    appearance: none;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 20px;
    color: var(--text-muted);
    font-size: 11px;
    padding: 4px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: all 0.2s;
  }
  .collapse-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-main);
  }
  /* Quick Screen Light Mode Overrides */
  :global([data-theme="light"]) .compact-close-btn {
    border-color: rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.6);
  }

  :global([data-theme="light"]) .compact-close-btn:hover {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.2);
    color: #dc2626;
  }

  :global([data-theme="light"]) .compact-ocr-btn {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.7);
  }

  :global([data-theme="light"]) .compact-ocr-btn:hover {
    background: rgba(0, 0, 0, 0.1);
    color: rgba(0, 0, 0, 0.9);
  }

  :global([data-theme="light"]) .lang-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }
</style>
