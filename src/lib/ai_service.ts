export type AiModel = string;

export interface TranslationResult {
  id?: number;
  text: string;
  reason: string;
}

export interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
}

export interface AiResponse {
  detected_source_language: string;
  candidates: TranslationResult[];
  detailed_explanation?: {
    points: { term: string; explanation: string }[];
  };
  usage?: UsageMetadata;
}
