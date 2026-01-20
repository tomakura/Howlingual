<script lang="ts">
	import { fade, fly } from "svelte/transition";
	import { t } from "$lib/i18n";

	let {
		showHistory = $bindable(),
		isCompactMode,
		appLanguage,
		historyTab = $bindable("recent"),
		history,
		favorites,
		isFavoritedById,
		starAnimatingId,
		clearHistory,
		loadHistory,
		toggleFavorite,
		deleteHistoryItem,
		moveFavorite,
		deleteFavorite,
	} = $props();

	let historySlideDirection = $state(1);

	function changeHistoryTab(tab: typeof historyTab) {
		const order = ["recent", "saved"];
		const curr = order.indexOf(historyTab);
		const next = order.indexOf(tab);
		historySlideDirection = next > curr ? 1 : -1;
		historyTab = tab;
	}
</script>

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
							out:fly={{
								y: -historySlideDirection * 20,
								duration: 200,
							}}
							style="padding: 24px;"
						>
							{#if historyTab === "recent"}
								{#if history.length === 0}
									<div class="empty-state">
										<p>{t(appLanguage, "noHistory")}</p>
									</div>
								{:else}
									<div class="history-actions-top">
										<button
											class="rich-btn danger"
											onclick={clearHistory}
										>
											{t(appLanguage, "clearHistory")}
										</button>
									</div>
									<div class="history-list">
										{#each history as item (item.id)}
											<div
												class="style-item-card history-item"
												in:fly={{
													x: 20,
													duration: 250,
													delay: 50,
												}}
												out:fly={{
													x: -20,
													duration: 200,
												}}
											>
												<button
													class="history-item-main"
													onclick={() =>
														loadHistory(item)}
												>
													<div class="history-meta">
														<span
															>{new Date(
																item.timestamp,
															).toLocaleString()}</span
														>
														<span
															>{item.sourceLang} →
															{item.targetLang}</span
														>
													</div>
													<div class="history-source">
														{item.sourceText}
													</div>
													<div
														class="history-preview"
													>
														{item.translations[0]
															?.text}
													</div>
												</button>
												<div
													class="history-item-actions"
												>
													<button
														class="star-btn small"
														class:active={isFavoritedById(
															item.id,
														)}
														class:animating={starAnimatingId ===
															item.id}
														onclick={() =>
															toggleFavorite(
																item,
															)}
														aria-label="Toggle favorite"
													>
														<svg
															width="16"
															height="16"
															viewBox="0 0 24 24"
															fill={isFavoritedById(
																item.id,
															)
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
														onclick={() =>
															deleteHistoryItem(
																item.id,
															)}
														aria-label="Delete"
													>
														<svg
															width="14"
															height="14"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															><polyline
																points="3 6 5 6 21 6"
															></polyline><path
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
												in:fly={{
													x: 20,
													duration: 250,
													delay: 50,
												}}
												out:fly={{
													x: -20,
													duration: 200,
												}}
											>
												<button
													class="history-item-main"
													onclick={() =>
														loadHistory(item)}
												>
													<div class="history-meta">
														<span
															>{new Date(
																item.timestamp,
															).toLocaleString()}</span
														>
														<span
															>{item.sourceLang} →
															{item.targetLang}</span
														>
													</div>
													<div class="history-source">
														{item.sourceText}
													</div>
													<div
														class="history-preview"
													>
														{item.translations[0]
															?.text}
													</div>
												</button>
												<div
													class="history-item-actions vertical"
												>
													<div class="move-actions">
														<button
															class="icon-btn-small"
															onclick={() =>
																moveFavorite(
																	i,
																	"up",
																)}
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
																><polyline
																	points="18 15 12 9 6 15"

																></polyline></svg
															>
														</button>
														<button
															class="icon-btn-small"
															onclick={() =>
																moveFavorite(
																	i,
																	"down",
																)}
															disabled={i ===
																favorites.length -
																	1}
															aria-label="Move down"
														>
															<svg
																width="14"
																height="14"
																viewBox="0 0 24 24"
																fill="none"
																stroke="currentColor"
																stroke-width="2"
																><polyline
																	points="6 9 12 15 18 9"

																></polyline></svg
															>
														</button>
													</div>
													<button
														class="icon-btn-small delete-btn"
														onclick={() =>
															deleteFavorite(
																item.id,
															)}
														aria-label="Delete favorite"
													>
														<svg
															width="14"
															height="14"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															><polyline
																points="3 6 5 6 21 6"
															></polyline><path
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

<style>
	/* Settings Modal Styles (Reused for consistency) */
	.settings-overlay {
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
		background: rgba(59, 130, 246, 0.1);
	}

	.settings-main-content {
		flex: 1;
		position: relative;
		overflow: hidden;
		background: rgba(0, 0, 0, 0.1);
	}

	.tab-content-wrapper {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.history-actions-top {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 12px;
	}

	.rich-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 8px 16px;
		border-radius: 12px;
		font-weight: 500;
		font-size: 13px;
		cursor: pointer;
		border: 1px solid rgba(255, 255, 255, 0.1);
		transition: all 0.2s ease;
		backdrop-filter: blur(4px);
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

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: stretch;
	}

	.style-item-card {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 8px;
		padding: 8px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		transition: all 0.2s;
	}

	.history-item {
		display: flex;
		gap: 12px;
		padding: 12px;
		align-items: stretch;
		cursor: default;
		/* Reused style-item-card but overriding direction */
		flex-direction: row;
	}

	.history-item:hover {
		background: rgba(255, 255, 255, 0.1);
		transform: translateY(-1px);
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
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}

	.history-meta {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--text-muted);
		margin-bottom: 6px;
		width: 100%;
	}

	.history-source {
		font-size: 13px;
		color: var(--text-main);
		font-weight: 500;
		margin-bottom: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		width: 100%;
	}

	.history-preview {
		font-size: 12px;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		width: 100%;
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

	.star-btn.small {
		padding: 6px;
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

	.empty-state {
		text-align: center;
		padding: 40px;
		color: var(--text-muted);
	}
</style>
