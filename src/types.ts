import type { QualityReport } from './quality/evaluate';

/** An image straight from the camera or a file, before analysis. */
export interface RawCapture {
  /** The captured or uploaded image. */
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  /** Where the image came from. */
  source: 'camera' | 'upload';
}

export interface CaptureResult extends RawCapture {
  id: string;
  /** Text of the QR code read from the image (e.g. the sheet and student), if one was readable. */
  qr?: string;
  /** Client-side quality checks. Advisory: the server makes the final call. */
  quality?: QualityReport;
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
