import type { RawCapture } from './types';

/** Converts an uploaded image file into a RawCapture (reads its dimensions). */
export async function fileToCaptureResult(file: File): Promise<RawCapture> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selected file is not an image.');
  }
  const { width, height } = await readDimensions(file);
  return { blob: file, width, height, mimeType: file.type, source: 'upload' };
}

async function readDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Could not read image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
