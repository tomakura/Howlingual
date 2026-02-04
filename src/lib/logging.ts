let initialized = false;
let consoleWrapped = false;
let forwarding = false;

function stringifyArg(value: unknown): string {
	if (value instanceof Error) {
		return value.stack ? `${value.message}\n${value.stack}` : value.message;
	}
	try {
		if (typeof value === "string") return value;
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function serializeArgs(args: unknown[]): string {
	return args.map(stringifyArg).join(" ");
}

export async function initLogging() {
	if (initialized) return;
	initialized = true;

	try {
		const { attachConsole, error, info, warn, debug } = await import("@tauri-apps/plugin-log");
		attachConsole();
		void info("[logging] attachConsole ok");

		if (!consoleWrapped) {
			consoleWrapped = true;
			const original = {
				log: console.log.bind(console),
				info: console.info.bind(console),
				warn: console.warn.bind(console),
				error: console.error.bind(console),
				debug: console.debug.bind(console),
			};

			const forward = (level: (message: string) => Promise<void> | void, prefix: string, args: unknown[]) => {
				if (forwarding) return;
				forwarding = true;
				try {
					const message = `${prefix} ${serializeArgs(args)}`;
					void level(message);
				} finally {
					forwarding = false;
				}
			};

			console.log = (...args: unknown[]) => {
				original.log(...args);
				forward(info, "[console.log]", args);
			};
			console.info = (...args: unknown[]) => {
				original.info(...args);
				forward(info, "[console.info]", args);
			};
			console.warn = (...args: unknown[]) => {
				original.warn(...args);
				forward(warn, "[console.warn]", args);
			};
			console.error = (...args: unknown[]) => {
				original.error(...args);
				forward(error, "[console.error]", args);
			};
			console.debug = (...args: unknown[]) => {
				original.debug(...args);
				forward(debug ?? info, "[console.debug]", args);
			};
		}

		window.addEventListener("error", (event) => {
			const detail = [
				event.message,
				event.filename ? `@${event.filename}:${event.lineno}:${event.colno}` : "",
				event.error?.stack ? `\n${event.error.stack}` : "",
			].filter(Boolean).join(" ");
			void error(`[window.error] ${detail}`);
		});

		window.addEventListener("unhandledrejection", (event) => {
			const reason = event.reason instanceof Error
				? `${event.reason.message}\n${event.reason.stack ?? ""}`
				: String(event.reason);
			void error(`[unhandledrejection] ${reason}`);
		});
	} catch {
		// Ignore when plugin is unavailable (e.g., web/preview mode).
	}
}
