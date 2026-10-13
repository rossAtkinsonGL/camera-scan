import { evaluate, measure, type EvaluateOptions, type QualityReport } from './evaluate';
import { toLuma, type FrameData } from './image';
import { detectMarkers } from './markers';
import { decodeQr } from './qr';

/** Longest side of the frame used for sharpness, brightness and marker checks. */
export const ANALYSIS_SIZE = 640;
/** Longest side of the frame used for QR decoding (QR modules need more pixels). */
export const QR_SIZE = 1280;

export function createCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

/** Draws a source into a canvas scaled so its longest side is at most maxDim, and reads the pixels. */
export function grabFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxDim: number,
  canvas: HTMLCanvasElement,
): FrameData | null {
  if (sourceWidth === 0 || sourceHeight === 0) return null;
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export interface StillAnalysis {
  quality: QualityReport;
  /** QR payload read from the image, if any. */
  qr: string | null;
}

/** Analyses a captured or uploaded image. Resolves to null if it cannot be decoded. */
export async function analyzeBlob(blob: Blob, options: EvaluateOptions = {}): Promise<StillAnalysis | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const canvas = createCanvas();
    const small = grabFrame(bitmap, bitmap.width, bitmap.height, ANALYSIS_SIZE, canvas);
    if (!small) return null;
    const luma = toLuma(small);
    const markers = detectMarkers(luma, small.width, small.height);
    const large = grabFrame(bitmap, bitmap.width, bitmap.height, Math.max(QR_SIZE, ANALYSIS_SIZE), canvas);
    const qr = large ? decodeQr(large) : null;
    const quality = evaluate(measure({ luma, width: small.width, height: small.height, markers, qr }), options);
    return { quality, qr };
  } finally {
    bitmap.close();
  }
}
