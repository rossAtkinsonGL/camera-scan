import { useState } from 'react';
import { CameraCapture, type CaptureResult } from '../src';

// Stands in for the host application: it only supplies onCapture and decides
// what to do with the image (later: upload to the processing server).
export function App() {
  const [accepted, setAccepted] = useState<{ result: CaptureResult; url: string } | null>(null);

  const accept = (result: CaptureResult) => setAccepted({ result, url: URL.createObjectURL(result.blob) });
  const reset = () => {
    if (accepted) URL.revokeObjectURL(accepted.url);
    setAccepted(null);
  };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Document scan PoC</h1>
      {accepted ? (
        <section>
          <p>
            Accepted {accepted.result.source} image: {accepted.result.width}×{accepted.result.height},{' '}
            {accepted.result.mimeType}, {(accepted.result.blob.size / 1024).toFixed(0)} KB
          </p>
          <img src={accepted.url} alt="Accepted scan" style={{ maxWidth: '100%', maxHeight: '60vh' }} />
          <p>
            <button onClick={reset}>Scan another</button>
          </p>
        </section>
      ) : (
        <CameraCapture onCapture={accept} onError={(e) => console.error(e)} />
      )}
    </main>
  );
}
