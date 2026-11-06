/**
 * Client-side canvas image resizer.
 * Resizes receipts to max 1400px on the longest dimension, compressed as JPEG 0.85.
 * This ensures fast, lightweight uploads from mobile devices.
 */

export interface ResizedImageResult {
  base64: string; // Pure base64 without "data:image/jpeg;base64," prefix for API
  dataUrl: string; // Full data URL for inline previews in the UI
  mimeType: 'image/jpeg';
  originalSize: number;
  resizedSize: number;
  width: number;
  height: number;
  fileName: string;
}

export async function resizeImageForUpload(
  file: File,
  maxDimension: number = 1400,
  quality: number = 0.85
): Promise<ResizedImageResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // Calculate proportional scale
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
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }

        // Fill background with white in case of transparent PNG screenshots
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // Smooth image rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

        // Estimate resized byte size
        const head = 'data:image/jpeg;base64,';
        const byteLength = Math.round(((dataUrl.length - head.length) * 3) / 4);

        resolve({
          base64,
          dataUrl,
          mimeType: 'image/jpeg',
          originalSize: file.size,
          resizedSize: byteLength,
          width,
          height,
          fileName: file.name,
        });
      };

      img.onerror = () => {
        reject(new Error(`Failed to load image: ${file.name}`));
      };

      if (e.target?.result) {
        img.src = e.target.result as string;
      } else {
        reject(new Error('Failed to read file data'));
      }
    };

    reader.onerror = () => {
      reject(new Error(`File reading error: ${file.name}`));
    };

    reader.readAsDataURL(file);
  });
}
