import { useEffect, useRef, useState } from 'react';
import { ANALYSIS_SIZE, QR_SIZE, createCanvas, grabFrame } from './quality/browser';
import { evaluate, measure, type EvaluateOptions, type QualityReport } from './quality/evaluate';
import { frameDifference, toLuma } from './quality/image';
import { detectMarkers } from './quality/markers';
import { decodeQr } from './quality/qr';

export interface LiveAnalysis {
  report: QualityReport | null;
  /** Size of the analysed frame, for mapping marker coordinates onto the video. */
  frame: { width: number; height: number } | null;
  /** Latest QR payload, held briefly after it was last seen. */
  qr: string | null;
  /** Consecutive analysed frames that passed every check. */
  readyTicks: number;
  /** Consecutive analysed frames that failed at least one check. */
  notReadyTicks: number;
}

const EMPTY: LiveAnalysis = { report: null, frame: null, qr: null, readyTicks: 0, notReadyTicks: 0 };

const TICK_MS = 130;
const QR_EVERY_N_TICKS = 3;
const QR_HOLD_MS = 1500;

/**
 * Analyses the live video about 7 times a second: sheet markers, QR code,
 * sharpness, brightness, glare and steadiness.
 */
export function useLiveAnalysis(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  options: EvaluateOptions,
): LiveAnalysis {
  const [state, setState] = useState<LiveAnalysis>(EMPTY);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!enabled) return;
    const small = createCanvas();
    const large = createCanvas();
    let previousLuma: Uint8Array | null = null;
    let tick = 0;
    let qr: string | null = null;
    let qrSeenAt = 0;
    let ready = 0;
    let notReady = 0;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const frame = grabFrame(video, video.videoWidth, video.videoHeight, ANALYSIS_SIZE, small);
        if (frame) {
          const luma = toLuma(frame);
          const motion =
            previousLuma && previousLuma.length === luma.length ? frameDifference(previousLuma, luma) : undefined;
          previousLuma = luma;
          const markers = detectMarkers(luma, frame.width, frame.height);

          // QR decoding is the most expensive step, so only try now and then, and only once the sheet is in view.
          if (markers && tick % QR_EVERY_N_TICKS === 0) {
            const big = grabFrame(video, video.videoWidth, video.videoHeight, QR_SIZE, large);
            const decoded = big ? decodeQr(big) : null;
            if (decoded) {
              qr = decoded;
              qrSeenAt = performance.now();
            }
          }
          if (qr && performance.now() - qrSeenAt > QR_HOLD_MS) qr = null;
          tick++;

          const report = evaluate(
            measure({ luma, width: frame.width, height: frame.height, markers, qr, motion }),
            optionsRef.current,
          );
          ready = report.ok ? ready + 1 : 0;
          notReady = report.ok ? 0 : notReady + 1;
          setState({ report, frame: { width: frame.width, height: frame.height }, qr, readyTicks: ready, notReadyTicks: notReady });
        }
      }
      timer = setTimeout(step, TICK_MS);
    };
    timer = setTimeout(step, TICK_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setState(EMPTY);
    };
  }, [enabled, videoRef]);

  return state;
}
