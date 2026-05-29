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
                url: `data:${this.getMediaType(imageBase64)};base64,${imageBase64}`,
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
      stream: false,
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
      throw new Error(`API Error ${response.status}: ${response.text.substring(0, 300)}`);
    }

    let parsed: any;
    try {
      parsed = response.json;
    } catch (e) {
      throw new Error(`JSON parse failed. Raw response (first 500 chars): ${response.text.substring(0, 500)}`);
    }

    return parsed.choices[0].message.content;
  }

  private getMediaType(imageBase64: string): string {
    if (imageBase64.startsWith('/9j/')) return 'image/jpeg';
    if (imageBase64.startsWith('iVBORw0KGgo')) return 'image/png';
    if (imageBase64.startsWith('UklGR')) return 'image/webp';
    return 'image/jpeg';
  }

  private getPrompt(): string {
    return `Transcribe the content in this image into Markdown format:
1. Preserve all text and numbers exactly as they appear
2. Use LaTeX for math expressions: inline with $...$, block with $$...$$
3. If the image contains tables, transcribe them into standard Markdown table format. Maintain the original row and column structure; leave blank cells empty.
4. Output only the Markdown, no extra commentary
5. Do NOT wrap the final response in any markdown code fences or code blocks`;
  }
}
