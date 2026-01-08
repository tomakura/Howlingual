<script lang="ts">
  import { tick } from "svelte";
  import { fade, scale, fly } from "svelte/transition";
  let inputQuery = $state(
    "Even though the deadline was tight, I decided to rewrite the entire document so that anyone could understand it without additional explanation. The previous version contained too many technical terms and assumed prior knowledge that most readers wouldn't have. After consulting with the team, we agreed that a complete rewrite would be more efficient than trying to patch the existing content. I spent the entire weekend restructuring the information flow and simplifying the language while ensuring that no critical details were lost in the process.",
  );

  // Language direction
  let isAutoDetect = $state(true);
  let detectedLang = $state("英語"); // Mock: detected as English
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
      sourceLang = detectedLang;
      // Trigger temporary sparkle animation
      isSparkling = true;
      setTimeout(() => {
        isSparkling = false;
      }, 1000);
    } else {
      isAutoDetect = false;
      sourceLang = lang;
    }
    showSourceLangMenu = false;
  }

  function selectTargetLang(lang: string) {
    targetLang = lang;
    showTargetLangMenu = false;
  }

  // Close menus when clicking outside
  $effect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".lang-selector")) {
        showSourceLangMenu = false;
        showTargetLangMenu = false;
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  });

  // Style levels: 0 = オフ, 1 = 弱, 2 = 強
  let styleLevels: Record<string, number> = $state({
    フォーマル: 2,
    カジュアル: 0,
    技術: 1,
    簡潔: 0,
  });

  // Copy feedback state
  let copiedId: number | null = $state(null);

  function handleCopy(id: number) {
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

  function onMainScroll() {
    if (!scrollContainerEl || !textareaEl) return;

    // Manage scrolling state for scrollbar visibility
    isScrolling = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
    }, 1000);

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
  let translations = [
    {
      id: 1,
      text: "納期が厳しい状況ではありましたが、誰もが追加説明なしで理解できるよう、文書全体を書き直すことにいたしました。以前のバージョンは専門用語が多く、読者が持っていないであろう前提知識を必要としておりました。チームと相談した結果、既存の内容を修正するよりも、全面的に書き直す方が効率的であるという結論に至りました。週末を通して情報の流れを再構成し、重要な詳細を失わないよう注意しながら、言語を簡潔化いたしました。",
      reason:
        "「いたしました」「おりました」で謙譲語を一貫して使用し、最もフォーマルな表現です。",
    },
    {
      id: 2,
      text: "締め切りがタイトでしたが、追加の説明がなくても誰でも理解できるように、ドキュメント全体をリライトすることを決定しました。前のバージョンはテクニカルタームが多すぎて、多くの読者が持っていない前提知識を想定していました。チームとディスカッションした後、既存コンテンツをパッチするより、フルリライトの方がエフィシェントだと合意しました。週末をまるまる使って、情報フローをリストラクチャリングし、クリティカルなディテールを失わないよう注意しながら言語をシンプルにしました。",
      reason:
        "「ドキュメント」「リライト」「テクニカルターム」など技術文書で馴染みのあるカタカナ語を多用しています。",
    },
    {
      id: 3,
      text: "期限に余裕がない中、補足説明なしに誰でも内容を把握できるよう、資料を全面的に改訂する判断をしました。以前の版は専門用語が過多で、大半の読者が有していない予備知識を前提としていました。チームとの協議の結果、既存内容の部分修正より全面改訂の方が効率的との結論に達しました。週末を費やし、情報構成を再編し、重要事項を漏らさぬよう配慮しつつ表現を平易化しました。",
      reason:
        "「資料」「改訂」「協議」など漢語を多用し、よりビジネス寄りの硬い表現です。",
    },
  ];
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
          {sourceLang}
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
        title="履歴"
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
        title="設定"
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
          placeholder="テキストを入力または選択..."
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
        <div class="styles-row">
          {#each Object.keys(styleLevels) as style, i}
            <button
              class="style-chip"
              style="animation-delay: {i * 0.05}s"
              onclick={() => cycleLevel(style)}
              onpointerdown={(e) => handleDrag(style, e)}
            >
              <span class="chip-fill" style="width: {styleLevels[style] * 50}%"
              ></span>
              <span class="chip-text">{style}</span>
            </button>
          {/each}
          <button
            class="style-chip add-chip"
            style="animation-delay: {Object.keys(styleLevels).length * 0.05}s"
            >+</button
          >
        </div>
      {/if}

      <!-- Single action button that morphs -->
      <button
        class="action-btn"
        class:translate-mode={!isScrolledDown}
        class:scroll-mode={isScrolledDown}
        title={isScrolledDown ? "上に戻る" : "翻訳"}
        onclick={isScrolledDown ? scrollToTop : undefined}
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

    <!-- Translation Results -->
    <div class="output-area">
      {#each translations as item (item.id)}
        <div class="candidate-card">
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
                title="コピー"
                onclick={() => handleCopy(item.id)}
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
                class:animating={speakAnimating[item.id]}
                title="読み上げ"
                onmouseenter={() => triggerSpeakAnim(item.id)}
              >
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
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
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
              </button>
            </div>
          </div>
        </div>
      {/each}

      <!-- Explanation -->
      <div class="explanation-card">
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
          詳しい解説
        </h3>
        <ul class="explanation-list">
          <li>
            <strong>deadline was tight</strong>:
            「納期が厳しい」「締め切りがタイト」「期限に余裕がない」
          </li>
          <li>
            <strong>rewrite</strong>: 「書き直す」「リライトする」「改訂する」
          </li>
          <li>
            <strong>without additional explanation</strong>:
            「追加説明なしで」「補足説明なしに」
          </li>
        </ul>
      </div>
    </div>
  </section>
</main>

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
    height: 48px;
    flex-shrink: 0;
    margin-top: 8px;
    margin-bottom: 8px; /* Added margin below header */
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 140px; /* Fixed width for alignment */
  }

  .app-title {
    font-family: "Jost", sans-serif;
    font-weight: 700;
    font-size: 25px;
    color: var(--text-main);
    letter-spacing: 0.5px;
    padding-top: 2px; /* Visual alignment with icon */
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
    width: 32px;
    height: 32px;
    object-fit: contain;
    border-radius: 8px;
  }

  .sparkle-icon {
    color: #fbbf24;
    transition: all 0.3s var(--easing);
  }

  .sparkle-icon.is-active {
    filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.4));
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

  /* Main Scroll Container */
  .main-scroll {
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
    padding: 14px 14px 14px 24px; /* Even more visual balance for scrollbar */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
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
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .style-chip {
    position: relative;
    display: flex;
    align-items: center;
    padding: 5px 12px;
    border-radius: 12px;
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
    opacity: 0.6;
    transition: width 0.15s var(--easing);
    border-radius: 12px 0 0 12px;
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

  .translate-btn {
    background: var(--primary-color);
    color: #fff;
    border: none;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      transform 0.2s var(--easing),
      background 0.2s;
    flex-shrink: 0;
    animation: popIn 0.3s var(--easing);
  }
  .translate-btn:hover {
    background: var(--primary-hover);
    transform: scale(1.05);
  }
  .translate-btn:active {
    transform: scale(0.94);
  }

  /* Overlay layout */
  .overlay-content {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .scroll-top-btn {
    background: var(--text-main);
    color: var(--bg-color);
    border: none;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    animation: popIn 0.3s var(--easing);
    transition:
      transform 0.2s var(--easing),
      background 0.2s;
  }
  .scroll-top-btn:hover {
    background: #fff;
    transform: scale(1.05);
  }
  .scroll-top-btn:active {
    transform: scale(0.94);
  }

  @keyframes popIn {
    0% {
      transform: scale(0.5);
      opacity: 0;
    }
    70% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* Translation Cards */
  .candidate-card {
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    /* Base background */
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    transition: background 0.2s;
    flex-shrink: 0;
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
    font-size: 15px;
    font-weight: 500;
    margin-bottom: 8px;
    color: #fff;
    line-height: 1.5;
    user-select: text;
    cursor: text;
  }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 10px;
  }

  .reason {
    font-size: 12px;
    color: var(--text-muted);
    flex: 1;
    line-height: 1.4;
    display: flex;
    gap: 6px;
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
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  h3 {
    font-size: 11px;
    margin-bottom: 8px;
    color: var(--text-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 6px;
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
</style>
