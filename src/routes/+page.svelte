<script lang="ts">
  import { tick, onMount, untrack } from "svelte";
  import { fade, scale, fly, crossfade } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, emit } from "@tauri-apps/api/event";
  import { type AiModel } from "$lib/ai_service";
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
  let settingsTab = $state<"general" | "api" | "styles">("general");
  let selectedModel = $state<AiModel>("gpt-5-mini" as AiModel);
  let apiKeys = $state({
    gemini: "",
    openai: "",
    anthropic: "",
  });
  let defaultTargetLang = $state("日本語");
  let theme = $state<"dark" | "light">("dark");
  let appLanguage = $state<"ja" | "en" | "zh" | "ko">("ja");
  let allowRewrite = $state(false);
  let selectedProvider = $state<"openai" | "gemini" | "anthropic">("openai");
  let isCompactMode = $state(false);
  const DEFAULT_SHORTCUT = "CommandOrControl+Shift+H";
  let quickShortcut = $state(DEFAULT_SHORTCUT);
  let shortcutDraft = $state(DEFAULT_SHORTCUT);
  let shortcutError = $state("");
  let shortcutSaving = $state(false);
  let autoRunQuick = $state(true); // Auto-run setting - default ON for backward compatibility

  let historyAnimating = $state(false);
  function triggerHistoryAnim() {
    historyAnimating = true;
    setTimeout(() => (historyAnimating = false), 1000);
  }

  function detectLanguageSimple(text: string) {
    const hasJapanese = /[\u3040-\u30ff\u4e00-\u9faf]/.test(text);
    return hasJapanese ? "日本語" : "英語";
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
    hiddenStyles.some((s) => (styleLevels[s.name] || 0) > 0),
  );

  // Responsive style count
  $effect(() => {
    if (styleContainerRef) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const totalWidth = entry.contentRect.width;
          const itemWidth = 90;
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
      await tick();
      autoResize();
      return;
    }
    if (viewParam === "main") {
      isCompactMode = false;
      await tick();
      autoResize();
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
        if (parsed.customStyles) customStyles = parsed.customStyles;
        if (parsed.allowRewrite !== undefined)
          allowRewrite = parsed.allowRewrite;
        if (parsed.quickShortcut) quickShortcut = parsed.quickShortcut;
        if (parsed.autoRunQuick !== undefined)
          autoRunQuick = parsed.autoRunQuick;

        // Apply theme on load
        document.documentElement.setAttribute("data-theme", theme);
      } catch (e) {
        console.warn("Failed to parse saved settings", e);
      }
    }

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
        }

        isTranslating = p.isTranslating;
        translations = p.translations; // Direct sync

        if (p.detailedExplanation) {
          detailedExplanation = p.detailedExplanation;
        }
        if (p.inputQuery && p.inputQuery !== inputQuery && !isTranslating) {
          inputQuery = p.inputQuery;
        }

        // Sync Language Settings
        if (p.sourceLang) {
          if (p.sourceLang !== "自動検出") {
            selectSourceLang(p.sourceLang);
          }
        }
        if (p.detectedLang) {
          detectedLang = p.detectedLang;
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
            errorMessage = "";
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

      // Check if THIS window is the compact window (check at event time, not registration time)
      let isThisCompactWindow = false;
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        isThisCompactWindow = currentWindow.label === "compact";
      } catch {
        // Fallback to URL check
        isThisCompactWindow = window.location.search.includes("view=compact");
      }

      if (!isThisCompactWindow) {
        console.log("[event] Ignoring - not compact window");
        return;
      }

      console.log(
        "[event] text_captured processing:",
        event.payload.length,
        "chars",
      );
      hasReceivedText = true;
      isOpeningMain = false; // Reset flag so we can capture again

      // Force UI update with new text
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
        }

        // Restore language settings
        if (payload.sourceLang) {
          if (payload.sourceLang !== "自動検出") {
            selectSourceLang(payload.sourceLang);
          }
          detectedLang = payload.sourceLang;
        }
        if (payload.targetLang) {
          targetLang = payload.targetLang;
        }

        // Restore style levels
        if (payload.styleLevels) {
          styleLevels = { ...styleLevels, ...payload.styleLevels };
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

        void tick().then(async () => {
          autoResize();
          // If translation was active in quick window, continue (restart) it here
          if (payload.isTranslating) {
            console.log("[handover] Continuing translation...");
            await startTranslation();
          }
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
      customStyles: customStyles,
      allowRewrite: allowRewrite,
      quickShortcut: quickShortcut,
      autoRunQuick: autoRunQuick,
    };
    localStorage.setItem("howlingual_settings", JSON.stringify(settings));

    // Apply theme immediately
    document.documentElement.setAttribute("data-theme", theme);

    // console.log("[Settings] Auto-saved");
  });

  // Style levels: 0 = オフ, 1 = 弱, 2 = 強
  let styleLevels: Record<string, number> = $state({
    丁寧: 0,
    ビジネス: 0,
    カジュアル: 0,
    キャッチー: 0,
    子ども向け: 0,
    メール: 0,
    簡潔: 0,
  });
  let compactStylesOpen = $state(false);
  let activeStyleCount = $derived(
    Object.values(styleLevels).filter((level) => level > 0).length,
  );

  // Sync styleLevels with customStyles
  $effect(() => {
    const newStyles = customStyles.map((s) => s.name);
    // Use untrack to prevent circular dependency on styleLevels
    const currentLevels = untrack(() => styleLevels);
    const nextLevels: Record<string, number> = {};

    newStyles.forEach((name) => {
      // Preserve existing level if style exists, otherwise 0
      nextLevels[name] = currentLevels[name] || 0;
    });

    styleLevels = nextLevels;
  });

  function triggerResetStyles() {
    showResetConfirmation = true;
  }

  function confirmResetStyles() {
    customStyles = getDefaultStyles(appLanguage);
    showResetConfirmation = false;
  }

  function selectProvider(provider: "openai" | "gemini" | "anthropic") {
    selectedProvider = provider;

    // Check if current model belongs to this provider
    const currentModelObj = availableModels.find(
      (m) => m.value === selectedModel,
    );
    if (currentModelObj?.provider !== provider) {
      // Switch to first available model for this provider
      // Ideally we could store "last used model per provider", but for now default to first
      const defaultForProvider = availableModels.find(
        (m) => m.provider === provider,
      );
      if (defaultForProvider) {
        selectedModel = defaultForProvider.value as AiModel;
      }
    }
  }

  let slideDirection = $state(1);
  const settingsTabOrder = ["general", "api", "styles"];

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
  }

  function changeTab(newTab: "general" | "api" | "styles") {
    const currentIndex = settingsTabOrder.indexOf(settingsTab);
    const newIndex = settingsTabOrder.indexOf(newTab);
    slideDirection = newIndex > currentIndex ? 1 : -1;
    settingsTab = newTab;
  }

  function openSettingsModal() {
    settingsTab = "general";
    showSettings = true;
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
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

    const index = customStyles.findIndex((s) => s.id === editingStyle!.id);
    if (index !== -1) {
      customStyles = customStyles.map((s, i) =>
        i === index ? editingStyle! : s,
      );
    } else {
      customStyles = [...customStyles, editingStyle];
    }
    editingStyle = null;
  }

  function cancelEditStyle() {
    showDiscardConfirmation = true;
  }

  function confirmDiscardStyle() {
    editingStyle = null;
    showDiscardConfirmation = false;
  }

  function deleteStyle(index: number) {
    customStyles = customStyles.filter((_, i) => i !== index);
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
        sourceLang: detectedLang || sourceLang,
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
    errorMessage = "";
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

    await tick();

    // Set the new text
    // Set the new text
    inputQuery = text;
    // Sync to service immediately
    await emit("sync_input_command", { text });

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

  // Language direction
  let isAutoDetect = $state(true);
  let detectedLang = $state("");
  let sourceLang = $state("英語");
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

  function selectSourceLang(lang: string | null) {
    if (lang === null) {
      isAutoDetect = true;
      sourceLang = "自動検出";
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
    }
    console.log(
      `[UI] Source Language Selected: ${sourceLang} (Auto: ${isAutoDetect})`,
    );
    showSourceLangMenu = false;
  }

  function selectTargetLang(lang: string) {
    console.log(`[UI] Target Language Selected: ${lang}`);
    targetLang = lang;
    showTargetLangMenu = false;
  }

  // Prevent same-language translation if allowRewrite is false
  $effect(() => {
    if (allowRewrite) return;

    // Determine actual source language
    const actualSource = isAutoDetect ? detectedLang || "日本語" : sourceLang;
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
    actionMenuOpenId = null;
    copiedId = id;
    setTimeout(() => {
      copiedId = null;
    }, 1500);
  }

  async function handleReplace(id: number, text: string) {
    console.log(`[UI] Replace triggered for ID: ${id}`);
    actionMenuOpenId = null;
    try {
      await navigator.clipboard.writeText(text);
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
  let speakAnimating: Record<number, boolean> = $state({});
  let copyAnimating: Record<number, boolean> = $state({});
  let isSpeakingId: number | null = $state(null);

  function triggerSettingsAnim() {
    if (settingsAnimating) return;
    settingsAnimating = true;
    setTimeout(() => {
      settingsAnimating = false;
    }, 1000);
  }

  function handleSpeak(id: number, text: string, lang: string) {
    if (!window.speechSynthesis) return;
    actionMenuOpenId = null;

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

  function cycleLevel(style: string) {
    if (isDragging) return;
    styleLevels[style] = (styleLevels[style] + 1) % 3;
    console.log(`[UI] Style cycled: ${style} -> ${styleLevels[style]}`);
  }

  function handleDrag(style: string, event: PointerEvent) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const startX = event.clientX;
    const startLevel = styleLevels[style];
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
      styleLevels[style] = newLevel;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Reset isDragging after a short delay to allow click event to fire and check it
      setTimeout(() => {
        isDragging = false;
      }, 50);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Auto-resize textarea
  let textareaEl: HTMLTextAreaElement;
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
  let scrollContainerEl: HTMLElement;
  let isScrolledDown = $state(false);

  let isScrolling = $state(false);
  let scrollTimeout: any;
  let scrollThumbTop = $state(0);
  let scrollThumbHeight = $state(0);

  // Auto-scroll during streaming (like modern AI chat apps)
  let autoScrollEnabled = $state(true);
  let lastScrollTop = 0;
  let isAtBottom = $state(true);

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
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
      // Use smaller threshold for compact mode (smaller scroll area)
      const scrollUpThreshold = isCompactMode ? 3 : 10;
      const scrollDownThreshold = isCompactMode ? 2 : 5;
      const scrollDelta = scrollTop - lastScrollTop;

      if (scrollDelta < -scrollUpThreshold && !isNearBottom) {
        // User scrolled up significantly, disable auto-scroll
        autoScrollEnabled = false;
      } else if (isNearBottom && scrollDelta > scrollDownThreshold) {
        // User explicitly scrolled down to bottom, re-enable
        autoScrollEnabled = true;
      }
    }
    lastScrollTop = scrollTop;

    // Track if at bottom for fade effect
    isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
  }

  function autoScrollToBottom() {
    if (scrollContainerEl && autoScrollEnabled) {
      scrollContainerEl.scrollTo({
        top: scrollContainerEl.scrollHeight,
        behavior: "smooth",
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
    if (inputQuery !== undefined) {
      autoResize();
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

    /* Last result loading disabled by user request */
  });

  function loadHistory(item: HistoryItem) {
    inputQuery = item.sourceText;
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

  // Load showTechInfo from localStorage on first mount
  onMount(() => {
    const stored = localStorage.getItem("howlingual_showTechInfo");
    if (stored !== null) {
      showTechInfo = stored === "true";
    }
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
    isTranslating = true;
    autoScrollEnabled = true; // Enable auto-scroll for new translation
    showExplanation = false; // Hide explanation during translation
    showSourceLangMenu = false; // Close menu if open
    showTargetLangMenu = false; // Close menu if open
    // Clear content but keep slots
    translations = translations.map((t) => ({ ...t, text: "", reason: "" }));
    if (translations.length === 0) {
      translations = [
        { id: 1, text: "", reason: "" },
        { id: 2, text: "", reason: "" },
        { id: 3, text: "", reason: "" },
      ];
    }
    detailedExplanation = null; // Clear explanation
    errorMessage = "";

    // Handle Auto-detect mock logic
    if (isAutoDetect) {
      isDetecting = true;
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
      await emit("start_translation_command", {
        text: inputQuery,
        sourceLang,
        targetLang,
        styles: styleLevels,
        model: currentModel,
        explanationLang: getLanguageName(appLanguage),
        apiKeys: $state.snapshot(apiKeys),
        // Add any other params needed
        initialTokens: Math.ceil(inputQuery.length / 1.5) + 40,
      });
    } catch (error) {
      console.error("Translation failed:", error);
      errorMessage = "Translation failed to start.";
      isTranslating = false;
    }
  }

  // Initial load (optional: remove if we want it empty by default)
  // Initial load: Start empty
  $effect(() => {
    // No initial data
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} onresize={checkBottomPosition} />

{#if isCompactMode}
  <main class="compact-shell">
    <header class="compact-header">
      <div class="compact-brand">
        <img
          src={theme === "light" ? "/icon-light.svg" : "/icon-dark.svg"}
          alt="Howlingual"
          class="app-icon compact-icon"
        />
        <span class="compact-name">Howlingual</span>
      </div>
      <button
        class="compact-main-btn"
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
    </header>

    <div class="compact-lang-row">
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
              {detectedLang}・{appLanguage === "ja"
                ? "検出"
                : appLanguage === "en"
                  ? "auto"
                  : appLanguage === "zh"
                    ? "检测"
                    : "감지"}・
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
              oninput={autoResize}
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
                {#each customStyles.slice(0, 3) as style (style.id)}
                  <button
                    class="style-chip"
                    data-level={styleLevels[style.name] || 0}
                    onclick={() => cycleLevel(style.name)}
                    onpointerdown={(e) => handleDrag(style.name, e)}
                  >
                    <span
                      class="chip-fill"
                      style="width: {(styleLevels[style.name] || 0) * 50}%"
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
                          data-level={styleLevels[style.name] || 0}
                          onclick={(e) => {
                            e.stopPropagation();
                            cycleLevel(style.name);
                          }}
                          onpointerdown={(e) => handleDrag(style.name, e)}
                        >
                          <span
                            class="dropdown-item-fill"
                            style="width: {(styleLevels[style.name] || 0) *
                              50}%"
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
            class:loading={isTranslating}
            title={isScrolledDown
              ? t(appLanguage, "scrollToTop")
              : t(appLanguage, "translate")}
            onclick={isScrolledDown ? scrollToTop : startTranslation}
            disabled={!isScrolledDown && (isTranslating || !inputQuery.trim())}
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
                  <span class="loading-dots-inline">...</span>
                {:else}
                  {techMetrics.inputTokens}
                {/if}
              </span>
              <span class="token-row">
                <span class="tech-label">Out:</span>
                {#if isTranslating && !techMetrics.isReal}
                  <span class="loading-dots-inline">...</span>
                {:else}
                  {techMetrics.outputTokens}
                {/if}
                {#if techMetrics.tokensPerSec > 0}
                  <span style="opacity: 0.6; margin-left: 4px;"
                    >({techMetrics.tokensPerSec}/s)</span
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
          {#each translations as item (item.id)}
            <div class="candidate-card" out:fade={{ duration: 200 }}>
              <div
                class="card-inner-content"
                class:content-fade={isTranslating && !item.text}
              >
                <p class="translated-text">{item.text}</p>
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
                        <div class="action-menu-dropdown glass" transition:fade>
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
                                  <polyline points="20 6 9 17 4 12"></polyline>
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
          {/each}

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
      <div
        class="scroll-indicator"
        class:visible={isScrolling}
        style="top: {scrollThumbTop}px; height: {scrollThumbHeight}px;"
      ></div>
    </div>
  </main>
{:else}
  <main class="container">
    <!-- App Header -->
    <header class="app-header">
      <div class="header-left">
        <img
          src={theme === "light" ? "/icon-light.svg" : "/icon-dark.svg"}
          alt="Howlingual"
          class="app-icon"
        />
        <h1 class="app-title">Howlingual</h1>

        <!-- Language Direction Header -->
        <div
          class="lang-selector-group"
          style="display: flex; align-items: center; gap: 8px; margin-left: 24px;"
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
              {#if isAutoDetect && detectedLang && translations.length > 0}
                {detectedLang}（{appLanguage === "ja"
                  ? "自動"
                  : appLanguage === "en"
                    ? "auto"
                    : appLanguage === "zh"
                      ? "自动"
                      : "自務"}）
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

      <div class="header-right">
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
      </div>
    </header>

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
            <textarea
              bind:this={textareaEl}
              bind:value={inputQuery}
              oninput={autoResize}
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
              {#each visibleStyles as style (style.id)}
                <button
                  class="style-chip"
                  data-level={styleLevels[style.name] || 0}
                  onclick={() => cycleLevel(style.name)}
                  onpointerdown={(e) => handleDrag(style.name, e)}
                  animate:flip={{ duration: 300, easing: quintOut }}
                  in:receive={{ key: style.id }}
                  out:send={{ key: style.id }}
                >
                  <span
                    class="chip-fill"
                    style="width: {(styleLevels[style.name] || 0) * 50}%"
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
                        data-level={styleLevels[style.name] || 0}
                        onclick={() => cycleLevel(style.name)}
                        onpointerdown={(e) => handleDrag(style.name, e)}
                        animate:flip={{ duration: 300, easing: quintOut }}
                        in:receive={{ key: style.id }}
                        out:send={{ key: style.id }}
                      >
                        <span
                          class="dropdown-item-fill"
                          style="width: {(styleLevels[style.name] || 0) * 50}%"
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

          <!-- Single action button that morphs -->
          <button
            class="action-btn"
            class:translate-mode={!isScrolledDown}
            class:scroll-mode={isScrolledDown}
            class:loading={isTranslating}
            title={isScrolledDown
              ? t(appLanguage, "scrollToTop")
              : t(appLanguage, "translate")}
            onclick={isScrolledDown ? scrollToTop : startTranslation}
            disabled={!isScrolledDown && (isTranslating || !inputQuery.trim())}
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
                  <span class="loading-dots-inline">...</span>
                {:else}
                  {techMetrics.inputTokens}
                {/if}
              </span>
              <span class="token-row">
                <span class="tech-label">Out:</span>
                {#if isTranslating && !techMetrics.isReal}
                  <span class="loading-dots-inline">...</span>
                {:else}
                  {techMetrics.outputTokens}
                {/if}
                {#if techMetrics.tokensPerSec > 0}
                  <span style="opacity: 0.6; margin-left: 4px;"
                    >({techMetrics.tokensPerSec}/s)</span
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
          {#each translations as item (item.id)}
            <div class="candidate-card" out:fade={{ duration: 200 }}>
              <div
                class="card-inner-content"
                class:content-fade={isTranslating && !item.text}
              >
                <p class="translated-text">{item.text}</p>
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
                        <div class="action-menu-dropdown glass" transition:fade>
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
                                  <polyline points="20 6 9 17 4 12"></polyline>
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
          {/each}

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
{#if showSettings && !isCompactMode}
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
      class="settings-panel glass"
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
              class:active={settingsTab === "general"}
              onclick={() => changeTab("general")}
            >
              {t(appLanguage, "tabGeneral")}
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
          </div>

          <!-- Content with Transitions -->
          <div class="settings-main-content">
            {#key settingsTab}
              <div
                class="tab-content-wrapper"
                in:fly={{
                  y: slideDirection * 20,
                  duration: 250,
                  delay: 250,
                  opacity: 0,
                }}
                out:fly={{ y: -slideDirection * 20, duration: 250, opacity: 0 }}
              >
                {#if settingsTab === "general"}
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
                            <button
                              class="icon-btn-small edit-btn"
                              onclick={() => openStyleEditor(style)}
                              title="Edit"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                              >
                                <path d="M12 20h9"></path>
                                <path
                                  d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                                ></path>
                              </svg>
                            </button>
                            <button
                              class="icon-btn-small delete-btn"
                              onclick={() => deleteStyle(i)}
                              aria-label={t(appLanguage, "delete")}
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
                        <p class="style-prompt-text">{style.prompt}</p>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/key}
          </div>
        </div>

        <div class="settings-footer">
          <button class="save-btn" onclick={closeSettings}
            >{t(appLanguage, "close")}</button
          >
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
    tabindex="-1"
    onkeydown={() => {}}
  >
    <div
      class="settings-panel glass"
      transition:fly={{ y: 20, duration: 300 }}
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
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

{#if showResetConfirmation}
  <div
    class="modal-overlay"
    transition:fade={{ duration: 200 }}
    onclick={() => (showResetConfirmation = false)}
    role="button"
    tabindex="-1"
    onkeydown={() => {}}
  >
    <div
      class="modal-card glass"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
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

{#if showDiscardConfirmation}
  <div
    class="modal-overlay"
    transition:fade={{ duration: 200 }}
    onclick={() => (showDiscardConfirmation = false)}
    role="button"
    tabindex="-1"
    onkeydown={() => {}}
  >
    <div
      class="modal-card glass"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
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
    height: 100vh;
    padding: 0;
    overflow: hidden;
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
  }

  .compact-shell::before {
    display: none;
  }

  .compact-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    z-index: 3000;
  }

  .compact-brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .compact-icon {
    width: 24px;
    height: 24px;
  }

  .compact-name {
    font-size: 18px;
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
    margin-bottom: 4px;
    position: relative;
    z-index: 2500;
  }

  .compact-lang-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .compact-shell .lang-btn {
    padding: 6px 10px;
    font-size: 12px;
  }

  .scroll-wrapper.compact-scroll-wrapper {
    margin: 0 6px 6px;
    border-radius: 16px;
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
    padding: 0 20px;
    height: 56px;
    flex-shrink: 0;
    margin-top: 4px;
    margin-bottom: 4px;
    position: relative;
    z-index: 200; /* Ensure dropdowns stay above main content */
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    transform: translateY(-2px); /* Shift up slightly */
  }

  .app-title {
    font-family: "Jost", sans-serif;
    font-weight: 700;
    font-size: 28px;
    color: var(--text-main);
    letter-spacing: 0.5px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: flex-end;
    width: fit-content;
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
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.2s var(--easing);
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
    width: 44px;
    height: 44px;
    border: none;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      transform 0.2s var(--easing),
      background 0.3s var(--easing);
  }

  .action-btn:hover {
    transform: scale(1.05);
  }

  .action-btn:active {
    transform: scale(0.94);
  }

  /* Translate mode (accent color) */
  .action-btn.translate-mode {
    background: var(--primary-color);
    color: #fff;
  }

  .action-btn.translate-mode:hover {
    background: var(--primary-hover);
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
    padding: 5px 12px;
    border-radius: 8px;
    font-size: 11px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.2s;
    user-select: none;
    touch-action: none;
    white-space: nowrap;
  }

  /* Staggered animation handled via inline styles in loop */

  @keyframes chipPop {
    0% {
      transform: scale(0.8);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .style-chip:hover {
    border-color: rgba(255, 255, 255, 0.2);
  }

  .chip-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: var(--primary-color);
    opacity: 0.15;
    transition:
      width 0.2s cubic-bezier(0.2, 0, 0.2, 1),
      background-color 0.2s;
    border-radius: 8px 0 0 8px;
  }

  .style-chip[data-level="1"] .chip-fill {
    background: var(--primary-color);
    opacity: 0.2;
  }

  .style-chip[data-level="2"] .chip-fill {
    background: var(--primary-color);
    opacity: 0.4;
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
    padding: 12px 12px;
    border-radius: var(--radius-sm);
    /* Base background */
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    transition:
      background 0.2s,
      border-color 0.2s;
    flex-shrink: 0;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    animation: popIn 0.5s var(--easing) backwards;
  }

  .card-inner-content {
    width: 100%;
    transition: opacity 0.5s ease;
  }

  .card-inner-content.content-fade {
    opacity: 0;
  }

  .candidate-actions.hide {
    display: none;
  }

  /* Staggered backgrounds: Darken sequentially (More visible difference) */
  .candidate-card:nth-child(1) {
    background: rgba(255, 255, 255, 0.12); /* Lightest (top) */
  }
  .candidate-card:nth-child(2) {
    background: rgba(255, 255, 255, 0.08);
  }
  .candidate-card:nth-child(3) {
    background: rgba(255, 255, 255, 0.04);
  }
  .candidate-card:nth-child(n + 4) {
    background: rgba(255, 255, 255, 0.02); /* Darkest */
  }

  /* Light mode - use darker backgrounds */
  :global([data-theme="light"]) .candidate-card:nth-child(1) {
    background: rgba(0, 0, 0, 0.03);
  }
  :global([data-theme="light"]) .candidate-card:nth-child(2) {
    background: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .candidate-card:nth-child(3) {
    background: rgba(0, 0, 0, 0.07);
  }
  :global([data-theme="light"]) .candidate-card:nth-child(n + 4) {
    background: rgba(0, 0, 0, 0.09);
  }
  :global([data-theme="light"]) .candidate-card {
    border-color: rgba(0, 0, 0, 0.08);
  }
  :global([data-theme="light"]) .candidate-card:hover {
    border-color: rgba(0, 0, 0, 0.15);
  }

  .candidate-card:hover {
    /* No background change on hover as requested */
    border-color: rgba(255, 255, 255, 0.12);
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
    height: 36px;
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
    40% {
      transform: scale(1.6) rotate(15deg);
    }
    100% {
      transform: scale(1);
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
    animation: starPop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .save-label {
    font-weight: 500;
  }

  .history-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    align-items: center;
    cursor: default;
  }

  .history-item-main {
    flex: 1;
    cursor: pointer;
    overflow: hidden;
    background: none;
    border: none;
    text-align: left;
    padding: 0;
    color: inherit;
    font: inherit;
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
    margin-bottom: 10px;
    min-height: 32px;
  }

  .style-name-display {
    font-weight: 600;
    color: var(--text-main);
    font-size: 15px;
  }

  .style-header-actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn-small {
    width: 28px;
    height: 28px;
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
    margin-top: 10px;
    display: flex;
    justify-content: center;
    gap: 10px;
    font-size: 11px;
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
    flex-wrap: nowrap;
    justify-content: center;
    gap: 6px;
    font-size: 11px;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    border-color: rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.03);
  }
  :global([data-theme="light"]) .style-chip:hover {
    border-color: rgba(0, 0, 0, 0.2);
  }
  :global([data-theme="light"]) .style-chip.add-chip.active {
    background: rgba(0, 0, 0, 0.08);
    border-color: rgba(0, 0, 0, 0.15);
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
</style>
