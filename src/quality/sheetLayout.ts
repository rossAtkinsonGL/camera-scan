/**
 * Reference answer sheet geometry (A4 portrait, millimetres).
 *
 * The detector looks for four L-shaped corner brackets and a QR code. These
 * numbers describe the mock sheets we generate; real printed sheets only need
 * to follow the same rules: one solid black L bracket in each page corner
 * (the L's outer corner pointing at the page corner), all the same size, with
 * arms at least 3mm thick, plus a QR code with a quiet zone.
 */
export const SHEET = {
  width: 210,
  height: 297,
  bracket: { arm: 14, thickness: 3, inset: 10 },
  qr: { x: 136, y: 12, size: 46 },
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The two rectangles that make up each corner bracket, in order TL, TR, BL, BR. */
export function bracketRects(): Rect[][] {
  const { arm, thickness: t, inset } = SHEET.bracket;
  const left = inset;
  const right = SHEET.width - inset;
  const top = inset;
  const bottom = SHEET.height - inset;
  return [
    [{ x: left, y: top, w: arm, h: t }, { x: left, y: top, w: t, h: arm }],
    [{ x: right - arm, y: top, w: arm, h: t }, { x: right - t, y: top, w: t, h: arm }],
    [{ x: left, y: bottom - t, w: arm, h: t }, { x: left, y: bottom - arm, w: t, h: arm }],
    [{ x: right - arm, y: bottom - t, w: arm, h: t }, { x: right - t, y: bottom - arm, w: t, h: arm }],
  ];
}

/** Payload format used on the mock sheets: CS1|<assessment>|<form>|<student>. */
export function sheetPayload(assessment: string, form: string, student: string): string {
  return `CS1|${assessment}|${form}|${student}`;
}

export interface Bubble {
  question: number; // 1-based
  option: number; // 0-based (A=0)
  cx: number;
  cy: number;
}

export const BUBBLE = { radius: 3.2, questions: 20, options: 4 } as const;

/** Answer bubble centres: two columns of ten questions, four options each. */
export function bubbles(): Bubble[] {
  const out: Bubble[] = [];
  const colX = [30, 120];
  for (let q = 0; q < BUBBLE.questions; q++) {
    const col = Math.floor(q / 10);
    const row = q % 10;
    for (let o = 0; o < BUBBLE.options; o++) {
      out.push({ question: q + 1, option: o, cx: colX[col] + 16 + o * 14, cy: 100 + row * 16 });
    }
  }
  return out;
}

/** Deterministic mock answers (0-based option per question) for a seed string. */
export function mockAnswers(seed: string): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const answers: number[] = [];
  for (let q = 0; q < BUBBLE.questions; q++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    answers.push(h % BUBBLE.options);
  }
  return answers;
}
