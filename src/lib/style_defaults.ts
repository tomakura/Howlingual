import type { AppLanguage } from "./i18n";

export type StyleDefinition = {
	id: string;
	name: string;
	prompt: string;
	isDefault: boolean;
};

export const getDefaultStyles = (lang: AppLanguage): StyleDefinition[] => {
	switch (lang) {
		case "en":
			return [
				{ id: "polite", name: "Polite", prompt: "Use polite and respectful language suitable for formal interactions.", isDefault: true },
				{ id: "business", name: "Business", prompt: "Use formal, clear, and professional language suitable for business contexts.", isDefault: true },
				{ id: "casual", name: "Casual", prompt: "Use casual, friendly, and colloquial language suitable for close friends.", isDefault: true },
				{ id: "catchy", name: "Catchy", prompt: "Use short, punchy, and impressive language that grabs attention.", isDefault: true },
				{ id: "child", name: "Kid-friendly", prompt: "Use simple words and easy-to-understand language suitable for children.", isDefault: true },
				{ id: "email", name: "Email", prompt: "Format the text as a proper email subject or body.", isDefault: true },
				{ id: "concise", name: "Concise", prompt: "Be concise and get straight to the point, minimizing word count.", isDefault: true },
			];
		case "zh":
			return [
				{ id: "polite", name: "礼貌", prompt: "使用礼貌、尊重的语言，适合正式场合。", isDefault: true },
				{ id: "business", name: "商务", prompt: "使用正式、清晰、专业的语言，适合商务环境。", isDefault: true },
				{ id: "casual", name: "休闲", prompt: "使用休闲、友好、口语化的语言，适合好朋友之间。", isDefault: true },
				{ id: "catchy", name: "吸引眼球", prompt: "使用简短、有力、令人印象深刻的语言，吸引注意力。", isDefault: true },
				{ id: "child", name: "儿童友好", prompt: "使用简单的词汇和易懂的语言，适合儿童。", isDefault: true },
				{ id: "email", name: "邮件", prompt: "将文本格式化为适当的电子邮件主题或正文。", isDefault: true },
				{ id: "concise", name: "简洁", prompt: "言简意赅，直奔主题，尽量减少字数。", isDefault: true },
			];
		case "ko":
			return [
				{ id: "polite", name: "정중", prompt: "공식적인 상호작용에 적합한 정중하고 존중하는 언어를 사용하세요.", isDefault: true },
				{ id: "business", name: "비즈니스", prompt: "비즈니스 맥락에 적합한 공식적이고 명확하며 전문적인 언어를 사용하세요.", isDefault: true },
				{ id: "casual", name: "캐주얼", prompt: "친한 친구에게 적합한 캐주얼하고 친근하며 구어체적인 언어를 사용하세요.", isDefault: true },
				{ id: "catchy", name: "캐치", prompt: "주의를 끄는 짧고 강렬하며 인상적인 언어를 사용하세요.", isDefault: true },
				{ id: "child", name: "어린이용", prompt: "어린이에게 적합한 쉬운 단어와 이해하기 쉬운 언어를 사용하세요.", isDefault: true },
				{ id: "email", name: "이메일", prompt: "텍스트를 적절한 이메일 제목이나 본문으로 형식을 지정하세요.", isDefault: true },
				{ id: "concise", name: "간결", prompt: "간결하게 요점을 바로 말하고 단어 수를 최소화하세요.", isDefault: true },
			];
		case "ja":
		default:
			return [
				{ id: "polite", name: "丁寧", prompt: "丁寧語・尊敬語・謙譲語を適切に使用する", isDefault: true },
				{ id: "business", name: "ビジネス", prompt: "ビジネスシーンに適した、フォーマルで明確な表現にする", isDefault: true },
				{ id: "casual", name: "カジュアル", prompt: "親しい間柄で使うような、砕けた表現にする", isDefault: true },
				{ id: "catchy", name: "キャッチー", prompt: "短く印象的で、人の目を引くような表現にする", isDefault: true },
				{ id: "child", name: "子ども向け", prompt: "ひらがなを多用し、子どもにも分かりやすい簡単な言葉にする", isDefault: true },
				{ id: "email", name: "メール", prompt: "メールの件名や本文として適切な形式にする", isDefault: true },
				{ id: "concise", name: "簡潔", prompt: "要点を絞り、できるだけ短く簡潔に表現する", isDefault: true },
			];
	}
};
