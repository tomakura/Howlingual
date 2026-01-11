import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const apiKey = import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY;

// Initialize ONLY if key is present
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export interface TranslationResult {
	id?: number; // Added for frontend compatibility
	text: string;
	reason: string;
}

export interface GeminiResponse {
	detected_source_language: string;
	candidates: TranslationResult[];
}

export async function translateWithGemini(
	text: string,
	sourceLang: string,
	targetLang: string,
	styles: Record<string, number>
): Promise<GeminiResponse> {
	if (!genAI) {
		throw new Error("API Key is missing. Please set VITE_GOOGLE_GENERATIVE_AI_API_KEY in .env");
	}

	// Construct style description
	const activeStyles = Object.entries(styles)
		.filter(([_, level]) => level > 0)
		.map(([style, level]) => `${style} (強度: ${level})`)
		.join(", ");

	const systemPrompt = `
    あなたはプロの翻訳者です。
    ユーザーから提供された原文を、指定された言語へ翻訳してください。
    
    [翻訳のルール]
    1. **厳密に3つの翻訳案**を作成すること。
       - 1つ目: 文脈を考慮した、最も最適で自然な翻訳。
       - 2つ目・3つ目: ニュアンスや表現を変えたバリエーション（例：よりフォーマル、より話し言葉的、別の語彙など）。指定された文体の範囲内でバリエーションを出すこと。
    2. **detected_source_language**: 原文の言語を判定し、日本語で出力すること（例: "英語", "日本語"）。
    3. 各翻訳案には、なぜその訳になったのか、どのようなニュアンスが含まれているかを**日本語で簡潔に**説明した「reason」を付けること。
  `;

	// Define the schema for controlled generation
	const schema = {
		type: SchemaType.OBJECT,
		properties: {
			detected_source_language: { type: SchemaType.STRING, description: "Detected language of the source text in Japanese" },
			candidates: {
				type: SchemaType.ARRAY,
				items: {
					type: SchemaType.OBJECT,
					properties: {
						text: { type: SchemaType.STRING, description: "Translated text" },
						reason: { type: SchemaType.STRING, description: "Explanation of the translation in Japanese" }
					},
					required: ["text", "reason"]
				}
			}
		},
		required: ["detected_source_language", "candidates"]
	} as const;

	const model = genAI.getGenerativeModel({
		model: "gemini-1.5-flash",
		systemInstruction: systemPrompt,
		generationConfig: {
			responseMimeType: "application/json",
			responseSchema: schema as any // Cast to any to bypass strict SDK type check if needed, or precise type
		}
	});

	const prompt = `
    [入力情報]
    原文: "${text}"
    翻訳元言語: ${sourceLang === "自動検出" ? "自動検出 (Auto-detect)" : sourceLang}
    翻訳先言語: ${targetLang}
    ${activeStyles ? `適用する文体・トーン: ${activeStyles}` : ""}
  `;

	try {
		const result = await model.generateContent(prompt);
		const response = result.response;
		const textResponse = response.text();

		// Parse JSON
		const data = JSON.parse(textResponse);

		// Add IDs for frontend iteration
		const candidates = data.candidates.map((c: any, i: number) => ({ ...c, id: i + 1 }));

		return {
			detected_source_language: data.detected_source_language,
			candidates
		};

	} catch (error) {
		console.error("Gemini Translation Error:", error);
		throw error;
	}
}
