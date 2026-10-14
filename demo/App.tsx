import { useState } from 'react';
import { CameraCapture, toScorableResponse, type AnswerRead, type CaptureResult, type SheetReading } from '../src';
import { mockAnswers } from '../src/quality/sheetLayout';

const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
const single = params.has('single');
const sheetsUrl = `${import.meta.env.BASE_URL}sheets/`;
const LETTERS = ['A', 'B', 'C', 'D'];

interface Shown {
  result: CaptureResult;
  url: string;
}

/**
 * Only the mock sheets have a known right answer: their filled bubbles come from a formula seeded
 * with the QR text. This is a demo-only check that the reader got every bubble right.
 */
function checkAgainstMock(reading: SheetReading) {
  if (!reading.sheet.raw.startsWith('CS1|')) return null;
  const expected = mockAnswers(reading.sheet.raw).map((o) => LETTERS[o]);
  const wrong = reading.answers.filter((a, i) => a.answer !== expected[i]);
  return { total: expected.length, wrong: wrong.map((a) => a.question), expected };
}

/** What a chip says: the letter, or why there isn't one. */
function chipLabel(a: AnswerRead): { text: string; tone: 'ok' | 'quiet' | 'warn' } {
  if (a.answer) return { text: a.answer, tone: 'ok' };
  if (a.status === 'multiple') return { text: a.marked.join('+'), tone: 'warn' };
  if (a.status === 'unclear') return { text: 'faint?', tone: 'warn' };
  return { text: 'blank', tone: 'quiet' };
}

const TONES = {
  ok: { border: '#9ca3af', background: '#f3f4f6', color: '#111' },
  quiet: { border: '#d1d5db', background: '#f9fafb', color: '#6b7280' },
  warn: { border: '#b45309', background: '#fef3c7', color: '#92400e' },
  bad: { border: '#b91c1c', background: '#fee2e2', color: '#111' },
};

function Reading({ reading, compare }: { reading: SheetReading; compare: boolean }) {
  const check = compare ? checkAgainstMock(reading) : null;
  const json = JSON.stringify(toScorableResponse(reading), null, 2);
  const { summary } = reading;
  return (
    <div style={{ fontSize: 13, marginTop: 8 }}>
      <p style={{ margin: '4px 0' }}>
        {summary.answered} answered, {summary.blank} blank
        {summary.unclear > 0 && <strong style={{ color: TONES.warn.color }}>, {summary.unclear} unclear (faint mark)</strong>}
        {summary.multiple > 0 && <strong style={{ color: TONES.warn.color }}>, {summary.multiple} with more than one mark</strong>}
      </p>
      {check && (
        <p style={{ margin: '4px 0', fontWeight: 600, color: check.wrong.length === 0 ? '#15803d' : '#b91c1c' }}>
          {check.wrong.length === 0
            ? `Mock-sheet check: all ${check.total} answers match the known answers`
            : `Mock-sheet check: ${check.total - check.wrong.length} of ${check.total} match (wrong: Q${check.wrong.join(', Q')})`}
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 4, maxWidth: 420 }}>
        {reading.answers.map((a, i) => {
          const label = chipLabel(a);
          const tone = check && a.answer !== check.expected[i] ? TONES.bad : TONES[label.tone];
          return (
            <span
              key={a.question}
              title={`${a.status}, confidence ${a.confidence.toFixed(2)}${a.marked.length ? `, marked ${a.marked.join('')}` : ''}`}
              style={{
                padding: '2px 6px',
                border: `1px solid ${tone.border}`,
                background: tone.background,
                color: tone.color,
                borderRadius: 4,
              }}
            >
              {a.question}: {label.tone === 'ok' ? <strong>{label.text}</strong> : label.text}
            </span>
          );
        })}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary>Scorable output (JSON)</summary>
        <pre style={{ background: '#f3f4f6', padding: 8, overflow: 'auto', maxHeight: 220 }}>{json}</pre>
      </details>
    </div>
  );
}

function downloadJson(shown: Shown[]) {
  const sheets = shown.flatMap((s) => (s.result.reading ? [toScorableResponse(s.result.reading)] : []));
  const url = URL.createObjectURL(new Blob([JSON.stringify({ sheets }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scan-results.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Stands in for the host application: it only supplies onComplete and decides
// what to do with the results (later: send them to the scoring service).
export function App() {
  const [shown, setShown] = useState<Shown[] | null>(null);
  const [compare, setCompare] = useState(false);

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
          <label style={{ display: 'block', fontSize: 14, marginBottom: 12 }}>
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with the
            mock sheets&apos; known answers (only for the pre-filled sheets, not hand-marked ones)
          </label>
          <ul style={{ padding: 0, listStyle: 'none', display: 'grid', gap: 20 }}>
            {shown.map(({ result, url }, i) => (
              <li key={result.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <img src={url} alt={`Sheet ${i + 1}`} style={{ width: 120, border: '1px solid #ccc' }} />
                <div style={{ fontSize: 14, minWidth: 0 }}>
                  <div>
                    <strong>{result.qr ?? 'No QR code read'}</strong>
                  </div>
                  <div>
                    {result.source}, {result.width}×{result.height}, {(result.blob.size / 1024).toFixed(0)} KB
                  </div>
                  <div style={{ color: result.quality?.ok ? '#15803d' : '#b45309' }}>
                    {result.quality?.ok
                      ? 'Quality checks passed'
                      : `Issues: ${result.quality?.issues.join(', ') || 'unknown'}`}
                  </div>
                  {result.reading ? (
                    <Reading reading={result.reading} compare={compare} />
                  ) : (
                    <div style={{ color: '#b45309' }}>No answers read (sheet outline or QR code not recognised)</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset}>Scan more</button>
            <button onClick={() => downloadJson(shown)} disabled={!shown.some((s) => s.result.reading)}>
              Download all as JSON
            </button>
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
