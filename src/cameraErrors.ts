import type { CameraError } from './types';

export function toCameraError(err: unknown): CameraError {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        code: 'permission-denied',
        message: 'Camera access was blocked. Allow camera permission or upload a file instead.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { code: 'no-camera', message: 'No camera was found on this device. Upload a file instead.' };
    default:
      return { code: 'unknown', message: 'The camera could not be started. Upload a file instead.' };
  }
}

/** Returns an error if the camera API cannot be used at all, otherwise null. */
export function checkCameraSupport(): CameraError | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return {
      code: 'insecure-context',
      message: 'The camera requires a secure (HTTPS) connection. Upload a file instead.',
    };
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { code: 'unsupported', message: 'This browser does not support camera access. Upload a file instead.' };
  }
  return null;
}
