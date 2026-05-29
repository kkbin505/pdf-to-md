import { ModelProvider } from './providers/base';
import { pdfToImages } from './image';

export interface ConversionOptions {
  timeout?: number;
  maxRetries?: number;
}

export interface ConversionProgress {
  current: number;
  total: number;
  status: string;
}

export class PDFConverter {
  private provider: ModelProvider;
  private timeout: number;
  private maxRetries: number;
  private progressCallback?: (progress: ConversionProgress) => void;

  constructor(provider: ModelProvider, options: ConversionOptions = {}) {
    this.provider = provider;
    this.timeout = options.timeout || 60000;
    this.maxRetries = options.maxRetries || 3;
  }

  setProgressCallback(callback: (progress: ConversionProgress) => void) {
    this.progressCallback = callback;
  }

  private emitProgress(current: number, total: number, status: string) {
    if (this.progressCallback) {
      this.progressCallback({ current, total, status });
    }
  }

  async convertPdfBuffer(pdfData: ArrayBuffer, dpi: number = 200): Promise<string> {
    try {
      this.emitProgress(0, 1, 'Extracting pages...');
      const images = await pdfToImages(pdfData, dpi);

      const results: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const progress = i / images.length;
        const status = `Recognizing page ${i + 1}/${images.length}...`;
        this.emitProgress(i, images.length, status);

        try {
          const result = await this.recognizeWithRetry(images[i], i + 1);
          results.push(result);
        } catch (error) {
          console.error(`Failed to recognize page ${i + 1}:`, error);
          results.push(`[Page ${i + 1} - Recognition failed]`);
        }
      }

      this.emitProgress(images.length, images.length, 'Combining results...');
      return results.join('\n\n---\n\n');
    } catch (error) {
      throw new Error(`Conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async recognizeWithRetry(imageBase64: string, pageNum: number): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.withTimeout(
          this.provider.recognize(imageBase64),
          this.timeout
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`Page ${pageNum} attempt ${attempt}/${this.maxRetries} failed:`, lastError.message);

        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError || new Error(`Failed to recognize page ${pageNum} after ${this.maxRetries} attempts`);
  }

  async convertImageBuffer(imageData: ArrayBuffer): Promise<string> {
    try {
      this.emitProgress(0, 1, 'Converting image...');
      const imageBase64 = await this.compressImageBuffer(imageData);
      const result = await this.recognizeWithRetry(imageBase64, 1);
      this.emitProgress(1, 1, 'Done');
      return result;
    } catch (error) {
      throw new Error(`Image conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private detectMimeType(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer, 0, 4);
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    return 'image/jpeg';
  }

  private async compressImageBuffer(buffer: ArrayBuffer): Promise<string> {
    const blob = new Blob([buffer], { type: this.detectMimeType(buffer) });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });

      const MAX_WIDTH = 2048;
      let { width, height } = img;
      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      return canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('API request timeout')), ms)
      ),
    ]);
  }
}
