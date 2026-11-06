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

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for OCR'));
    img.src = src;
  });
}

// OCR reads small glyphs better when they are enlarged, but mobile canvases
// must stay bounded, so scale-up is capped by a total-pixel budget.
const OCR_TARGET_WIDTH = 1600;
const OCR_MAX_PIXELS = 5_000_000;

/**
 * Prepares a (already resized) receipt image for on-device OCR.
 *
 * Tesseract is trained on dark text over a light background, so white-on-dark
 * receipts (e.g. dark-themed banking apps) are a common source of misread
 * digits. This normalises the image: grayscale, invert when the shot is
 * predominantly dark, and enlarge small text. Returns a data URL, or the input
 * unchanged if the browser cannot run the pixel pipeline.
 */
export async function preprocessImageForOcr(
  dataUrl: string,
  targetWidth: number = OCR_TARGET_WIDTH
): Promise<string> {
  try {
    const img = await loadImageElement(dataUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) return dataUrl;

    let scale = Math.min(2.2, Math.max(1, targetWidth / srcW));
    if (srcW * srcH * scale * scale > OCR_MAX_PIXELS) {
      scale = Math.sqrt(OCR_MAX_PIXELS / (srcW * srcH));
    }
    if (scale <= 0) return dataUrl;

    const width = Math.round(srcW * scale);
    const height = Math.round(srcH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Rec.601 luma mean, so we can detect a dark background before converting.
    const pixels = width * height;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    const invert = sum / pixels < 128;

    for (let i = 0; i < data.length; i += 4) {
      let g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      if (invert) g = 255 - g;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    // PNG is lossless — the extra bytes are local-only and help the OCR.
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
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
