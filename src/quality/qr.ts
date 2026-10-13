import jsQR from 'jsqr';
import { blurredGray, cropFrame, toLuma, type FrameData } from './image';
import { qrSearchRegions, type MarkerResult } from './markers';

function tryDecode(frame: FrameData): string | null {
  const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
  return result && result.data ? result.data : null;
}

/**
 * Decodes a QR code from an RGBA frame. Returns its text, or null if none is readable.
 * If a plain decode fails it retries with a light blur, which removes the fine line
 * patterns you get when photographing a screen.
 */
export function decodeQr(frame: FrameData): string | null {
  const plain = tryDecode(frame);
  if (plain) return plain;
  const luma = toLuma(frame);
  for (const radius of [1, 2]) {
    const decoded = tryDecode(blurredGray(luma, frame.width, frame.height, radius));
    if (decoded) return decoded;
  }
  return null;
}

export interface QrHit {
  text: string;
  /** Which detected corner is the sheet's top-left (0 = the first, clockwise). */
  rotation: 0 | 1 | 2 | 3;
}

/**
 * Finds the QR code near the sheet by cropping where it would be for each way the sheet could be
 * turned. The one that decodes tells us the text and which way up the sheet is.
 */
export function decodeQrWithRotation(frame: FrameData, corners: MarkerResult['corners']): QrHit | null {
  const regions = qrSearchRegions(corners, frame.width, frame.height);
  for (let k = 0; k < regions.length; k++) {
    const text = decodeQr(cropFrame(frame, regions[k]));
    if (text) return { text, rotation: k as QrHit['rotation'] };
  }
  return null;
}
