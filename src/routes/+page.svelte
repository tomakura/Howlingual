<script lang="ts">
  import { tick, onMount, onDestroy, untrack } from "svelte";
  import { fade, scale, fly, crossfade } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen, emit, TauriEvent } from "@tauri-apps/api/event";
  import {
    enable as enableAutostart,
    disable as disableAutostart,
    isEnabled as isAutostartEnabled,
  } from "@tauri-apps/plugin-autostart";
  import { type AiModel } from "$lib/ai_service";
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
  const appVersion = "1.0";
  let selectedModel = $state<AiModel>("gpt-5-mini" as AiModel);
  let apiKeys = $state({
    gemini: "",
    openai: "",
    anthropic: "",
  });
  let defaultTargetLang = $state("日本語");
  let theme = $state<"dark" | "light">("dark");
  let appLanguage = $state<"ja" | "en" | "zh" | "ko">("ja");
  let translationCount = $state<1 | 2 | 3>(3); // 翻訳案の個数（1〜3）
  let allowRewrite = $state(false);
  let selectedProvider = $state<"openai" | "gemini" | "anthropic">("openai");
  // プロバイダごとの最後に選択したモデルを記憶
  let lastSelectedModels = $state<Record<string, string>>({
    openai: "gpt-5-mini",
    gemini: "gemini-2.5-flash",
    anthropic: "claude-sonnet-4.5",
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
      }

      // Listen for window_shown event from Rust
      unlistenShown = await listen("window_shown", () => {
        // Slight delay to ensure opacity:0 is applied first
        setTimeout(() => {
          isWindowVisible = true;
        }, 50);
      });

      // Fallback: Show on focus if not visible
      const win = getCurrentWindow();
      unlistenFocus = await win.listen("tauri://focus", () => {
        // If we get focus, make sure we are visible
        // This handles cases where show() didn't emit window_shown or we missed it
        if (!isWindowVisible) {
          requestAnimationFrame(() => {
            isWindowVisible = true;
          });
        }
      });
    })();

    // Handle Escape key globally
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hideWindow();
      }
    };
    window.addEventListener("keydown", handleKeydown);

    return () => {
      if (unlistenShown) unlistenShown();
      if (unlistenFocus) unlistenFocus();
      window.removeEventListener("keydown", handleKeydown);
    };
  });

  function detectLanguageSimple(text: string) {
    // ひらがな・カタカナがあれば確実に日本語
    const hasHiraganaKatakana = /[\u3040-\u30ff]/.test(text);
    if (hasHiraganaKatakana) return "日本語";

    // 漢字のみの場合は日本語として扱う（簡易判定）
    const hasKanji = /[\u4e00-\u9faf]/.test(text);
    if (hasKanji) return "日本語";

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

  const availableModels: { label: string; value: string; provider: string }[] =
    [
      // OpenAI
      { label: "GPT-5.2", value: "gpt-5.2", provider: "openai" },
      { label: "GPT-5.2 Pro", value: "gpt-5.2-pro", provider: "openai" },
      { label: "GPT-5.1", value: "gpt-5.1", provider: "openai" },
      { label: "GPT-5-Mini", value: "gpt-5-mini", provider: "openai" },
      { label: "GPT-5-Nano", value: "gpt-5-nano", provider: "openai" },
      { label: "GPT-4.1", value: "gpt-4.1", provider: "openai" },
      { label: "GPT-4.1-Mini", value: "gpt-4.1-mini", provider: "openai" },
      { label: "GPT-4.1-Nano", value: "gpt-4.1-nano", provider: "openai" },
      { label: "o3-pro", value: "o3-pro", provider: "openai" },
      // Google Gemini
      { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro", provider: "gemini" },
      {
        label: "Gemini 2.5 Flash",
        value: "gemini-2.5-flash",
        provider: "gemini",
      },
      {
        label: "Gemini 2.5 Flash-Lite",
        value: "gemini-2.5-flash-lite",
        provider: "gemini",
      },
      { label: "Gemini 3 Pro", value: "gemini-3-pro", provider: "gemini" },
      { label: "Gemini 3 Flash", value: "gemini-3-flash", provider: "gemini" },
      // Anthropic Claude
      {
        label: "Claude Opus 4.5",
        value: "claude-opus-4.5",
        provider: "anthropic",
      },
      {
        label: "Claude Sonnet 4.5",
        value: "claude-sonnet-4.5",
        provider: "anthropic",
      },
      {
        label: "Claude Haiku 4.5",
        value: "claude-haiku-4.5",
        provider: "anthropic",
      },
    ];

  let filteredModels = $derived(
    availableModels.filter((m) => m.provider === selectedProvider),
  );

  async function detectWindowMode() {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    if (viewParam === "compact") {
      isCompactMode = true;
      isCaptureMode = false;
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
    void detectWindowMode();
    const saved = localStorage.getItem("howlingual_settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.model) {
          selectedModel = parsed.model;
          const found = availableModels.find((m) => m.value === selectedModel);
          if (found) {
            selectedProvider = found.provider as any;
          }
        }
        if (parsed.apiKeys) apiKeys = { ...apiKeys, ...parsed.apiKeys };
        if (parsed.defaultTargetLang)
          defaultTargetLang = parsed.defaultTargetLang;
        if (parsed.theme) theme = parsed.theme;
        if (parsed.appLanguage) appLanguage = parsed.appLanguage;
        // customStyles removed from settings to avoid conflict with dedicated storage
        if (parsed.allowRewrite !== undefined)
          allowRewrite = parsed.allowRewrite;
        if (parsed.quickShortcut) quickShortcut = parsed.quickShortcut;
        if (parsed.autoRunQuick !== undefined)
          autoRunQuick = parsed.autoRunQuick;
        if (parsed.autoStartEnabled !== undefined)
          autoStartEnabled = parsed.autoStartEnabled;
        if (parsed.startMinimized !== undefined)
          startMinimized = parsed.startMinimized;
        if (parsed.lastSelectedModels)
          lastSelectedModels = {
            ...lastSelectedModels,
            ...parsed.lastSelectedModels,
          };
        if (
          parsed.translationCount &&
          [1, 2, 3].includes(parsed.translationCount)
        )
          translationCount = parsed.translationCount;

        // Apply theme on load
        document.documentElement.setAttribute("data-theme", theme);
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
    const viewParam = new URLSearchParams(window.location.search).get("view");
    if (viewParam !== "compact") {
      void syncShortcut();
    }

    (async () => {
      try {
        autoStartEnabled = await isAutostartEnabled();
      } catch (e) {
        console.warn("Failed to read autostart state", e);
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
            // Ensure focus if not starting minimized
            await window.setFocus();
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
  });

  // Service Integration
  onMount(() => {
    let unlisten: () => void;
    (async () => {
      // Sync state on load
      console.log("[UI] Requesting Sync State...");
      await emit("request_sync_state");

      // Listen for OCR handover data
      const unlistenHandover = await listen<string>(
        "handover_data",
        async (event) => {
          const text = event.payload;
          if (text && text.trim()) {
            await handleHandover(text);
          }
        },
      );

      // Check for pending handover text (in case we missed the event during load)
      try {
        const pending = await invoke<string | null>("get_handover_text");
        if (pending && pending.trim()) {
          await handleHandover(pending);
        }
      } catch (e) {
        console.warn("Failed to check handover text:", e);
      }

      unlisten = await listen<any>("translation_update", (event) => {
        const p = event.payload;

        // --- ECHO GUARD ---
        // Ignore updates for old input text to prevent "jumpy" UI when typing fast.
        // During active detection or translation, the service might echo old states.
        if (p.inputQuery !== undefined && p.inputQuery !== inputQuery) {
          // If this window is the one being focused/typed in, ignore external content updates.
          // This prevents stale echoes from the's service from reverting our local input.
          if (textareaEl && document.activeElement === textareaEl) {
            return;
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
        techMetrics = p.techMetrics;

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
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let hasReceivedText = false;
    let checkCount = 0;

    async function checkPendingText() {
      // Don't consume pending text if we are navigating to main window
      if (isOpeningMain) return;

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

          // Use applyQuickText which respects autoRunQuick setting
          syncShowTechInfoFromStorage();
          await applyQuickText(text);

          // Stop polling once we got text
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
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
            techMetrics = {
              time: 0,
              waitTime: 0,
              genTime: 0,
              model: "",
              inputTokens: 0,
              outputTokens: 0,
              tokensPerSec: 0,
              isReal: false,
              firstTokenReceived: false,
            };
            autoScrollEnabled = true;
          }
        }
      } catch (error) {
        // Ignore errors (command may not exist in web mode)
      }
    }

    // Check immediately (Run once for BOTH modes to catch handover/initial data)
    void checkPendingText();

    // Check immediately if we are in compact mode
    if (isCompactMode) {
      // Also check periodically (in case window was already visible)
      intervalId = setInterval(() => {
        void checkPendingText();
      }, 100);
    }

    // Stop polling after 3 seconds if nothing received
    setTimeout(() => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }, 3000);

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

      // Parse JSON payload with full translation state
      try {
        const payload = JSON.parse(event.payload);
        console.log("[handover] Parsed payload:", payload);

        // Restore source text
        inputQuery = payload.sourceText || "";
        lastTranslatedText = inputQuery;

        // Restore translations
        if (payload.translations && Array.isArray(payload.translations)) {
          translations = payload.translations.map((t: any, i: number) => ({
            id: i + 1,
            text: t.text || "",
            reason: t.reason || "",
          }));
        }

        // Restore explanation
        if (payload.detailedExplanation) {
          detailedExplanation = payload.detailedExplanation;
          showExplanation = true;
        } else {
          detailedExplanation = null;
          showExplanation = false;
        }

        // Restore language settings
        if (payload.sourceLang) {
          applySourceLangFromSync(payload.sourceLang, payload.detectedLang);
        }
        if (payload.targetLang) {
          targetLang = payload.targetLang;
        }

        // Restore style levels
        if (payload.styleLevels) {
          styleLevels = normalizeStyleLevels(
            { ...styleLevels, ...payload.styleLevels },
            customStyles,
          );
        }

        // Restore techMetrics
        if (payload.techMetrics) {
          techMetrics = { ...techMetrics, ...payload.techMetrics };
        }

        // Restore showTechInfo
        if (typeof payload.showTechInfo === "boolean") {
          showTechInfo = payload.showTechInfo;
        }

        console.log("[handover] Restored state:", {
          translations: translations.length,
          techMetrics: techMetrics.time,
          showTechInfo: showTechInfo, // Debug log
          isTranslating: payload.isTranslating,
        });

        isTranslating = Boolean(payload.isTranslating);

        void tick().then(async () => {
          autoResize();
          await emit("request_sync_state");
        });
      } catch (e) {
        // Fallback: treat as plain text (old behavior)
        console.log("[handover] Fallback to plain text:", e);
        void applyQuickText(event.payload);
      }
    });

    return async () => {
      if (intervalId) clearInterval(intervalId);
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

  // Auto-save settings when changed
  $effect(() => {
    const settings = {
      model: selectedModel,
      apiKeys: apiKeys,
      defaultTargetLang: defaultTargetLang,
      theme: theme,
      appLanguage: appLanguage,
      // customStyles: customStyles, // Removed from general settings, saved separately
      allowRewrite: allowRewrite,
      quickShortcut: quickShortcut,
      autoRunQuick: autoRunQuick,
      autoStartEnabled: autoStartEnabled,
      startMinimized: startMinimized,
      lastSelectedModels: lastSelectedModels,
      translationCount: translationCount,
    };
    localStorage.setItem("howlingual_settings", JSON.stringify(settings));

    // Apply theme immediately
    document.documentElement.setAttribute("data-theme", theme);

    // console.log("[Settings] Auto-saved");
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

  let styleLevels: Record<string, number> = $state(
    normalizeStyleLevels({}, customStyles),
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

  function selectProvider(provider: "openai" | "gemini" | "anthropic") {
    // 現在のモデルを現在のプロバイダに保存
    lastSelectedModels[selectedProvider] = selectedModel;

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
    const defaultForProvider = availableModels.find(
      (m) => m.provider === provider,
    );
    if (defaultForProvider) {
      selectedModel = defaultForProvider.value as AiModel;
    }
  }

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

  function openSettingsModal() {
    settingsTab = "appearance";
    showSettings = true;
  }

  async function handleWindowKeydown(e: KeyboardEvent) {
    if (isCaptureMode) return; // Let CaptureOverlay handle events
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void startTranslation();
      return;
    }
    if (e.key === "Escape") {
      if (isCompactMode) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().hide();
        return;
      }

      // Blur active element to prevent focus rings after closing
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      if (actionMenuOpenId !== null) {
        actionMenuOpenId = null;
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
        showSettings = false;
        return;
      }
      if (showHistory) {
        showHistory = false;
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
    showSettings = true;
  }

  function openStyles() {
    settingsTab = "styles";
    showSettings = true;
  }

  function closeSettings() {
    showSettings = false;
  }

  async function startOCR() {
    try {
      console.log("[UI] Starting OCR selection...");
      isWaitingForOCR = true;
      const origin = isCompactMode ? "compact" : "main";
      await invoke("start_selection_ocr", { origin });
    } catch (e) {
      console.error("[UI] OCR trigger failed:", e);
      errorMessage = "OCR Error: " + String(e);
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
        // Map translations to ensure reactive updates if needed
        translations = data.translations || [];
        detailedExplanation = data.detailedExplanation || null;
        showExplanation = !!detailedExplanation;

        sourceLang = data.sourceLang || sourceLang;
        targetLang = data.targetLang || targetLang;
        detectedLang = data.detectedLang || "";

        if (data.styleLevels) styleLevels = data.styleLevels;
        if (data.techMetrics) techMetrics = data.techMetrics;
        if (data.showTechInfo !== undefined) showTechInfo = data.showTechInfo;

        // Restore translating state if it was interrupted
        isTranslating = data.isTranslating || false;

        await tick();
        await autoResize();
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
    translations = [
      { id: 1, text: "", reason: "" },
      { id: 2, text: "", reason: "" },
      { id: 3, text: "", reason: "" },
    ];
    detailedExplanation = null;
    showExplanation = false;
    errorMessage = "";
    autoScrollEnabled = true;
    lastStreamCharCount = 0;
    // Reset tech metrics
    techMetrics = {
      time: 0,
      waitTime: 0,
      genTime: 0,
      model: "",
      inputTokens: 0,
      outputTokens: 0,
      tokensPerSec: 0,
      isReal: false,
      firstTokenReceived: false,
    };
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
        !target.closest(".settings-panel") && // Added to close settings on outside click
        !target.closest(".history-panel") && // Added to close history on outside click
        !target.closest(".compact-style") &&
        !target.closest(".action-menu")
      ) {
        showSourceLangMenu = false;
        showTargetLangMenu = false;
        styleOverflowOpen = false;
        compactStylesOpen = false;
        actionMenuOpenId = null;
        showSettings = false; // Close settings
        showHistory = false; // Close history
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

  function handleCopy(id: number, text: string) {
    console.log(`[UI] Copy triggered for ID: ${id}`);
    navigator.clipboard.writeText(text);
    copiedId = id;
    setTimeout(() => {
      copiedId = null;
    }, 1500);
  }

  async function handleReplace(id: number, text: string) {
    console.log(`[UI] Replace triggered for ID: ${id}`);
    actionMenuOpenId = null;
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
    if (!window.speechSynthesis) return;

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
      textareaEl.style.overflowY = "hidden";
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

  // Technical Info
  type HistoryItem = {
    id: string;
    timestamp: number;
    sourceText: string;
    sourceLang: string;
    targetLang: string;
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

  function toggleFavorite(item: HistoryItem) {
    // Check by id first for history list, fallback to sourceText for main screen
    const existingIdx = favorites.findIndex(
      (f) => f.id === item.id || f.sourceText === item.sourceText,
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
    return favorites.some((f) => f.sourceText === sourceText);
  }

  function isFavoritedById(id: string): boolean {
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
    if (item.sourceLang === "自動検出") {
      selectSourceLang(null);
    } else if (languages.includes(item.sourceLang)) {
      selectSourceLang(item.sourceLang);
    }

    // Restore style levels
    if (item.styleLevels) {
      styleLevels = { ...styleLevels, ...item.styleLevels };
    }

    persistLastResult();

    showHistory = false;
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

  let techMetrics = $state({
    time: 0,
    waitTime: 0, // Time until first token
    genTime: 0, // Time for generation after first token
    model: "",
    inputTokens: 0,
    outputTokens: 0,
    tokensPerSec: 0,
    isReal: false,
    firstTokenReceived: false,
  });
  let timerInterval: any;
  let initialTokens = 0;
  let firstTokenTime = 0;

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
      // Dispatch Command to Service
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
        explanationLang: getLanguageName(appLanguage),
        apiKeys: $state.snapshot(apiKeys),
        initialTokens: Math.ceil(inputQuery.length / 1.5) + 40,
        candidateCount: translationCount,
      });
    } catch (error) {
      console.error("Translation failed:", error);
      errorMessage = "Translation failed to start.";
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
          style="width: 28px; height: 28px;"
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
          aria-label="Close"
          title="Close"
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
        style="position: absolute; left: 12px; display: flex; gap: 8px; align-items: center;"
      >
        <!-- Paste / Clear Button -->
        {#if inputQuery.trim()}
          <button
            class="icon-btn compact-action-btn"
            onclick={() => (inputQuery = "")}
            title={t(appLanguage, "clearText") || "テキストをクリア"}
            style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; color: var(--text-color);"
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
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        {:else}
          <button
            class="icon-btn compact-action-btn"
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
            style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; color: var(--text-color);"
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
              <path
                d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
              ></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
          </button>
        {/if}

        <!-- OCR Button -->
        <button
          class="icon-btn compact-ocr-btn"
          onclick={startOCR}
          title={t(appLanguage, "startOCR") || "画面から文字を読み取る"}
          style="width: 32px; height: 32px; border-radius: 8px; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; color: var(--text-color);"
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
              {detectedLang} - {t(appLanguage, "detected")}
            {:else if isAutoDetect && isDetecting}
              {t(appLanguage, "detecting")}
            {:else if isAutoDetect}
              {t(appLanguage, "autoDetect")}
            {:else}
              {sourceLang}
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
                自動検出
              </button>
              <div class="menu-divider"></div>
              {#each languages as lang}
                <button
                  class="lang-option {!isAutoDetect && lang === sourceLang
                    ? 'active'
                    : ''}"
                  onclick={() => selectSourceLang(lang)}>{lang}</button
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
            {targetLang}
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
                  onclick={() => selectTargetLang(lang)}>{lang}</button
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
            <textarea
              bind:this={textareaEl}
              bind:value={inputQuery}
              oninput={handleInputChange}
              onscroll={checkScroll}
              class:long-text={isLongText}
              class="compact-textarea"
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
              <div
                style="flex: 1; display: flex; align-items: center; gap: 6px; overflow: hidden; height: 100%;"
              >
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
            <span class="tech-item">
              <span class="tech-label">Wait:</span>
              {#if isTranslating && !techMetrics.firstTokenReceived}
                {techMetrics.time.toFixed(1)}s
              {:else}
                {techMetrics.waitTime.toFixed(2)}s
              {/if}
            </span>
            <span class="tech-divider">→</span>
            <span class="tech-item">
              <span class="tech-label">Gen:</span>
              {#if isTranslating}
                {techMetrics.genTime.toFixed(1)}s
              {:else}
                {techMetrics.genTime.toFixed(2)}s
              {/if}
            </span>
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
              style="display: flex; justify-content: center; align-items: center; gap: 6px; margin-top: 16px; padding-bottom: 16px;"
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
                aria-label="Favorite current translation"
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
    <header class="app-header" data-tauri-drag-region>
      <div class="header-left">
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

    <!-- Fixed Favorite Button - Right Edge (moved outside of header-actions-row) -->
    {#if translations.some((t) => t.text) && !isTranslating}
      <button
        class="save-favorite-btn-fixed"
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
        title={t(appLanguage, "saveToFavorites") || "お気に入りに保存"}
      >
        <svg
          class="save-star-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={isFavorited(inputQuery) ? "currentColor" : "none"}
          stroke="currentColor"
          stroke-width="2"
        >
          <polygon
            points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
          ></polygon>
        </svg>
      </button>
    {/if}

    <!-- Header Right Actions -->
    <div class="header-right-standalone">
      <button
        class="icon-btn header-btn history-btn"
        class:animating={historyAnimating}
        title={t(appLanguage, "history")}
        onclick={() => (showHistory = true)}
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
            title="Minimize"
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
            title="Maximize"
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
            title="Close"
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

    <!-- Unified Scroll Container -->
    <div class="scroll-wrapper" class:at-bottom={isAtBottom}>
      <section
        class="main-scroll glass"
        class:is-scrolling={isScrolling}
        bind:this={scrollContainerEl}
        onscroll={onMainScroll}
      >
        <!-- Language Selector Row -->
        <div
          class="header-actions-row"
          style="position: relative; display: flex; justify-content: center; align-items: center;"
        >
          <!-- Clipboard / Clear Button -->
          <div style="position: absolute; left: 15px; z-index: 10;">
            {#if inputQuery.trim()}
              <button
                class="icon-btn"
                onclick={() => (inputQuery = "")}
                title={t(appLanguage, "clearText") || "テキストをクリア"}
                style="width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.1); color: var(--text-color);"
              >
                <!-- Close Icon -->
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            {:else}
              <button
                class="icon-btn"
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
                style="width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.1); color: var(--text-color);"
              >
                <!-- Clipboard Icon -->
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                  ></path>
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                </svg>
              </button>
            {/if}
          </div>

          <div
            class="lang-selector-group"
            style="display: flex; align-items: center; gap: 8px;"
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
                  {detectedLang} - {t(appLanguage, "detected")}
                {:else if isAutoDetect && isDetecting}
                  <span class="detecting-label">
                    {t(appLanguage, "detecting")}
                  </span>
                {:else if isAutoDetect}
                  {t(appLanguage, "autoDetect")}
                {:else}
                  {sourceLang}
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
                    class="lang-option auto-detect {isAutoDetect
                      ? 'active'
                      : ''}"
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
                    自動検出
                  </button>
                  <div class="menu-divider"></div>
                  {#each languages as lang}
                    <button
                      class="lang-option {!isAutoDetect && lang === sourceLang
                        ? 'active'
                        : ''}"
                      onclick={() => selectSourceLang(lang)}>{lang}</button
                    >
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
                {targetLang}
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
                      onclick={() => selectTargetLang(lang)}>{lang}</button
                    >
                    >
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Original Text Input -->
        <div class="input-area">
          <div class="textarea-container" class:has-overflow={showFade}>
            <textarea
              bind:this={textareaEl}
              bind:value={inputQuery}
              oninput={handleInputChange}
              onscroll={checkScroll}
              class:long-text={isLongText}
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
            <div
              style="flex: 1; display: flex; align-items: center; gap: 8px; overflow: hidden; height: 100%; mask-image: linear-gradient(to right, black 90%, transparent 100%);"
            >
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
            style="width: 50px; background: var(--bg-card); color: var(--text-color); border: 1px solid var(--border-color); position: relative; overflow: hidden; padding-left: 2px;"
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
            <span class="tech-divider">→</span>
            <span class="tech-item">
              <span class="tech-label">Gen:</span>
              {#if isTranslating}
                {techMetrics.genTime.toFixed(1)}s
              {:else}
                {techMetrics.genTime.toFixed(2)}s
              {/if}
            </span>
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
              {#each [1, 2, 3] as idx}
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
              style="display: flex; justify-content: center; align-items: center; gap: 6px; margin-top: 16px; padding-bottom: 16px;"
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
                aria-label="Favorite current translation"
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
    onclick={closeSettings}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && closeSettings()}
    role="button"
    tabindex="0"
    aria-label="Close settings"
  >
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
                        style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
                      >
                        {t(appLanguage, "allowRewriteDescription")}
                      </span>
                      <button
                        onclick={() => (allowRewrite = !allowRewrite)}
                        style="
                        width: 44px; 
                        height: 24px; 
                        background: {allowRewrite
                          ? '#3b82f6'
                          : 'rgba(255,255,255,0.1)'}; 
                        border-radius: 99px; 
                        position: relative; 
                        border: none; 
                        cursor: pointer;
                        transition: background 0.2s;"
                        aria-labelledby="allow-rewrite-label"
                      >
                        <div
                          style="
                          width: 18px; 
                          height: 18px; 
                          background: white; 
                          border-radius: 50%; 
                          position: absolute; 
                          top: 3px; 
                          left: {allowRewrite ? '23px' : '3px'}; 
                          transition: left 0.2s;"
                        ></div>
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
                        style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
                      >
                        {t(appLanguage, "translationCountDesc") ||
                          "1回の翻訳で生成する翻訳案の数"}
                      </span>
                      <div style="display: flex; gap: 4px;">
                        {#each [1, 2, 3] as count}
                          <button
                            onclick={() =>
                              (translationCount = count as 1 | 2 | 3)}
                            style="
                              width: 36px;
                              height: 28px;
                              background: {translationCount === count
                              ? '#3b82f6'
                              : 'rgba(255,255,255,0.1)'};
                              border: 1px solid {translationCount === count
                              ? '#3b82f6'
                              : 'rgba(255,255,255,0.2)'};
                              border-radius: 6px;
                              color: {translationCount === count
                              ? 'white'
                              : 'var(--text-muted)'};
                              font-size: 13px;
                              font-weight: 500;
                              cursor: pointer;
                              transition: all 0.2s;
                            "
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
                        style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
                      >
                        {t(appLanguage, "autoRunQuickDesc") ||
                          "ショートカット呼出時に自動で翻訳を開始します"}
                      </span>
                      <button
                        onclick={() => (autoRunQuick = !autoRunQuick)}
                        style="
                        width: 44px; 
                        height: 24px; 
                        background: {autoRunQuick
                          ? '#3b82f6'
                          : 'rgba(255,255,255,0.1)'}; 
                        border-radius: 99px; 
                        position: relative; 
                        border: none; 
                        cursor: pointer;
                        transition: background 0.2s;"
                        aria-labelledby="auto-run-label"
                      >
                        <div
                          style="
                          width: 18px; 
                          height: 18px; 
                          background: white; 
                          border-radius: 50%; 
                          position: absolute; 
                          top: 3px; 
                          left: {autoRunQuick ? '23px' : '3px'}; 
                          transition: left 0.2s;"
                        ></div>
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
                        style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
                      >
                        {t(appLanguage, "showTechInfoDesc") ||
                          "翻訳時に処理時間やトークン数を表示します"}
                      </span>
                      <button
                        onclick={() => (showTechInfo = !showTechInfo)}
                        style="
                        width: 44px; 
                        height: 24px; 
                        background: {showTechInfo
                          ? '#3b82f6'
                          : 'rgba(255,255,255,0.1)'}; 
                        border-radius: 99px; 
                        position: relative; 
                        border: none; 
                        cursor: pointer;
                        transition: background 0.2s;"
                        aria-labelledby="tech-info-label"
                      >
                        <div
                          style="
                          width: 18px; 
                          height: 18px; 
                          background: white; 
                          border-radius: 50%; 
                          position: absolute; 
                          top: 3px; 
                          left: {showTechInfo ? '23px' : '3px'}; 
                          transition: left 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
                          box-shadow: 0 1px 3px rgba(0,0,0,0.2);"
                        ></div>
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
                        style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
                      >
                        {t(appLanguage, "autoStartDesc") ||
                          "OS 起動時にアプリを自動で起動します"}
                      </span>
                      <button
                        onclick={async () => {
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
                        }}
                        style="
                        width: 44px; 
                        height: 24px; 
                        background: {autoStartEnabled
                          ? '#3b82f6'
                          : 'rgba(255,255,255,0.1)'}; 
                        border-radius: 20px; 
                        border: none;
                        cursor: pointer;
                        position: relative;
                        transition: background 0.2s;
                      "
                        aria-label="Toggle autostart"
                      >
                        <div
                          style="
                          width: 18px; 
                          height: 18px; 
                          background: white; 
                          border-radius: 50%; 
                          position: absolute; 
                          top: 3px; 
                          left: {autoStartEnabled ? '23px' : '3px'}; 
                          transition: left 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
                          box-shadow: 0 1px 3px rgba(0,0,0,0.2);"
                        ></div>
                      </button>
                    </div>
                  </div>
                  <div class="settings-section">
                    <div class="settings-label">
                      {t(appLanguage, "startMinimized") ||
                        "起動時にトレイに格納"}
                    </div>
                    <div class="settings-card-row">
                      <span
                        style="font-size: 13px; color: var(--text-muted); flex: 1; padding-right: 10px;"
                      >
                        {t(appLanguage, "startMinimizedDesc") ||
                          "起動時にメイン画面を表示せず、タスクトレイに常駐します"}
                      </span>
                      <button
                        onclick={() => (startMinimized = !startMinimized)}
                        style="
                        width: 44px; 
                        height: 24px; 
                        background: {startMinimized
                          ? '#3b82f6'
                          : 'rgba(255,255,255,0.1)'}; 
                        border-radius: 20px; 
                        border: none;
                        cursor: pointer;
                        position: relative;
                        transition: background 0.2s;
                      "
                        aria-label="Toggle start minimized"
                      >
                        <div
                          style="
                          width: 18px; 
                          height: 18px; 
                          background: white; 
                          border-radius: 50%; 
                          position: absolute; 
                          top: 3px; 
                          left: {startMinimized ? '23px' : '3px'}; 
                          transition: left 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
                          box-shadow: 0 1px 3px rgba(0,0,0,0.2);"
                        ></div>
                      </button>
                    </div>
                  </div>

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
                  </div>

                  <!-- API Key for Selected Provider -->
                  <div class="settings-section">
                    <label class="settings-label" for="api-key-input">
                      {selectedProvider === "openai"
                        ? t(appLanguage, "openaiApiKey")
                        : selectedProvider === "gemini"
                          ? t(appLanguage, "geminiApiKey")
                          : t(appLanguage, "anthropicApiKey")}
                    </label>
                    <input
                      id="api-key-input"
                      type="password"
                      class="settings-input"
                      bind:value={apiKeys[selectedProvider]}
                      placeholder={selectedProvider === "gemini"
                        ? "AIza..."
                        : selectedProvider === "anthropic"
                          ? "sk-ant-..."
                          : "sk-..."}
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
                                title="Move Up"
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
                                title="Move Down"
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
                    style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; gap: 20px; padding: 40px 0;"
                  >
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
                      <h2
                        style="font-size: 32px; font-weight: 700; margin: 0; color: var(--text-main);"
                      >
                        Howlingual
                      </h2>
                      <p
                        style="font-size: 14px; color: var(--text-muted); margin-top: 8px;"
                      >
                        Version {appVersion}
                      </p>
                    </div>
                    <div
                      class="about-footer-info"
                      style="margin-top: auto; font-size: 12px; color: var(--text-muted); opacity: 0.6;"
                    >
                      <p>© 2026 tomakura</p>
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
    onclick={() => (showHistory = false)}
    role="button"
    tabindex="0"
    onkeydown={(e) => {
      if (e.key === "Enter") {
        showHistory = false;
      }
    }}
  >
    <div
      class="settings-panel glass"
      transition:fly={{ y: 20, duration: 300 }}
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="settings-header">
        <h2>{t(appLanguage, "history")}</h2>
        <button
          class="close-btn"
          onclick={() => (showHistory = false)}
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
                            <span>{item.sourceLang} → {item.targetLang}</span>
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
                            aria-label="Toggle favorite"
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
                            aria-label="Delete"
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
                            <span>{item.sourceLang} → {item.targetLang}</span>
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
                              aria-label="Move up"
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
                              aria-label="Move down"
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
                            aria-label="Delete favorite"
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
    onclick={() => (showResetConfirmation = false)}
    role="button"
    tabindex="0"
    onkeydown={(e) => {
      if (e.key === "Enter") {
        showResetConfirmation = false;
      }
    }}
  >
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
    onclick={() => (showDiscardConfirmation = false)}
    role="button"
    tabindex="0"
    onkeydown={(e) => {
      if (e.key === "Enter") {
        showDiscardConfirmation = false;
      }
    }}
  >
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

  .compact-lang-group {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    flex-shrink: 1;
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

  .compact-style-wrapper {
    position: relative;
    display: inline-flex;
  }

  .compact-style-chip {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: var(--text-main);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .compact-style-chip:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .compact-style-chip.open {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(59, 130, 246, 0.35);
    color: #93c5fd;
  }

  .chip-text {
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.3px;
  }

  .chip-count {
    min-width: 16px;
    height: 16px;
    border-radius: 999px;
    padding: 0 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(59, 130, 246, 0.3);
    color: #bfdbfe;
    font-size: 10px;
    font-weight: 600;
  }

  .chip-chevron {
    transition: transform 0.2s var(--easing);
  }

  .compact-style-chip.open .chip-chevron {
    transform: rotate(180deg);
  }

  .compact-style-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    min-width: 280px;
    max-height: 300px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    padding: 6px;
    border-radius: 12px;
    z-index: 1200;
  }

  .compact-style-dropdown .style-chip {
    width: 100%;
    justify-content: flex-start;
    padding: 8px 12px;
    font-size: 13px;
  }

  .style-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-main);
    cursor: pointer;
    transition: all 0.2s;
  }

  .style-row:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .style-name {
    font-size: 12px;
    font-weight: 500;
  }

  .level-meter {
    width: 64px;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }

  .level-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--primary-color);
    opacity: 0.6;
    transition: width 0.2s var(--easing);
  }

  .style-row[data-level="1"] .level-fill {
    opacity: 0.45;
  }

  .style-row[data-level="2"] .level-fill {
    opacity: 0.8;
  }

  .output-area.compact-output {
    gap: 10px;
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
    letter-spacing: -0.02em;
    background: linear-gradient(
      135deg,
      var(--text-main) 0%,
      var(--text-secondary) 100%
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: flex-end;
    width: fit-content;
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

  /* Fixed Favorite Button - Right Edge */
  .save-favorite-btn-fixed {
    position: absolute;
    right: 15px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s ease;
    z-index: 100;
  }

  .save-favorite-btn-fixed:hover {
    background: rgba(255, 215, 0, 0.15);
    border-color: rgba(255, 215, 0, 0.3);
    color: #ffd700;
  }

  .save-favorite-btn-fixed.active {
    color: #ffd700;
    background: rgba(255, 215, 0, 0.2);
    border-color: rgba(255, 215, 0, 0.4);
  }

  .save-favorite-btn-fixed.animating .save-star-icon {
    animation: starPop 0.4s ease;
  }

  @keyframes starPop {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.3);
    }
    100% {
      transform: scale(1);
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
    width: 36px;
    height: 28px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    padding: 0;
  }

  .win-btn-inline.minimize {
    background: rgba(255, 255, 255, 0.08);
  }
  .win-btn-inline.maximize {
    background: rgba(255, 255, 255, 0.08);
  }
  .win-btn-inline.close {
    background: rgba(255, 255, 255, 0.08);
  }

  .win-btn-inline svg {
    opacity: 0.7;
    transition: opacity 0.2s ease;
    color: rgba(255, 255, 255, 0.8);
  }

  .win-btn-inline:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .win-btn-inline:hover svg {
    opacity: 1;
  }

  .win-btn-inline.close:hover {
    background: #e85d5d;
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
    overflow: hidden;
    display: block;
    max-height: 200px;
    padding-bottom: 20px;
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

  .card-inner-content.content-fade {
    opacity: 0;
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

  .empty-state-visual {
    position: relative;
  }

  .empty-icon-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 96px;
    height: 96px;
    border-radius: 24px;
    background: linear-gradient(
      135deg,
      rgba(99, 102, 241, 0.1),
      rgba(34, 211, 238, 0.1)
    );
    border: 1px solid var(--border-color);
  }

  .empty-icon {
    color: var(--primary-color);
    opacity: 0.8;
    animation: floatSoft 4s ease-in-out infinite;
  }

  .empty-icon-glow {
    position: absolute;
    inset: -20px;
    background: radial-gradient(
      circle,
      var(--primary-glow) 0%,
      transparent 70%
    );
    opacity: 0.5;
    animation: pulse 3s ease-in-out infinite;
  }

  @keyframes floatSoft {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-6px);
    }
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
    letter-spacing: -0.02em;
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

  :global([data-theme="light"]) .empty-icon-wrapper {
    background: linear-gradient(
      135deg,
      rgba(99, 102, 241, 0.08),
      rgba(8, 145, 178, 0.08)
    );
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

  .candidate-card:hover .candidate-actions {
    opacity: 1;
  }

  .icon-btn-small {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 3px;
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
    padding: 5px;
    border-radius: 4px;
    color: var(--text-muted);
    transition: all 0.2s;
  }
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--primary-hover);
  }
  .icon-btn:active {
    transform: scale(0.92);
  }

  .replace-btn.replaced {
    color: #34d399;
  }

  /* コピーボタン: 紙が重なるように上に移動 */
  .copy-btn.animating .copy-icon {
    animation: copySlide 0.6s var(--easing);
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

  .speak-btn.animating .wave-2 {
    animation: wavePulse 1.2s ease-in-out;
  }

  .speak-btn.animating .wave-3 {
    animation: wavePulse 1.2s ease-in-out 0.15s;
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

  /* Copy button feedback */
  .copy-btn.copied {
    color: #22c55e;
    background: rgba(34, 197, 94, 0.15);
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

  .settings-panel {
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
    width: 20px;
    height: 20px;
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

  /* Confirmation dialog */
  :global([data-theme="light"]) .confirm-dialog {
    background: rgba(255, 255, 255, 0.98);
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

  /* Settings row borders */
  :global([data-theme="light"]) .settings-row {
    border-color: rgba(0, 0, 0, 0.08);
  }

  /* Section titles */
  :global([data-theme="light"]) .settings-section h3 {
    color: #333;
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

  /* Style editor */
  :global([data-theme="light"]) .style-editor-panel {
    background: rgba(0, 0, 0, 0.02);
    border-color: rgba(0, 0, 0, 0.08);
  }

  /* API Key indicator */
  :global([data-theme="light"]) .api-indicator.set {
    background: rgba(34, 197, 94, 0.1);
    color: #16a34a;
  }
  :global([data-theme="light"]) .api-indicator.not-set {
    background: rgba(239, 68, 68, 0.1);
    color: #dc2626;
  }

  /* Tab content */
  :global([data-theme="light"]) .tab-content-wrapper {
    color: #1a1a1a;
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

  :global([data-theme="light"]) .compact-style-chip {
    background: rgba(0, 0, 0, 0.05);
    border-color: rgba(0, 0, 0, 0.12);
    color: #1a1a1a;
  }

  :global([data-theme="light"]) .compact-style-chip.open {
    background: rgba(59, 130, 246, 0.12);
    border-color: rgba(59, 130, 246, 0.2);
    color: #2563eb;
  }

  :global([data-theme="light"]) .chip-count {
    background: rgba(59, 130, 246, 0.2);
    color: #1d4ed8;
  }

  :global([data-theme="light"]) .style-row {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.1);
  }

  :global([data-theme="light"]) .level-meter {
    background: rgba(0, 0, 0, 0.08);
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

  /* Prevent logo from being dragged */
  .about-logo-wrapper img,
  img[alt*="Logo"],
  img[alt*="logo"] {
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
    font-size: 11px;
    font-weight: 500;
    margin-left: 6px;
    opacity: 0.8;
  }
  /* Custom Window Controls */
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-right {
    display: flex;
    align-items: center;
    padding-right: 16px;
    height: 100%;
  }

  .window-controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .win-btn {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: none;
    padding: 0;
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s;
    overflow: hidden;
  }

  .win-btn:hover svg {
    opacity: 1 !important;
  }

  .win-btn.close {
    background: #ff5f56;
    border: 1px solid #e0443e;
  }
  .win-btn.minimize {
    background: #ffbd2e;
    border: 1px solid #dea123;
  }
  .win-btn.maximize {
    background: #27c93f;
    border: 1px solid #1aab29;
  }

  .win-btn:active {
    filter: brightness(0.9);
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
</style>
