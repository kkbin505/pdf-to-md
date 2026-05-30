import { Platform } from 'obsidian';

export interface CompressionConfig {
  maxDimension: number;
  quality: number;
}

export function getPlatformCompressionConfig(): CompressionConfig {
  if (Platform.isIosApp) {
    return { maxDimension: 1600, quality: 0.80 };
  } else if (Platform.isAndroidApp) {
    return { maxDimension: 2048, quality: 0.85 };
  } else {
    return { maxDimension: 2048, quality: 0.90 };
  }
}

export async function compressImage(
  arrayBuffer: ArrayBuffer,
  config: CompressionConfig
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      
      let width = img.width;
      let height = img.height;
      const maxDimension = config.maxDimension;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas 2D context'));
        return;
      }

      // Fill with white background (useful if PNG contains transparency)
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      try {
        const base64 = canvas.toDataURL('image/jpeg', config.quality).split(',')[1];
        if (!base64) {
          reject(new Error('Canvas toDataURL returned empty result'));
          return;
        }
        resolve(base64);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image into HTMLImageElement'));
    };

    img.src = url;
  });
}
