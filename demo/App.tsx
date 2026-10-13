import { useState } from 'react';
import { CameraCapture, type CaptureResult } from '../src';

const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
const single = params.has('single');
const sheetsUrl = `${import.meta.env.BASE_URL}sheets/`;

interface Shown {
  result: CaptureResult;
  url: string;
}

// Stands in for the host application: it only supplies onComplete and decides
// what to do with the images (later: upload to the processing server).
export function App() {
  const [shown, setShown] = useState<Shown[] | null>(null);

  const complete = (results: CaptureResult[]) =>
    setShown(results.map((result) => ({ result, url: URL.createObjectURL(result.blob) })));
  const reset = () => {
    shown?.forEach((s) => URL.revokeObjectURL(s.url));
    setShown(null);
  };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Document scan PoC</h1>
      {shown ? (
        <section>
          <p>
            Received {shown.length} sheet{shown.length === 1 ? '' : 's'}:
          </p>
          <ul style={{ padding: 0, listStyle: 'none', display: 'grid', gap: 16 }}>
            {shown.map(({ result, url }, i) => (
              <li key={result.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <img src={url} alt={`Sheet ${i + 1}`} style={{ width: 120, border: '1px solid #ccc' }} />
                <div style={{ fontSize: 14 }}>
                  <div>
                    <strong>{result.qr ?? 'No QR code read'}</strong>
                  </div>
                  <div>
                    {result.source}, {result.width}×{result.height}, {(result.blob.size / 1024).toFixed(0)} KB
                  </div>
                  <div style={{ color: result.quality?.ok ? '#15803d' : '#b45309' }}>
                    {result.quality?.ok ? 'Quality checks passed' : `Issues: ${result.quality?.issues.join(', ') || 'unknown'}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p>
            <button onClick={reset}>Scan more</button>
          </p>
        </section>
      ) : (
        <>
          <CameraCapture
            onComplete={complete}
            onError={(e) => console.error(e)}
            maxCaptures={single ? 1 : undefined}
            debug={debug}
          />
          <p style={{ fontSize: 14 }}>
            <a href={sheetsUrl}>Sample answer sheets</a> to point the camera at. Append <code>?debug</code> to see
            live measurements, <code>?single</code> for single-capture mode.
          </p>
        </>
      )}
    </main>
  );
}
