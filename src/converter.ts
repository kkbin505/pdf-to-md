import { ModelProvider } from './providers/base';
import { pdfToImages } from './image';
import { compressImage, getPlatformCompressionConfig } from './utils/image-compress';

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
      
      let imageBase64: string;
      try {
        const platformConfig = getPlatformCompressionConfig();
        imageBase64 = await compressImage(imageData, platformConfig);
      } catch (compressError) {
        console.warn('Canvas image compression failed, falling back to raw base64:', compressError);
        imageBase64 = this.arrayBufferToBase64(imageData);
      }

      const result = await this.recognizeWithRetry(imageBase64, 1);
      this.emitProgress(1, 1, 'Done');
      return result;
    } catch (error) {
      throw new Error(`Image conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, sub as any);
    }
    return btoa(binary);
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
