import { useCallback, useEffect, useRef, useState } from 'react';
import { checkCameraSupport, toCameraError } from './cameraErrors';
import type { CameraError, RawCapture } from './types';

export type FacingMode = 'environment' | 'user';
export type CameraStatus = 'idle' | 'starting' | 'ready' | 'error';

export interface UseCamera {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: CameraError | null;
  facingMode: FacingMode;
  start: (facing?: FacingMode) => Promise<void>;
  stop: () => void;
  toggleFacing: () => Promise<void>;
  capture: () => Promise<RawCapture>;
}

const JPEG_QUALITY = 0.92;

export function useCamera(initialFacing: FacingMode = 'environment'): UseCamera {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startId = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<CameraError | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>(initialFacing);

  const stop = useCallback(() => {
    startId.current++; // invalidate any in-flight start()
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const start = useCallback(
    async (facing: FacingMode = initialFacing) => {
      const unsupported = checkCameraSupport();
      if (unsupported) {
        setError(unsupported);
        setStatus('error');
        return;
      }
      const id = ++startId.current;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(null);
      setStatus('starting');
      setFacingMode(facing);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        });
        if (id !== startId.current) {
          // Stopped or restarted while waiting for permission.
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setStatus('ready');
      } catch (err) {
        if (id !== startId.current) return;
        setError(toCameraError(err));
        setStatus('error');
      }
    },
    [initialFacing],
  );

  const toggleFacing = useCallback(
    () => start(facingMode === 'environment' ? 'user' : 'environment'),
    [start, facingMode],
  );

  const capture = useCallback(async (): Promise<RawCapture> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) throw new Error('Camera is not ready.');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing context.');
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))),
        'image/jpeg',
        JPEG_QUALITY,
      ),
    );
    return { blob, width: canvas.width, height: canvas.height, mimeType: 'image/jpeg', source: 'camera' };
  }, []);

  // Release the camera when the component unmounts.
  useEffect(() => stop, [stop]);

  return { videoRef, status, error, facingMode, start, stop, toggleFacing, capture };
}
