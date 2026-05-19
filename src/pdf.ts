import * as pdfjsLib from 'pdfjs-dist';

export async function pdfToImages(pdfData: ArrayBuffer, dpi: number = 200): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const images: string[] = [];
  const scale = dpi / 72;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error(`Failed to get canvas context for page ${i}`);
    }

    await page.render({
      canvas: canvas,
      canvasContext: context,
      viewport: viewport,
    }).promise;

    const base64 = canvas.toDataURL('image/png').split(',')[1];
    images.push(base64);
  }

  return images;
}
