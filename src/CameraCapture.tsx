import { useEffect, useRef, useState } from 'react';
import { fileToCaptureResult } from './imageFile';
import { useCamera, type FacingMode } from './useCamera';
import type { CaptureResult } from './types';
import './CameraCapture.css';

export interface CameraCaptureProps {
  /** Called when the user accepts a photo ("Use photo"). */
  onCapture: (result: CaptureResult) => void;
  /** Called if capturing or reading a file fails. */
  onError?: (error: Error) => void;
  /** Which camera to prefer. Defaults to the rear camera. */
  facingMode?: FacingMode;
  /** Show the file upload option. Defaults to true. */
  allowUpload?: boolean;
  className?: string;
}

export function CameraCapture({
  onCapture,
  onError,
  facingMode = 'environment',
  allowUpload = true,
  className,
}: Readonly<CameraCaptureProps>) {
  const { videoRef, status, error, start, stop, toggleFacing, capture } = useCamera(facingMode);
  // The preview object URL is created with the capture and revoked when it is discarded.
  const [review, setReview] = useState<{ result: CaptureResult; url: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reviewRef = useRef(review);
  useEffect(() => {
    reviewRef.current = review;
  }, [review]);

  // Start the camera on mount, and again whenever we return from review.
  useEffect(() => {
    if (!review) void start(facingMode);
  }, [review, start, facingMode]);

  // Revoke any outstanding preview URL on unmount.
  useEffect(
    () => () => {
      if (reviewRef.current) URL.revokeObjectURL(reviewRef.current.url);
    },
    [],
  );

  const showReview = (result: CaptureResult) => {
    stop();
    setReview({ result, url: URL.createObjectURL(result.blob) });
  };

  const retake = () => {
    if (review) URL.revokeObjectURL(review.url);
    setReview(null);
  };

  const fail = (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    setMessage(e.message);
    onError?.(e);
  };

  const takePhoto = async () => {
    setMessage(null);
    try {
      showReview(await capture());
    } catch (err) {
      fail(err);
    }
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    setMessage(null);
    try {
      showReview(await fileToCaptureResult(file));
    } catch (err) {
      fail(err);
    }
  };

  const rootClass = ['cs-root', className].filter(Boolean).join(' ');

  if (review) {
    return (
      <div className={rootClass}>
        <div className="cs-stage">
          <img className="cs-media" src={review.url} alt="Captured document preview" />
        </div>
        <div className="cs-actions">
          <button type="button" className="cs-btn" onClick={retake}>
            Retake
          </button>
          <button type="button" className="cs-btn cs-btn-primary" onClick={() => onCapture(review.result)}>
            Use photo
          </button>
        </div>
      </div>
    );
  }

  const ready = status === 'ready';
  return (
    <div className={rootClass}>
      <div className="cs-stage">
        {/* playsInline + muted are required for inline playback on iOS Safari */}
        <video ref={videoRef} className="cs-media" playsInline muted autoPlay hidden={status === 'error'} />
        {status === 'starting' && <p className="cs-overlay">Starting camera…</p>}
        {status === 'error' && error && (
          <p className="cs-overlay" role="alert">
            {error.message}
          </p>
        )}
      </div>
      {message && (
        <p className="cs-message" role="alert">
          {message}
        </p>
      )}
      <div className="cs-actions">
        {allowUpload && (
          <>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFileChosen} />
            <button type="button" className="cs-btn" onClick={() => fileInput.current?.click()}>
              Upload file
            </button>
          </>
        )}
        {ready && (
          <button type="button" className="cs-btn" onClick={() => void toggleFacing()}>
            Switch camera
          </button>
        )}
        <button type="button" className="cs-btn cs-btn-primary" disabled={!ready} onClick={() => void takePhoto()}>
          Take photo
        </button>
      </div>
    </div>
  );
}
