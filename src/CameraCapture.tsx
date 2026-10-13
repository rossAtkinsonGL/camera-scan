import { useEffect, useRef, useState } from 'react';
import { fileToCaptureResult } from './imageFile';
import { analyzeBlob } from './quality/browser';
import { ISSUE_MESSAGES, type QualityThresholds } from './quality/evaluate';
import { useCamera, type FacingMode } from './useCamera';
import { useLiveAnalysis } from './useLiveAnalysis';
import type { CaptureResult, RawCapture } from './types';
import './CameraCapture.css';

export interface CameraCaptureProps {
  /** Called when the user taps Done, with every sheet captured in this session. */
  onComplete: (results: CaptureResult[]) => void;
  /** Called if capturing or reading a file fails. */
  onError?: (error: Error) => void;
  /**
   * How many sheets this session collects. 1 = single capture: the session
   * ends on the first capture and the user confirms it. Default: unlimited.
   */
  maxCaptures?: number;
  /** Which camera to prefer. Defaults to the rear camera. */
  facingMode?: FacingMode;
  /** Show the file upload option (multiple files allowed). Defaults to true. */
  allowUpload?: boolean;
  /**
   * Take the photo automatically once the sheet is framed correctly, sharp and
   * steady. Needs expectSheet. Defaults to true.
   */
  autoCapture?: boolean;
  /** Expect an answer sheet with four corner squares and a QR code. Defaults to true. */
  expectSheet?: boolean;
  /** Override the quality thresholds. */
  qualityThresholds?: Partial<QualityThresholds>;
  /** Show the live measurements, for tuning thresholds on a device. */
  debug?: boolean;
  className?: string;
}

interface Item {
  result: CaptureResult;
  url: string;
}

/** Consecutive passing frames (about 130ms each) before auto-capture fires. */
const AUTO_TICKS = 5;
/** Consecutive failing frames before the same sheet can be auto-captured again. */
const REARM_TICKS = 3;
/** How long the "scanned" confirmation stays on screen. */
const ADDED_MS = 2200;

let idCounter = 0;
const makeId = () => `${Date.now().toString(36)}-${idCounter++}`;

export function CameraCapture({
  onComplete,
  onError,
  maxCaptures = Infinity,
  facingMode = 'environment',
  allowUpload = true,
  autoCapture = true,
  expectSheet = true,
  qualityThresholds,
  debug = false,
  className,
}: CameraCaptureProps) {
  const { videoRef, status, error, start, stop, toggleFacing, capture } = useCamera(facingMode);
  const [items, setItems] = useState<Item[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Brief confirmation after a sheet is added, shown over the camera view.
  const [added, setAdded] = useState<{ text: string; ok: boolean } | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const itemsRef = useRef(items);
  const busyRef = useRef(false);
  const armedRef = useRef(true);
  const lastQrRef = useRef<string | null>(null);
  const takePhotoRef = useRef<() => Promise<void>>(async () => undefined);
  const evalOptions = { expectSheet, thresholds: qualityThresholds };
  const evalOptionsRef = useRef(evalOptions);
  useEffect(() => {
    itemsRef.current = items;
    evalOptionsRef.current = evalOptions;
  });

  const full = items.length >= maxCaptures;
  const viewing = items.find((i) => i.result.id === viewingId) ?? (full ? items[items.length - 1] : undefined);
  const cameraWanted = !viewing;
  const ready = status === 'ready';
  const autoOn = autoCapture && expectSheet;

  // Run the camera whenever we are not reviewing a capture.
  useEffect(() => {
    if (cameraWanted) void start(facingMode);
    else stop();
  }, [cameraWanted, start, stop, facingMode]);

  // Revoke every preview URL on unmount.
  useEffect(
    () => () => {
      itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url));
      clearTimeout(addedTimer.current);
    },
    [],
  );

  const live = useLiveAnalysis(videoRef, cameraWanted && ready, evalOptions);

  const fail = (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    setMessage(e.message);
    onError?.(e);
  };

  const finalize = async (raw: RawCapture): Promise<CaptureResult> => {
    const analysis = await analyzeBlob(raw.blob, evalOptionsRef.current);
    return { ...raw, id: makeId(), qr: analysis?.qr ?? undefined, quality: analysis?.quality };
  };

  const addItem = (result: CaptureResult) => {
    if (itemsRef.current.length >= maxCaptures) return;
    const item = { result, url: URL.createObjectURL(result.blob) };
    itemsRef.current = [...itemsRef.current, item];
    setItems(itemsRef.current);
    confirmAdded(result, itemsRef.current.length);
  };

  const confirmAdded = (result: CaptureResult, count: number) => {
    const issue = result.quality && !result.quality.ok ? result.quality.issues[0] : undefined;
    setAdded({
      text: issue
        ? `Added, but check it: ${ISSUE_MESSAGES[issue]}`
        : `Scanned ✓ ${result.qr ?? 'sheet'} (${count} captured)`,
      ok: !issue,
    });
    clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(null), ADDED_MS);
    try {
      navigator.vibrate?.(60); // a small buzz on phones that support it
    } catch {
      // not available; the on-screen message is enough
    }
  };

  const removeItem = (id: string) => {
    const gone = itemsRef.current.find((i) => i.result.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    itemsRef.current = itemsRef.current.filter((i) => i.result.id !== id);
    setItems(itemsRef.current);
    setViewingId(null);
    // Let the camera auto-capture the sheet again after a retake.
    armedRef.current = true;
    lastQrRef.current = null;
  };

  const takePhoto = async () => {
    if (busyRef.current || itemsRef.current.length >= maxCaptures) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      addItem(await finalize(await capture()));
    } catch (err) {
      fail(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    takePhotoRef.current = takePhoto;
  });

  // Auto-capture: fire after N consecutive good frames, then wait for the sheet to be
  // taken away (or a different QR code to appear) before arming again. A sheet whose QR
  // code is already in this session is never captured automatically (the guide says so).
  useEffect(() => {
    if (!autoOn || !cameraWanted || !ready) return;
    if (live.qr && itemsRef.current.some((i) => i.result.qr === live.qr)) return;
    if (live.notReadyTicks >= REARM_TICKS) armedRef.current = true;
    if (live.qr && live.qr !== lastQrRef.current) armedRef.current = true;
    if (armedRef.current && live.readyTicks >= AUTO_TICKS) {
      armedRef.current = false;
      lastQrRef.current = live.qr;
      void takePhotoRef.current();
    }
  }, [live, autoOn, cameraWanted, ready]);

  const onFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow choosing the same files again
    if (files.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const room = maxCaptures - itemsRef.current.length;
    const problems: string[] = [];
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        addItem(await finalize(await fileToCaptureResult(file)));
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : 'could not be read'}`);
      }
    }
    if (files.length > room) problems.push(`Only ${Math.max(0, room)} more could be added.`);
    busyRef.current = false;
    setBusy(false);
    if (problems.length) fail(new Error(problems.join(' ')));
  };

  const rootClass = ['cs-root', className].filter(Boolean).join(' ');
  const done = (
    <button
      type="button"
      className="cs-btn cs-btn-primary"
      disabled={items.length === 0 || busy}
      onClick={() => onComplete(items.map((i) => i.result))}
    >
      {maxCaptures === 1 ? 'Use photo' : `Done (${items.length})`}
    </button>
  );

  // The sheet in view has already been captured in this session.
  const duplicate = !!live.qr && items.some((i) => i.result.qr === live.qr);

  const tray = items.length > 0 && maxCaptures !== 1 && (
    <ul className="cs-tray" aria-label="Captured sheets">
      {items.map((item, index) => (
        <li key={item.result.id}>
          <button
            type="button"
            className={`cs-thumb ${item.result.quality?.ok ? 'cs-thumb-ok' : 'cs-thumb-warn'}${
              duplicate && item.result.qr === live.qr ? ' cs-thumb-match' : ''
            }`}
            onClick={() => setViewingId(item.result.id)}
            aria-label={`Sheet ${index + 1}${item.result.qr ? `, ${item.result.qr}` : ''}, ${
              item.result.quality?.ok ? 'passed checks' : 'has warnings'
            }`}
          >
            <img src={item.url} alt="" />
            <span className="cs-badge">{item.result.quality?.ok ? '✓' : '!'}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  if (viewing) {
    const q = viewing.result.quality;
    return (
      <div className={rootClass}>
        <div className="cs-stage">
          <img className="cs-media" src={viewing.url} alt="Captured sheet preview" />
        </div>
        <div className="cs-info">
          {viewing.result.qr && <p className="cs-chip">QR: {viewing.result.qr}</p>}
          {q && !q.ok && (
            <ul className="cs-issues">
              {q.issues.map((issue) => (
                <li key={issue}>{ISSUE_MESSAGES[issue]}</li>
              ))}
            </ul>
          )}
          {q?.ok && <p className="cs-ok">All quality checks passed.</p>}
        </div>
        {tray}
        <div className="cs-actions">
          {full ? null : (
            <button type="button" className="cs-btn" onClick={() => setViewingId(null)}>
              Back to camera
            </button>
          )}
          <button type="button" className="cs-btn" onClick={() => removeItem(viewing.result.id)}>
            {full && maxCaptures === 1 ? 'Retake' : 'Remove'}
          </button>
          {done}
        </div>
      </div>
    );
  }

  const report = live.report;
  const markers = report?.metrics.markers;
  // What to tell the user, most urgent first.
  const guide = !ready
    ? null
    : added
      ? added.text
      : busy
        ? 'Scanning…'
        : duplicate
          ? `Already scanned: ${live.qr}. Show a different sheet, or remove it below to scan it again.`
          : !report
            ? 'Looking for the sheet…'
            : report.ok
              ? autoOn
                ? 'Hold steady…'
                : 'Ready'
              : ISSUE_MESSAGES[report.issues[0]];
  const quiet = !!added || busy || duplicate;
  const progress = autoOn && report?.ok && !quiet ? Math.min(1, live.readyTicks / AUTO_TICKS) : 0;
  const stageState = !(expectSheet && ready)
    ? ''
    : added
      ? added.ok
        ? 'ok'
        : 'warn'
      : duplicate
        ? 'dup'
        : report?.ok
          ? 'ok'
          : 'warn';

  return (
    <div className={rootClass}>
      <div className={`cs-stage ${stageState ? `cs-stage-${stageState}` : ''}`}>
        {/* playsInline + muted are required for inline playback on iOS Safari */}
        <video ref={videoRef} className="cs-media" playsInline muted autoPlay hidden={status === 'error'} />
        {markers && live.frame && (
          <svg
            className="cs-overlay-svg"
            viewBox={`0 0 ${live.frame.width} ${live.frame.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <polygon
              className={`cs-quad cs-quad-${stageState || 'warn'}`}
              points={markers.corners.map((p) => `${p.x},${p.y}`).join(' ')}
            />
          </svg>
        )}
        {status === 'starting' && <p className="cs-overlay">Starting camera…</p>}
        {status === 'error' && error && (
          <p className="cs-overlay" role="alert">
            {error.message}
          </p>
        )}
        {guide && expectSheet && (
          <p className={`cs-guide ${added ? (added.ok ? 'cs-guide-ok' : '') : duplicate ? 'cs-guide-dup' : report?.ok ? 'cs-guide-ok' : ''}`} role="status">
            {guide}
          </p>
        )}
        {progress > 0 && <div className="cs-progress" style={{ width: `${progress * 100}%` }} />}
        {live.qr && <p className="cs-qr-chip">QR: {live.qr}</p>}
        {debug && report && (
          <pre className="cs-debug">
            {[
              `sharp ${report.metrics.sharpness.toFixed(0)}`,
              `bright ${report.metrics.brightness.toFixed(0)}`,
              `glare ${(report.metrics.glare * 100).toFixed(1)}%`,
              `motion ${report.metrics.motion?.toFixed(1) ?? '-'}`,
              `area ${markers ? (markers.areaFraction * 100).toFixed(0) + '%' : '-'}`,
              `skew ${markers ? markers.skew.toFixed(2) : '-'}`,
              `ready ${live.readyTicks}`,
            ].join('\n')}
          </pre>
        )}
      </div>
      {message && (
        <p className="cs-message" role="alert">
          {message}
        </p>
      )}
      {tray}
      <div className="cs-actions">
        {allowUpload && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple={maxCaptures !== 1}
              hidden
              onChange={onFilesChosen}
            />
            <button type="button" className="cs-btn" disabled={busy} onClick={() => fileInput.current?.click()}>
              {maxCaptures === 1 ? 'Upload file' : 'Upload files'}
            </button>
          </>
        )}
        {ready && (
          <button type="button" className="cs-btn" onClick={() => void toggleFacing()}>
            Switch camera
          </button>
        )}
        <button type="button" className="cs-btn" disabled={!ready || busy} onClick={() => void takePhoto()}>
          Take photo
        </button>
        {maxCaptures !== 1 && done}
      </div>
    </div>
  );
}
