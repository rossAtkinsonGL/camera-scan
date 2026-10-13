import { evaluate, measure, type EvaluateOptions, type QualityReport } from './evaluate';
import { toLuma, type FrameData } from './image';
import { detectMarkers, qrSearchRegions, type MarkerResult } from './markers';
import { readAnswers, type SheetReading } from '../mock-backend/omr';
import { decodeQr, type QrHit } from './qr';

/** Longest side of the frame used for sharpness, brightness and marker checks. */
export const ANALYSIS_SIZE = 640;
/** Longest side of a full-frame QR decode, used when no sheet outline was found. */
export const QR_SIZE = 1600;
/** Longest side of a cropped QR decode. Crops are taken at the camera's native resolution. */
const QR_CROP_MAX = 700;
/** Longest side of the copy the bubbles are read from. */
const READ_SIZE = 1600;

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

/**
 * Reads the sheet's QR code by cropping where it should be (from the sheet outline) out of the
 * full-resolution source, instead of decoding a shrunken copy of the whole frame. Tries every
 * way up the sheet could be, and reports which one worked. Marker coordinates are in the
 * analysed frame (fw x fh).
 */
export function decodeQrNearSheet(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  markers: MarkerResult,
  fw: number,
  fh: number,
  canvas: HTMLCanvasElement,
): QrHit | null {
  const kx = sourceWidth / fw;
  const ky = sourceHeight / fh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const regions = qrSearchRegions(markers.corners, fw, fh);
  for (let k = 0; k < regions.length; k++) {
    const r = regions[k];
    const sx = r.x0 * kx;
    const sy = r.y0 * ky;
    const sw = (r.x1 - r.x0) * kx;
    const sh = (r.y1 - r.y0) * ky;
    if (sw < 16 || sh < 16) continue;
    const scale = Math.min(1, QR_CROP_MAX / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const text = decodeQr(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (text) return { text, rotation: k as QrHit['rotation'] };
  }
  return null;
}

export interface StillAnalysis {
  quality: QualityReport;
  /** QR payload read from the image, if any. */
  qr: string | null;
  /** The answers read from the bubbles. Only when requested, and the sheet and its QR code were found. */
  reading?: SheetReading;
}

export interface AnalyzeOptions extends EvaluateOptions {
  /** Also read the filled-in bubbles. Needs the sheet outline and QR code. Default false. */
  readAnswers?: boolean;
}

/** Analyses a captured or uploaded image. Resolves to null if it cannot be decoded. */
export async function analyzeBlob(blob: Blob, options: AnalyzeOptions = {}): Promise<StillAnalysis | null> {
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
    const hit = markers
      ? decodeQrNearSheet(bitmap, bitmap.width, bitmap.height, markers, small.width, small.height, createCanvas())
      : null;
    let qr = hit?.text ?? null;
    if (!qr) {
      const large = grabFrame(bitmap, bitmap.width, bitmap.height, QR_SIZE, canvas);
      qr = large ? decodeQr(large) : null;
    }
    const quality = evaluate(measure({ luma, width: small.width, height: small.height, markers, qr }), options);

    let reading: SheetReading | undefined;
    if (options.readAnswers && markers && hit) {
      // Bubbles are small, so read them from a higher-resolution copy than the one used to find the sheet.
      const large = grabFrame(bitmap, bitmap.width, bitmap.height, READ_SIZE, canvas);
      if (large) {
        const k = large.width / small.width;
        const corners = markers.corners.map((p) => ({ x: p.x * k, y: p.y * k })) as MarkerResult['corners'];
        reading = readAnswers(large, corners, hit.rotation, hit.text) ?? undefined;
      }
    }
    return { quality, qr, reading };
  } finally {
    bitmap.close();
  }
}
