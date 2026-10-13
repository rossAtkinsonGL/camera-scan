import jsQR from 'jsqr';
import { blurredGray, toLuma, type FrameData } from './image';

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
