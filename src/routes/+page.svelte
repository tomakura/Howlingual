<script lang="ts">
  import { tick, onMount, untrack } from "svelte";
  import { fade, scale, fly } from "svelte/transition";
  import { translateTextStream, type AiModel } from "$lib/ai_service";
  import {
    t,
    getLanguageName,
    getStyleName,
    getTargetLanguageName,
    type AppLanguage,
  } from "$lib/i18n";
  import { getDefaultStyles } from "$lib/style_defaults";

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

  // Custom Styles
  type CustomStyle = {
    id: string;
    name: string;
    prompt: string;
    isDefault?: boolean;
  };

  let customStyles = $state<CustomStyle[]>(getDefaultStyles("ja"));
  let editingStyleId = $state<string | null>(null);
  let showResetConfirmation = $state(false);

  let styleOverflowOpen = $state(false);

  // Sort styles: Active first, then original order
  let sortedStyles = $derived.by(() => {
    return [...customStyles].sort((a, b) => {
      const aLev = styleLevels[a.name] || 0;
      const bLev = styleLevels[b.name] || 0;
      if (aLev > 0 && bLev === 0) return -1;
      if (aLev === 0 && bLev > 0) return 1;
      return 0;
    });
  });

  let visibleStyles = $derived(sortedStyles.slice(0, 4));
  let hiddenStyles = $derived(sortedStyles.slice(4));

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

  // Load settings on mount
  onMount(() => {
    const saved = localStorage.getItem("howlingual_settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.model) selectedModel = parsed.model;
        if (parsed.apiKeys) apiKeys = { ...apiKeys, ...parsed.apiKeys };
        if (parsed.defaultTargetLang)
          defaultTargetLang = parsed.defaultTargetLang;
        if (parsed.theme) theme = parsed.theme;
        if (parsed.appLanguage) appLanguage = parsed.appLanguage;
        if (parsed.customStyles) customStyles = parsed.customStyles;

        // Apply theme on load
        document.documentElement.setAttribute("data-theme", theme);
      } catch (e) {
        console.warn("Failed to parse saved settings", e);
      }
    }
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

  async function addStyle() {
    const id = crypto.randomUUID();
    customStyles = [
      ...customStyles,
      {
        id,
        name: "New Style",
        prompt: "",
        isDefault: false,
      },
    ];
    await tick();
    editingStyleId = id;

    // Scroll to the new item
    const container = document.querySelector(".styles-list-container");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function deleteStyle(index: number) {
    customStyles = customStyles.filter((_, i) => i !== index);
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

  // Close menus when clicking outside
  $effect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        !target.closest(".lang-selector") &&
        !target.closest(".style-dropdown-wrapper")
      ) {
        showSourceLangMenu = false;
        showTargetLangMenu = false;
        styleOverflowOpen = false;
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  });

  // Style levels: 0 = オフ, 1 = 弱, 2 = 強

  // Copy feedback state
  let copiedId: number | null = $state(null);

  function handleCopy(id: number, text: string) {
    console.log(`[UI] Copy triggered for ID: ${id}`);
    navigator.clipboard.writeText(text);
    copiedId = id;
    setTimeout(() => {
      copiedId = null;
    }, 1500);
  }

  // Button animation states (to prevent animation interruption on hover end)
  let historyAnimating = $state(false);
  let settingsAnimating = $state(false);
  let speakAnimating: Record<number, boolean> = $state({});
  let copyAnimating: Record<number, boolean> = $state({});
  let isSpeakingId: number | null = $state(null);

  function triggerHistoryAnim() {
    if (historyAnimating) return;
    historyAnimating = true;
    setTimeout(() => {
      historyAnimating = false;
    }, 1000);
  }

  function triggerSettingsAnim() {
    if (settingsAnimating) return;
    settingsAnimating = true;
    setTimeout(() => {
      settingsAnimating = false;
    }, 1000);
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
    const maxHeight = 200;

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
  let translations: { id: number; text: string; reason: string }[] = $state([]);
  let detailedExplanation: {
    points: { term: string; explanation: string }[];
  } | null = $state(null);
  let isTranslating = $state(false);
  let showExplanation = $state(true);
  let isDetecting = $state(false);
  let errorMessage = $state("");

  async function startTranslation() {
    if (isTranslating || !inputQuery.trim()) return;
    isTranslating = true;
    showExplanation = false; // Hide explanation during translation
    showSourceLangMenu = false; // Close menu if open
    showTargetLangMenu = false; // Close menu if open
    showTargetLangMenu = false; // Close menu if open
    translations = []; // Clear current results
    detailedExplanation = null; // Clear explanation
    errorMessage = "";

    // Handle Auto-detect mock logic
    if (isAutoDetect) {
      isDetecting = true;
      detectedLang = ""; // Clear previous detection result
    }

    try {
      console.log(
        `[Translation] Starting translation with model: ${currentModel}`,
      );
      console.log(`[Translation] Input: "${inputQuery.substring(0, 30)}..."`);

      // Call AI API with Streaming
      // Get explanation language based on app language setting
      const explanationLangName = getLanguageName(appLanguage);

      // Extract prompts for active styles
      const activeStylePrompts: Record<string, string> = {};
      Object.keys(styleLevels).forEach((name) => {
        if (styleLevels[name] > 0) {
          const styleDef = customStyles.find((s) => s.name === name);
          if (styleDef && styleDef.prompt) {
            activeStylePrompts[name] = styleDef.prompt;
          }
        }
      });

      await translateTextStream(
        inputQuery,
        sourceLang,
        targetLang,
        styleLevels,
        currentModel,
        (partialResult) => {
          // Handle Detection Result updates
          if (isAutoDetect && partialResult.detected_source_language) {
            // Only update if we haven't finalized it yet or it changed
            if (detectedLang !== partialResult.detected_source_language) {
              detectedLang = partialResult.detected_source_language;
              isDetecting = false;
            }
          }

          // Update Translations
          if (partialResult.candidates && partialResult.candidates.length > 0) {
            // Ensure IDs exist for the UI loop
            translations = partialResult.candidates.map((c, i) => {
              if (i === 0 && c.reason) {
                // Debug first reason periodically
                // console.log(`[UI] Candidate 1 reason: ${c.reason.substring(0, 20)}...`);
              }
              return {
                ...c,
                id: c.id || i + 1,
                reason: c.reason || "", // Ensure reason is at least empty string
              };
            });
          }

          // Update Detailed Explanation
          if (partialResult.detailed_explanation) {
            detailedExplanation = partialResult.detailed_explanation as any;
            showExplanation = true;
          }
        },
        explanationLangName,
        activeStylePrompts,
      );

      // Final check for detecting state just in case
      if (isAutoDetect) isDetecting = false;
    } catch (error) {
      console.error("Translation failed:", error);
      errorMessage =
        "AI翻訳エラーが発生しました。\nAPIキーの設定やネットワーク接続を確認してください。";
      isDetecting = false;
    } finally {
      isTranslating = false;
    }
  }

  // Initial load (optional: remove if we want it empty by default)
  // Initial load: Start empty
  $effect(() => {
    // No initial data
  });
</script>

<main class="container">
  <!-- App Header -->
  <header class="app-header">
    <div class="header-left">
      <img src="/icon-dark.svg" alt="Howlingual" class="app-icon" />
      <h1 class="app-title">Howlingual</h1>
    </div>

    <!-- Language Direction Header -->
    <div class="lang-header">
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

    <div class="header-right">
      <button
        class="icon-btn header-btn history-btn"
        class:animating={historyAnimating}
        title={t(appLanguage, "history")}
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
  <div class="scroll-wrapper">
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
        {#if isScrolledDown}
          <!-- Scrolled state: show text preview + scroll-to-top -->
          <p class="text-preview">
            {inputQuery}
          </p>
        {:else}
          <!-- Default state: show style chips -->
          <div class="styles-row" class:fade-out={isTranslating}>
            {#each visibleStyles as style (style.id)}
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

            <div class="style-dropdown-wrapper">
              <button
                class="style-chip add-chip"
                onclick={() => (styleOverflowOpen = !styleOverflowOpen)}
                class:active={styleOverflowOpen}
              >
                ...
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
                      >
                        <span
                          class="dropdown-item-fill"
                          style="width: {(styleLevels[style.name] || 0) * 50}%"
                        ></span>
                        <div class="dropdown-item-content">
                          <span>{style.name}</span>
                          {#if (styleLevels[style.name] || 0) > 0}
                            <span class="level-indicator">ON</span>
                          {/if}
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
        {/if}

        {#if isTranslating}
          <div class="translating-label" transition:fade>
            <span>{t(appLanguage, "translating")}</span>
          </div>
        {/if}

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
            <!-- Bouncing dots animation -->
            <div class="bouncing-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
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
            <p class="translated-text">{item.text}</p>
            <div class="card-footer">
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
              <div class="candidate-actions">
                <button
                  class="icon-btn copy-btn"
                  class:copied={copiedId === item.id}
                  class:animating={copyAnimating[item.id]}
                  title={t(appLanguage, "copy")}
                  onclick={() => handleCopy(item.id, item.text)}
                  onmouseenter={() => triggerCopyAnim(item.id)}
                >
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
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"
                      ></rect>
                      <path
                        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                      ></path>
                    </svg>
                  {/if}
                </button>
                <button
                  class="icon-btn speak-btn"
                  class:active={isSpeakingId === item.id}
                  class:animating={speakAnimating[item.id]}
                  title={isSpeakingId === item.id
                    ? t(appLanguage, "stop")
                    : t(appLanguage, "speak")}
                  onclick={() => handleSpeak(item.id, item.text, targetLang)}
                  onmouseenter={() => triggerSpeakAnim(item.id)}
                >
                  {#if isSpeakingId === item.id}
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="none"
                    >
                      <rect x="6" y="6" width="12" height="12" rx="1" />
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

<!-- Settings Modal -->
{#if showSettings}
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
      transition:fly={{ x: 300, duration: 300 }}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
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

      <!-- Tabs -->
      <div class="settings-tabs">
        <button
          class="settings-tab"
          class:active={settingsTab === "general"}
          onclick={() => (settingsTab = "general")}
        >
          {t(appLanguage, "tabGeneral")}
        </button>
        <button
          class="settings-tab"
          class:active={settingsTab === "api"}
          onclick={() => (settingsTab = "api")}
        >
          {t(appLanguage, "tabApiKeys")}
        </button>
        <button
          class="settings-tab"
          class:active={settingsTab === "styles"}
          onclick={() => (settingsTab = "styles")}
        >
          {t(appLanguage, "tabStyles")}
        </button>
      </div>

      <div class="settings-content">
        {#if settingsTab === "general"}
          <!-- Model Selection -->
          <div class="settings-section">
            <label class="settings-label" for="model-select"
              >{t(appLanguage, "aiModel")}</label
            >
            <select
              id="model-select"
              class="settings-select"
              bind:value={selectedModel}
            >
              {#each availableModels as model}
                <option value={model.value}>{model.label}</option>
              {/each}
            </select>
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
                >{getTargetLanguageName(appLanguage, "フランス語")}</option
              >
              <option value="ドイツ語"
                >{getTargetLanguageName(appLanguage, "ドイツ語")}</option
              >
              <option value="スペイン語"
                >{getTargetLanguageName(appLanguage, "スペイン語")}</option
              >
            </select>
          </div>

          <!-- Theme -->
          <div class="settings-section">
            <label class="settings-label">{t(appLanguage, "theme")}</label>
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
        {:else if settingsTab === "api"}
          <!-- API Keys Tab -->
          <div class="settings-section">
            <label class="settings-label" for="openai-key"
              >{t(appLanguage, "openaiApiKey")}</label
            >
            <input
              id="openai-key"
              type="password"
              class="settings-input"
              bind:value={apiKeys.openai}
              placeholder="sk-..."
            />
          </div>

          <div class="settings-section">
            <label class="settings-label" for="gemini-key"
              >{t(appLanguage, "geminiApiKey")}</label
            >
            <input
              id="gemini-key"
              type="password"
              class="settings-input"
              bind:value={apiKeys.gemini}
              placeholder="AIza..."
            />
          </div>

          <div class="settings-section">
            <label class="settings-label" for="anthropic-key"
              >{t(appLanguage, "anthropicApiKey")}</label
            >
            <input
              id="anthropic-key"
              type="password"
              class="settings-input"
              bind:value={apiKeys.anthropic}
              placeholder="sk-ant-..."
            />
          </div>
        {:else if settingsTab === "styles"}
          <!-- Styles Tab -->
          <div class="styles-actions-top">
            <button class="rich-btn primary" onclick={addStyle}>
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
            <button class="rich-btn danger" onclick={triggerResetStyles}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                class="btn-icon-left"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                ></path>
                <path d="M3 3v5h5"></path>
              </svg>
              {t(appLanguage, "resetStyles")}
            </button>
          </div>

          <div class="styles-list-container">
            {#each customStyles as style, i (style.id)}
              <div
                class="style-item-card"
                class:editing={editingStyleId === style.id}
              >
                <div class="style-header-row">
                  {#if editingStyleId === style.id}
                    <input
                      type="text"
                      class="style-name-input"
                      bind:value={style.name}
                      oninput={() => (style.isDefault = false)}
                      placeholder={t(appLanguage, "styleName")}
                      autofocus
                    />
                    <button
                      class="icon-btn-small done-btn"
                      onclick={() => (editingStyleId = null)}
                      title="Done"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </button>
                  {:else}
                    <span class="style-name-display">{style.name}</span>
                    <div class="style-header-actions">
                      <button
                        class="icon-btn-small edit-btn"
                        onclick={() => (editingStyleId = style.id)}
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
                  {/if}
                </div>

                {#if editingStyleId === style.id}
                  <textarea
                    class="style-prompt-input"
                    bind:value={style.prompt}
                    oninput={() => (style.isDefault = false)}
                    placeholder={t(appLanguage, "stylePrompt")}
                  ></textarea>
                {:else}
                  <div class="style-prompt-display">
                    {style.prompt}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="settings-footer">
        <button class="save-btn" onclick={closeSettings}>閉じる</button>
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
    tabindex="0"
    onkeydown={(e) => e.key === "Escape" && (showResetConfirmation = false)}
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

<style>
  .container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    padding: 0;
    overflow: hidden;
  }

  /* App Header & Layout */
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 16px;
    height: 56px;
    flex-shrink: 0;
    margin-top: 4px;
    margin-bottom: 4px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 140px; /* Fixed width for alignment */
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
    width: 140px; /* Fixed width for alignment */
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
      transform: rotate(180deg);
    }
  }

  /* Language Header (Centered) */
  .lang-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex: 1;
    color: var(--text-muted);
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
    z-index: 100;
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
    margin: 0 16px 16px 16px; /* Left, Right, Bottom margin */
    border-radius: 20px;
    overflow: hidden; /* Ensure content respects border-radius */
    border: 1px solid var(--border-color); /* Optional: distinct edge */
    min-height: 0;
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

  .text-preview {
    flex: 1;
    font-size: 13px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    margin: 0;
    position: relative;
    /* Soft wipe reveal + Right side blur fade */
    /* 200% width: 0-50% is the visible gradient, 50-100% is transparent */
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
    mask-position: 0% 0;
    -webkit-mask-position: 0% 0;

    animation: wipeInSoft 1.5s cubic-bezier(0.5, 1, 0.89, 1);
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
    transition: opacity 0.3s ease;
  }

  .styles-row.fade-out {
    opacity: 0.15;
    pointer-events: none;
    mask-image: linear-gradient(to right, black 70%, transparent 100%);
  }

  .translating-label {
    margin-right: 8px; /* Push it next to button */
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--primary);
    font-weight: 500;
    pointer-events: none;
    z-index: 10;
    white-space: nowrap;
  }

  .translating-label span {
    animation: pulseText 1.5s infinite;
  }

  @keyframes pulseText {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
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
    /* Pop in animation when reappearing */
    animation: chipPop 0.4s var(--easing) backwards;
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
    background: #4ade80; /* Soft Green */
    opacity: 0.25;
  }

  .style-chip[data-level="2"] .chip-fill {
    background: #f87171; /* Soft Red */
    opacity: 0.25;
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
  .add-chip .chip-fill {
    display: none;
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
    transition: background 0.2s;
    flex-shrink: 0;
    animation: popIn 0.5s var(--easing) backwards;
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

  .candidate-card:hover .candidate-actions {
    opacity: 1;
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

  /* Bouncing Dots Animation */
  .bouncing-dots {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 4px;
  }

  .bouncing-dots span {
    width: 4px;
    height: 4px;
    background-color: currentColor;
    border-radius: 50%;
    animation: bounce 0.6s infinite alternate; /* Speed up to 0.6s */
  }

  .bouncing-dots span:nth-child(2) {
    animation-delay: 0.1s;
  }

  .bouncing-dots span:nth-child(3) {
    animation-delay: 0.2s;
  }

  @keyframes bounce {
    to {
      transform: translateY(-6px);
      opacity: 0.6;
    }
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
  .settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1000;
    display: flex;
    justify-content: flex-end;
    backdrop-filter: blur(4px);
  }

  .settings-panel {
    width: 340px;
    height: 100%;
    background: var(--glass-color);
    border-left: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid var(--border-color);
  }

  .settings-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-main);
    margin: 0;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s;
  }
  .close-btn:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.1);
  }

  .settings-content {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .settings-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .settings-select,
  .settings-input {
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

  .settings-footer {
    padding: 20px;
    border-top: 1px solid var(--border-color);
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

  .settings-divider {
    height: 1px;
    background: var(--border-color);
    margin: 8px 0;
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

  .style-item-card.editing {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(255, 255, 255, 0.15);
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

  .style-name-input {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 4px 8px;
    color: white;
    font-size: 14px;
    flex: 1;
    margin-right: 8px;
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

  .icon-btn-small.done-btn {
    color: #4ade80;
    background: rgba(74, 222, 128, 0.1);
  }

  .icon-btn-small.done-btn:hover {
    background: rgba(74, 222, 128, 0.2);
  }

  .style-prompt-display {
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.5;
    padding: 10px;
    background: rgba(0, 0, 0, 0.1); /* Slightly darker for contrast */
    border-radius: 8px;
    min-height: 40px;
    white-space: pre-wrap;
    border: 1px solid rgba(255, 255, 255, 0.03);
  }

  .style-prompt-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 10px;
    color: var(--text-main);
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
    min-height: 60px;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

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

  .modal-btn {
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    border: none;
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

  /* Settings Tabs */
  .settings-tabs {
    display: flex;
    padding: 0 20px;
    gap: 4px;
    border-bottom: 1px solid var(--border-color);
  }

  .settings-tab {
    flex: 1;
    padding: 12px 16px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }
  .settings-tab:hover {
    color: var(--text-main);
  }
  .settings-tab.active {
    color: var(--primary-color);
    border-bottom-color: var(--primary-color);
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
    background: #4ade80;
    opacity: 0.25;
  }
  .dropdown-item[data-level="2"] .dropdown-item-fill {
    background: #f87171;
    opacity: 0.25;
  }

  .level-indicator {
    font-size: 10px;
    background: var(--accent-color);
    color: white;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: bold;
    /* Since we have fill, maybe indicator is redundant, but user asked to keep "ON" */
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
</style>
