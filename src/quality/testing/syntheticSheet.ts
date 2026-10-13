import QRCode from 'qrcode';
import type { FrameData } from '../image';
import { BUBBLE, SHEET, bubbles, bracketRects, mockAnswers, sheetPayload } from '../sheetLayout';

export interface SheetRenderOptions {
  width: number;
  height: number;
  /** Pixels per millimetre. */
  scale: number;
  /** Page centre in the frame, in pixels. Defaults to the frame centre. */
  centerX?: number;
  centerY?: number;
  payload?: string;
  /** Index (TL, TR, BL, BR) of a corner bracket to leave off the page. */
  omitMarker?: number;
  /** Narrowing of the top edge relative to the bottom, e.g. 0.2 simulates a tilted camera. */
  keystone?: number;
  /** Rotate the page by 90 degrees (landscape phone). */
  rotate90?: boolean;
  /** Rotate the page by this many degrees (a hand-held, slightly turned camera). */
  rotateDeg?: number;
  background?: number;
}

/** Renders a mock answer sheet into an RGBA frame, for tests (no DOM needed). */
export function renderSheet(opts: SheetRenderOptions): FrameData {
  const { width, height, scale } = opts;
  const cx = opts.centerX ?? width / 2;
  const cy = opts.centerY ?? height / 2;
  const payload = opts.payload ?? sheetPayload('MATH-U3', 'A', 'S001');
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = SHEET.qr.size / (n + 8); // 4-module quiet zone on each side
  const answers = mockAnswers(payload);
  const bubbleList = bubbles();
  const brackets = bracketRects().filter((_, i) => i !== opts.omitMarker).flat();
  const angle = ((opts.rotateDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const keystone = opts.keystone ?? 0;
  const bg = opts.background ?? 70;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let dx = px - cx;
      let dy = py - cy;
      if (opts.rotate90) [dx, dy] = [dy, -dx];
      if (angle !== 0) [dx, dy] = [dx * cos + dy * sin, -dx * sin + dy * cos];
      // Keystone: rows nearer the top of the frame are drawn narrower.
      const rowScale = scale * (1 + keystone * (dy / height));
      const x = dx / rowScale + SHEET.width / 2;
      const y = dy / scale + SHEET.height / 2;
      let v = bg;
      if (x >= 0 && x < SHEET.width && y >= 0 && y < SHEET.height) {
        v = 245;
        if (brackets.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) {
          v = 0;
        } else if (
          x >= SHEET.qr.x && x < SHEET.qr.x + SHEET.qr.size &&
          y >= SHEET.qr.y && y < SHEET.qr.y + SHEET.qr.size
        ) {
          const mx = Math.floor((x - SHEET.qr.x) / cell) - 4;
          const my = Math.floor((y - SHEET.qr.y) / cell) - 4;
          v = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(mx, my) ? 0 : 255;
        } else {
          for (const b of y > 90 && y < 260 ? bubbleList : []) {
            const d = Math.hypot(x - b.cx, y - b.cy);
            if (d > BUBBLE.radius + 0.4) continue;
            const filled = answers[b.question - 1] === b.option;
            if (filled ? d <= BUBBLE.radius : d >= BUBBLE.radius - 0.4) v = 20;
            break;
          }
        }
      }
      const i = (py * width + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Simple box blur (in place on a copy), to simulate an out-of-focus frame. */
export function boxBlur(frame: FrameData, radius: number): FrameData {
  const { width, height } = frame;
  const src = frame.data;
  const out = new Uint8ClampedArray(src.length);
  const tmp = new Float32Array(width * height);
  const pass = (read: (i: number) => number, write: (i: number, v: number) => void, horizontal: boolean) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          sum += read(yy * width + xx);
          count++;
        }
        write(y * width + x, sum / count);
      }
    }
  };
  pass((i) => src[i * 4], (i, v) => (tmp[i] = v), true);
  const tmp2 = new Float32Array(width * height);
  pass((i) => tmp[i], (i, v) => (tmp2[i] = v), false);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = tmp2[i];
    out[i * 4 + 3] = 255;
  }
  return { data: out, width, height };
}
