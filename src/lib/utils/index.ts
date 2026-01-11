// Utility functions for Howlingual

import {
	LANGUAGE_DETECTION_MIN_CHARS,
	TTS_LANGUAGE_CODES,
} from "$lib/constants";

/**
 * Simple language detection based on character patterns
 */
export function detectLanguageSimple(text: string): string {
	// ひらがな・カタカナがあれば確実に日本語
	const hasHiraganaKatakana = /[\u3040-\u30ff]/.test(text);
	if (hasHiraganaKatakana) return "日本語";

	// 漢字のみの場合は日本語として扱う（簡易判定）
	const hasKanji = /[\u4e00-\u9faf]/.test(text);
	if (hasKanji) return "日本語";

	return "英語";
}

/**
 * Check if text is Japanese (contains hiragana, katakana, or kanji)
 */
export function isJapaneseText(text: string): boolean {
	return /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(
		text
	);
}

/**
 * Check if text has enough characters for reliable language detection
 */
export function hasEnoughCharsForDetection(text: string): boolean {
	return text.trim().length >= LANGUAGE_DETECTION_MIN_CHARS;
}

/**
 * Get TTS language code from language name
 */
export function getTTSLanguageCode(lang: string): string {
	return TTS_LANGUAGE_CODES[lang] || "en-US";
}

/**
 * Format duration in seconds to display string
 */
export function formatDuration(seconds: number): string {
	return seconds.toFixed(1);
}

/**
 * Format tokens per second
 */
export function formatTokensPerSec(tokensPerSec: number): string {
	return tokensPerSec.toFixed(1);
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
	return crypto.randomUUID();
}

/**
 * Format timestamp to locale date string
 */
export function formatTimestamp(timestamp: number, locale: string = "ja-JP"): string {
	return new Date(timestamp).toLocaleString(locale);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => void>(
	fn: T,
	delay: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			timeoutId = null;
			fn(...args);
		}, delay);
	};
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => void>(
	fn: T,
	limit: number
): (...args: Parameters<T>) => void {
	let lastRan: number | null = null;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>) => {
		const now = Date.now();

		if (lastRan === null || now - lastRan >= limit) {
			fn(...args);
			lastRan = now;
		} else {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			timeoutId = setTimeout(() => {
				fn(...args);
				lastRan = Date.now();
			}, limit - (now - lastRan));
		}
	};
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if running on macOS
 */
export function isMac(): boolean {
	return typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
}

/**
 * Replace platform-specific shortcut modifier
 */
export function formatShortcut(shortcut: string): string {
	return shortcut.replace("CommandOrControl", isMac() ? "Command" : "Ctrl");
}

/**
 * Try to parse JSON safely, returning null on failure
 */
export function safeJsonParse<T>(json: string): T | null {
	try {
		return JSON.parse(json) as T;
	} catch {
		return null;
	}
}

/**
 * Deep clone an object using structuredClone (modern browsers) or JSON serialization (fallback)
 */
export function deepClone<T>(obj: T): T {
	if (typeof structuredClone === "function") {
		return structuredClone(obj);
	}
	// Fallback for older environments (note: doesn't handle functions, undefined, symbols, dates correctly)
	return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if two arrays are equal (shallow comparison)
 */
export function arraysEqual<T>(a: T[], b: T[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((item, index) => item === b[index]);
}

/**
 * Pick specific keys from an object
 */
export function pick<T extends object, K extends keyof T>(
	obj: T,
	keys: K[]
): Pick<T, K> {
	const result = {} as Pick<T, K>;
	for (const key of keys) {
		if (key in obj) {
			result[key] = obj[key];
		}
	}
	return result;
}

/**
 * Omit specific keys from an object
 */
export function omit<T extends object, K extends keyof T>(
	obj: T,
	keys: K[]
): Omit<T, K> {
	const result = { ...obj };
	for (const key of keys) {
		delete result[key];
	}
	return result;
}
