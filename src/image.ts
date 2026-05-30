import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getPlatformCompressionConfig } from './utils/image-compress';

export async function pdfToImages(pdfData: ArrayBuffer, dpi: number = 200): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const images: string[] = [];
  const platformConfig = getPlatformCompressionConfig();
  const maxDimension = platformConfig.maxDimension;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1.0 });
    let scale = dpi / 72;

    let width = baseViewport.width * scale;
    let height = baseViewport.height * scale;

    if (width > maxDimension || height > maxDimension) {
      const downScale = maxDimension / Math.max(width, height);
      scale = scale * downScale;
    }

    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error(`Failed to get canvas context for page ${i}`);
    }

    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvas: canvas,
      canvasContext: context,
      viewport: viewport,
    }).promise;

    const base64 = canvas.toDataURL('image/jpeg', platformConfig.quality).split(',')[1];
    images.push(base64);
  }

  return images;
}
