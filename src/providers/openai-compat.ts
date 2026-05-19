import { requestUrl } from 'obsidian';
import { ModelProvider, ProviderConfig } from './base';

export class OpenAICompatibleProvider implements ModelProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: ProviderConfig, baseUrl: string) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async recognize(imageBase64: string): Promise<string> {
    const payload = {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
              },
            },
            {
              type: 'text',
              text: this.getPrompt(),
            },
          ],
        },
      ],
      max_completion_tokens: 2000,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await requestUrl({
      url: `${this.baseUrl}/chat/completions`,
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      throw: false,
    });

    if (response.status >= 400) {
      const msg = response.json?.error?.message ?? response.text;
      throw new Error(`API Error ${response.status}: ${msg}`);
    }

    return response.json.choices[0].message.content;
  }

  private getPrompt(): string {
    return `Transcribe this handwritten content into Markdown format:
1. Preserve all text and numbers exactly
2. Use LaTeX for math: inline with $...$, block with $$...$$
3. Keep document structure (headings, paragraphs, lists)
4. Output only the Markdown, no extra commentary`;
  }
}
