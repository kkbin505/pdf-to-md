import { requestUrl } from 'obsidian';
import { ModelProvider, ProviderConfig } from './base';

export class AnthropicProvider implements ModelProvider {
  private apiKey: string;
  private model: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  private getMediaType(imageBase64: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
    if (imageBase64.startsWith('/9j/')) return 'image/jpeg';
    if (imageBase64.startsWith('iVBORw0KGgo')) return 'image/png';
    if (imageBase64.startsWith('UklGR')) return 'image/webp';
    if (imageBase64.startsWith('R0lGOD')) return 'image/gif';
    return 'image/png';
  }

  async recognize(imageBase64: string): Promise<string> {
    const payload = {
      model: this.model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: this.getMediaType(imageBase64),
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: this.getPrompt(),
            },
          ],
        },
      ],
    };

    const response = await requestUrl({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      throw: false,
    });

    if (response.status >= 400) {
      const msg = response.json?.error?.message ?? response.text;
      throw new Error(`Anthropic API Error ${response.status}: ${msg}`);
    }

    return response.json.content[0].text;
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
