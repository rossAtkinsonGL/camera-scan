export interface CaptureResult {
  /** The captured or uploaded image. */
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  /** Where the image came from. */
  source: 'camera' | 'upload';
}

export type CameraErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-camera'
  | 'unknown';

export interface CameraError {
  code: CameraErrorCode;
  message: string;
}
