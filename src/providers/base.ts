export interface ModelProvider {
  recognize(imageBase64: string): Promise<string>;
}

export type ProviderType = 'openai' | 'qwen' | 'gemini' | 'claude';

export interface ProviderConfig {
  apiKey: string;
  model: string;
}
