import { ModelProvider, ProviderConfig } from './base';

// Import requestUrl from Obsidian
declare const app: any;

export class OpenAICompatibleProvider implements ModelProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: ProviderConfig, baseUrl: string) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = baseUrl;
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

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Use Obsidian's requestUrl to bypass CORS
      const response = await (window as any).app.vault?.adapter?.request?.({
        url: `${this.baseUrl}/chat/completions`,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
      });

      if (!response) {
        // Fallback to regular fetch if requestUrl not available
        return await this.fetchWithRegularFetch(payload);
      }

      const data = JSON.parse(response);
      return data.choices[0].message.content;
    } catch (error) {
      // Fallback to regular fetch
      return await this.fetchWithRegularFetch(payload);
    }
  }

  private async fetchWithRegularFetch(payload: any): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API Error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  private getPrompt(): string {
    return `Transcribe this handwritten content into Markdown format:
1. Preserve all text and numbers exactly
2. Use LaTeX for math: inline with $...$, block with $$...$$
3. Keep document structure (headings, paragraphs, lists)
4. Output only the Markdown, no extra commentary`;
  }
}
