import type { QualityReport } from './quality/evaluate';
import type { SheetReading } from './mock-backend/omr';

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
  /** The answers read from the filled-in bubbles, when the sheet and its QR code were recognised. */
  reading?: SheetReading;
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
