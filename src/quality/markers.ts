import { otsuThreshold } from './image';
import { SHEET } from './sheetLayout';

export interface Point {
  x: number;
  y: number;
}

export interface MarkerResult {
  /** The outer corner of each bracket, clockwise from the top-left, in analysed-frame coordinates. */
  corners: [Point, Point, Point, Point];
  /** Area of the quad as a fraction of the frame (0 to 1). */
  areaFraction: number;
  /** Shorter / longer of the two opposite edge pairs (1 = square-on, lower = more tilt). */
  skew: number;
  /** Bounding box of the quad. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/** Quadrant index: 0 = top-left, 1 = top-right, 2 = bottom-right, 3 = bottom-left. */
type Quadrant = 0 | 1 | 2 | 3;

interface Bracket {
  /** The outer corner of the L, in frame coordinates. */
  x: number;
  y: number;
  /** Which way the L's corner points (the quadrant of its bounding box that holds the corner). */
  corner: Quadrant;
  /** sqrt of the bounding-box area, a size proxy. */
  size: number;
}

// An L bracket: dark pixels / bounding-box area (0.38 for the reference sheet).
const MIN_L_FILL = 0.15;
const MAX_L_FILL = 0.65;
// The quadrant the L leaves empty may hold at most this share of the ink, and at most this fraction of
// the next-emptiest quadrant (a turned L leaks some ink into it). The other three need a real share each.
const MAX_EMPTY_QUADRANT = 0.2;
const EMPTY_VS_NEXT = 0.45;
const MIN_FILLED_QUADRANT = 0.12;
const MIN_ASPECT = 0.6;
const MAX_ASPECT = 1.67;
const MIN_BRACKET_FRAC = 0.012; // bracket size as a fraction of the longer frame side
const MAX_BRACKET_FRAC = 0.2;
const MAX_CANDIDATES = 12;
const MIN_SIZE_RATIO = 0.75; // smallest / largest bracket in a group
const MIN_AREA_FRACTION = 0.08; // below this we treat the sheet as not found; evaluate() flags "too small" earlier
// Reference sheet: bracket corners are 190mm x 277mm apart.
const SHEET_RATIO = (SHEET.width - 2 * SHEET.bracket.inset) / (SHEET.height - 2 * SHEET.bracket.inset);
const RATIO_TOLERANCE = 0.14;

/** Finds L-shaped dark blobs (connected components) in a grayscale frame. */
function findBrackets(luma: Uint8Array, width: number, height: number): Bracket[] {
  const threshold = otsuThreshold(luma);
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < dark.length; i++) dark[i] = luma[i] < threshold ? 1 : 0;

  const longSide = Math.max(width, height);
  const minSize = MIN_BRACKET_FRAC * longSide;
  const maxSize = MAX_BRACKET_FRAC * longSide;
  const stack = new Int32Array(width * height);
  const members = new Int32Array(width * height);
  const found: Bracket[] = [];

  for (let start = 0; start < dark.length; start++) {
    if (dark[start] !== 1) continue;
    let sp = 0;
    stack[sp++] = start;
    dark[start] = 2;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let count = 0;
    while (sp > 0) {
      const p = stack[--sp];
      members[count++] = p;
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && dark[p - 1] === 1) { dark[p - 1] = 2; stack[sp++] = p - 1; }
      if (x < width - 1 && dark[p + 1] === 1) { dark[p + 1] = 2; stack[sp++] = p + 1; }
      if (y > 0 && dark[p - width] === 1) { dark[p - width] = 2; stack[sp++] = p - width; }
      if (y < height - 1 && dark[p + width] === 1) { dark[p + width] = 2; stack[sp++] = p + width; }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const size = Math.sqrt(w * h);
    if (size < minSize || size > maxSize) continue;
    const aspect = w / h;
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) continue;
    const fill = count / (w * h);
    if (fill < MIN_L_FILL || fill > MAX_L_FILL) continue;

    // Where is the ink? An L leaves exactly one quadrant of its bounding box empty, and
    // its corner points at the opposite quadrant. Rings, discs, squares, lines and text
    // blobs do not have that signature.
    const midX = minX + w / 2;
    const midY = minY + h / 2;
    const ink = [0, 0, 0, 0];
    for (let i = 0; i < count; i++) {
      const p = members[i];
      const x = p % width;
      const y = (p - x) / width;
      ink[y < midY ? (x < midX ? 0 : 1) : x < midX ? 3 : 2]++;
    }
    let empty = 0;
    for (let q = 1; q < 4; q++) if (ink[q] < ink[empty]) empty = q;
    const others = ink.filter((_, q) => q !== empty);
    if (ink[empty] / count > MAX_EMPTY_QUADRANT) continue;
    if (ink[empty] > EMPTY_VS_NEXT * Math.min(...others)) continue;
    if (others.some((n) => n / count < MIN_FILLED_QUADRANT)) continue;
    const corner = ((empty + 2) % 4) as Quadrant;

    // The L's outer corner: the ink pixel nearest the bounding-box corner it points at.
    const tx = corner === 0 || corner === 3 ? minX : maxX;
    const ty = corner === 0 || corner === 1 ? minY : maxY;
    let best = Infinity;
    let bx = tx;
    let by = ty;
    for (let i = 0; i < count; i++) {
      const p = members[i];
      const x = p % width;
      const y = (p - x) / width;
      const d = Math.abs(x - tx) + Math.abs(y - ty);
      if (d < best) {
        best = d;
        bx = x;
        by = y;
      }
    }
    found.push({ x: bx, y: by, corner, size });
  }
  return found;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Orders four points clockwise starting from the one nearest the top-left. */
function orderClockwise(pts: Point[]): [Point, Point, Point, Point] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[first].x + sorted[first].y) first = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(first + i) % 4]) as [Point, Point, Point, Point];
}

function quadArea(q: Point[]): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

function quadrantOf(p: Point, centre: Point): Quadrant {
  if (p.y < centre.y) return p.x < centre.x ? 0 : 1;
  return p.x < centre.x ? 3 : 2;
}

function evaluateQuad(group: Bracket[], width: number, height: number): MarkerResult | null {
  const sizes = group.map((b) => b.size);
  if (Math.min(...sizes) / Math.max(...sizes) < MIN_SIZE_RATIO) return null;

  // Each L must point outwards, at the page corner it sits in.
  const centre = {
    x: group.reduce((s, b) => s + b.x, 0) / 4,
    y: group.reduce((s, b) => s + b.y, 0) / 4,
  };
  const seen = new Set<Quadrant>();
  for (const b of group) {
    const where = quadrantOf(b, centre);
    if (b.corner !== where) return null;
    seen.add(where);
  }
  if (seen.size !== 4) return null;

  const q = orderClockwise(group);
  // Convex: every turn has the same sign.
  const signs = [0, 1, 2, 3].map((i) => Math.sign(cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])));
  if (!signs.every((s) => s === signs[0] && s !== 0)) return null;

  const top = dist(q[0], q[1]);
  const right = dist(q[1], q[2]);
  const bottom = dist(q[2], q[3]);
  const left = dist(q[3], q[0]);
  const horizontal = (top + bottom) / 2;
  const vertical = (left + right) / 2;
  const ratio = Math.min(horizontal, vertical) / Math.max(horizontal, vertical);
  if (Math.abs(ratio - SHEET_RATIO) > RATIO_TOLERANCE) return null;

  const areaFraction = quadArea(q) / (width * height);
  if (areaFraction < MIN_AREA_FRACTION) return null;

  const skew = Math.min(
    Math.min(top, bottom) / Math.max(top, bottom),
    Math.min(left, right) / Math.max(left, right),
  );
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return {
    corners: q,
    areaFraction,
    skew,
    bounds: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
  };
}

/**
 * Looks for the four L-shaped corner brackets of an answer sheet.
 * Returns the best sheet-shaped group, or null if there is none.
 */
export function detectMarkers(luma: Uint8Array, width: number, height: number): MarkerResult | null {
  const brackets = findBrackets(luma, width, height)
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_CANDIDATES);
  if (brackets.length < 4) return null;

  let best: MarkerResult | null = null;
  for (let a = 0; a < brackets.length - 3; a++) {
    for (let b = a + 1; b < brackets.length - 2; b++) {
      for (let c = b + 1; c < brackets.length - 1; c++) {
        for (let d = c + 1; d < brackets.length; d++) {
          const result = evaluateQuad([brackets[a], brackets[b], brackets[c], brackets[d]], width, height);
          if (result && (!best || result.areaFraction > best.areaFraction)) best = result;
        }
      }
    }
  }
  return best;
}

export interface FrameRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bilinear(c: Point[], u: number, v: number): Point {
  return {
    x: (1 - u) * (1 - v) * c[0].x + u * (1 - v) * c[1].x + u * v * c[2].x + (1 - u) * v * c[3].x,
    y: (1 - u) * (1 - v) * c[0].y + u * (1 - v) * c[1].y + u * v * c[2].y + (1 - u) * v * c[3].y,
  };
}

/**
 * Where the QR code could be, given the sheet outline: one box per possible turn of the sheet
 * (the brackets alone cannot tell which way up it is). Coordinates are in the analysed frame.
 */
export function qrSearchRegions(corners: MarkerResult['corners'], width: number, height: number): FrameRegion[] {
  const { inset } = SHEET.bracket;
  const spanX = SHEET.width - 2 * inset;
  const spanY = SHEET.height - 2 * inset;
  const u0 = (SHEET.qr.x - inset) / spanX;
  const u1 = (SHEET.qr.x + SHEET.qr.size - inset) / spanX;
  const v0 = (SHEET.qr.y - inset) / spanY;
  const v1 = (SHEET.qr.y + SHEET.qr.size - inset) / spanY;
  const regions: FrameRegion[] = [];
  for (let k = 0; k < 4; k++) {
    const turned = [0, 1, 2, 3].map((i) => corners[(i + k) % 4]);
    const pts = [bilinear(turned, u0, v0), bilinear(turned, u1, v0), bilinear(turned, u1, v1), bilinear(turned, u0, v1)];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const padX = 0.12 * (Math.max(...xs) - Math.min(...xs));
    const padY = 0.12 * (Math.max(...ys) - Math.min(...ys));
    regions.push({
      x0: Math.max(0, Math.min(...xs) - padX),
      y0: Math.max(0, Math.min(...ys) - padY),
      x1: Math.min(width, Math.max(...xs) + padX),
      y1: Math.min(height, Math.max(...ys) + padY),
    });
  }
  return regions;
}
