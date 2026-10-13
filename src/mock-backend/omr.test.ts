import { describe, expect, it } from 'vitest';
import { toLuma, type FrameData } from '../quality/image';
import { detectMarkers } from '../quality/markers';
import { parseSheetPayload, readAnswers, toScorableResponse, type SheetReading } from './omr';
import { decodeQrWithRotation } from '../quality/qr';
import { mockAnswers, sheetPayload } from '../quality/sheetLayout';
import { renderSheet } from '../quality/testing/syntheticSheet';

const LETTERS = ['A', 'B', 'C', 'D'];
const payload = sheetPayload('MATH-U3', 'A', 'S001');
const FRAME = { width: 480, height: 640, scale: 1.45 };

function read(frame: FrameData): SheetReading | null {
  const markers = detectMarkers(toLuma(frame), frame.width, frame.height);
  if (!markers) return null;
  const hit = decodeQrWithRotation(frame, markers.corners);
  if (!hit) return null;
  return readAnswers(frame, markers.corners, hit.rotation, hit.text);
}

const expected = mockAnswers(payload).map((o) => LETTERS[o]);

describe('reading the answers', () => {
  const cases: [string, Partial<Parameters<typeof renderSheet>[0]>][] = [
    ['upright', {}],
    ['turned 90 degrees', { rotate90: true }],
    ['upside down', { rotateDeg: 180 }],
    ['turned by hand', { rotateDeg: 15 }],
    ['from a tilted camera', { keystone: 0.2 }],
  ];
  for (const [name, opts] of cases) {
    it(`gets every answer right, ${name}`, () => {
      const reading = read(renderSheet({ ...FRAME, payload, ...opts }));
      expect(reading).not.toBeNull();
      expect(reading!.answers.map((a) => a.answer)).toEqual(expected);
      expect(reading!.summary).toEqual({ answered: 20, blank: 0, multiple: 0, unclear: 0 });
      expect(reading!.sheet).toEqual({ raw: payload, assessment: 'MATH-U3', form: 'A', student: 'S001' });
    });
  }

  it('reports blanks and double marks instead of guessing', () => {
    const answers = mockAnswers(payload).map((o) => [o]);
    answers[2] = []; // question 3 left blank
    answers[6] = [0, 2]; // question 7 marked twice
    const reading = read(renderSheet({ ...FRAME, payload, answers }))!;
    expect(reading.answers[2]).toMatchObject({ question: 3, answer: null, status: 'blank' });
    expect(reading.answers[6]).toMatchObject({ question: 7, answer: null, status: 'multiple', marked: ['A', 'C'] });
    expect(reading.answers[0].status).toBe('answered');
    expect(reading.summary).toEqual({ answered: 18, blank: 1, multiple: 1, unclear: 0 });
  });

  it('gives low confidence to a blank that is not really blank', () => {
    const answers = mockAnswers(payload).map((o) => [o]);
    const clean = read(renderSheet({ ...FRAME, payload, answers }))!;
    expect(clean.answers.every((a) => a.confidence > 0.7)).toBe(true);
  });

  it('produces the plain scorable output', () => {
    const reading = read(renderSheet({ ...FRAME, payload }))!;
    const out = toScorableResponse(reading);
    expect(out.student).toBe('S001');
    expect(out.responses).toHaveLength(20);
    expect(out.responses[0]).toEqual({ question: 1, answer: expected[0] });
  });

  it('copes with a QR code that is not in our format', () => {
    expect(parseSheetPayload('hello')).toEqual({ raw: 'hello' });
    expect(parseSheetPayload('CS1|A|B|C')).toEqual({ raw: 'CS1|A|B|C', assessment: 'A', form: 'B', student: 'C' });
  });
});
