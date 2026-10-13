import jsQR from 'jsqr';
import type { FrameData } from './image';

/** Decodes a QR code from an RGBA frame. Returns its text, or null if none is readable. */
export function decodeQr(frame: FrameData): string | null {
  const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
  return result && result.data ? result.data : null;
}
