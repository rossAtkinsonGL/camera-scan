import type { FrameData } from '../quality/image';
import { toLuma } from '../quality/image';
import type { Point } from '../quality/markers';
import { BUBBLE, SHEET, bubbles } from '../quality/sheetLayout';

export type AnswerStatus = 'answered' | 'blank' | 'multiple' | 'unclear';

export interface AnswerRead {
  /** 1-based question number. */
  question: number;
  /** The selected option letter, or null if blank, multiple or unclear. */
  answer: string | null;
  status: AnswerStatus;
  /** 0 to 1: how clearly the marks say this. Low values deserve a human look. */
  confidence: number;
  /** Every option that looked filled in. */
  marked: string[];
}

export interface SheetId {
  /** The QR code text, exactly as read. */
  raw: string;
  assessment?: string;
  form?: string;
  student?: string;
}

export interface SheetReading {
  sheet: SheetId;
  /** How the sheet is turned in the image: which detected corner is the sheet's top-left. */
  rotation: 0 | 1 | 2 | 3;
  answers: AnswerRead[];
  summary: Record<AnswerStatus, number>;
}

/** The plain data a scorer needs: who, which test, and the selected answer per question. */
export interface ScorableResponse {
  assessment?: string;
  form?: string;
  student?: string;
  responses: { question: number; answer: string | null }[];
}

const LETTERS = ['A', 'B', 'C', 'D'];
/** Darkness (0 to 1) at or above which a bubble counts as filled in. */
const FILLED = 0.5;
/** Between this and FILLED a bubble is a smudge or a faint mark, not an answer. */
const FAINT = 0.25;

/** Reads `CS1|assessment|form|student`. Anything else just keeps the raw text. */
export function parseSheetPayload(raw: string): SheetId {
  const parts = raw.split('|');
  if (parts[0] === 'CS1' && parts.length >= 4) {
    return { raw, assessment: parts[1], form: parts[2], student: parts[3] };
  }
  return { raw };
}

/** Homography mapping src points to dst points (4 each), as h0..h7 with h8 = 1. Null if degenerate. */
function homography(src: Point[], dst: Point[]): number[] | null {
  const m: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    m.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 9; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[8] / row[i]);
}

function mapPoint(h: number[], x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + 1;
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Mean luma over a disc on the sheet (mm), sampled through the homography. NaN if off-frame. */
function discMean(
  luma: Uint8Array,
  width: number,
  height: number,
  h: number[],
  cx: number,
  cy: number,
  radius: number,
  step: number,
): number {
  let sum = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const p = mapPoint(h, cx + dx, cy + dy);
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      sum += luma[py * width + px];
      n++;
    }
  }
  return n === 0 ? NaN : sum / n;
}

/**
 * Reads the filled-in bubbles. `corners` are the four bracket corners in `frame` coordinates, clockwise
 * from the image's top-left-most one; `rotation` says which of them is the sheet's top-left.
 * Returns null if the geometry is degenerate.
 */
export function readAnswers(
  frame: FrameData,
  corners: readonly Point[],
  rotation: 0 | 1 | 2 | 3,
  qrText: string,
): SheetReading | null {
  const { inset } = SHEET.bracket;
  const sheetCorners: Point[] = [
    { x: inset, y: inset },
    { x: SHEET.width - inset, y: inset },
    { x: SHEET.width - inset, y: SHEET.height - inset },
    { x: inset, y: SHEET.height - inset },
  ];
  const turned = [0, 1, 2, 3].map((i) => corners[(i + rotation) % 4]);
  const h = homography(sheetCorners, turned);
  if (!h) return null;

  const luma = toLuma(frame);
  const { width, height } = frame;
  const inner = BUBBLE.radius * 0.55;
  const gap = BUBBLE.radius + 2.5;

  // Darkness of each bubble compared with the paper right beside it, so uneven lighting cancels out.
  const darkness = new Map<string, number>();
  for (const b of bubbles()) {
    const centre = discMean(luma, width, height, h, b.cx, b.cy, inner, 0.5);
    const paper = [
      discMean(luma, width, height, h, b.cx - gap, b.cy, 0.8, 0.4),
      discMean(luma, width, height, h, b.cx + gap, b.cy, 0.8, 0.4),
      discMean(luma, width, height, h, b.cx, b.cy - gap, 0.8, 0.4),
      discMean(luma, width, height, h, b.cx, b.cy + gap, 0.8, 0.4),
    ].filter((v) => !Number.isNaN(v));
    const ref = paper.length ? paper.reduce((s, v) => s + v, 0) / paper.length : NaN;
    const d = Number.isNaN(centre) || Number.isNaN(ref) || ref < 1 ? 0 : 1 - centre / ref;
    darkness.set(`${b.question}:${b.option}`, Math.min(1, Math.max(0, d)));
  }

  const answers: AnswerRead[] = [];
  for (let q = 1; q <= BUBBLE.questions; q++) {
    const d = LETTERS.slice(0, BUBBLE.options).map((_, o) => darkness.get(`${q}:${o}`) ?? 0);
    const marked = d.flatMap((v, o) => (v >= FILLED ? [LETTERS[o]] : []));
    const sorted = [...d].sort((a, b) => b - a);
    const best = sorted[0];
    const second = sorted[1] ?? 0;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    if (marked.length === 1) {
      answers.push({ question: q, answer: marked[0], status: 'answered', confidence: clamp(best - second), marked });
    } else if (marked.length > 1) {
      answers.push({ question: q, answer: null, status: 'multiple', confidence: clamp(best - FILLED + 0.5), marked });
    } else if (best >= FAINT) {
      answers.push({ question: q, answer: null, status: 'unclear', confidence: clamp(1 - best / FILLED), marked });
    } else {
      answers.push({ question: q, answer: null, status: 'blank', confidence: clamp(1 - best / FAINT), marked });
    }
  }

  const summary: Record<AnswerStatus, number> = { answered: 0, blank: 0, multiple: 0, unclear: 0 };
  for (const a of answers) summary[a.status]++;
  return { sheet: parseSheetPayload(qrText), rotation, answers, summary };
}

/** The minimal, scorer-friendly output. */
export function toScorableResponse(reading: SheetReading): ScorableResponse {
  const { assessment, form, student } = reading.sheet;
  return {
    assessment,
    form,
    student,
    responses: reading.answers.map((a) => ({ question: a.question, answer: a.answer })),
  };
}
