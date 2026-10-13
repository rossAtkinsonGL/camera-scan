import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { evaluate, measure } from './evaluate';
import { toLuma, type FrameData } from './image';
import { detectMarkers } from './markers';
import { decodeQr } from './qr';
import { sheetPayload } from './sheetLayout';

const SHEETS = join(process.cwd(), 'demo', 'public', 'sheets');

/** Rasterises a generated sheet the way a camera frame would see it: sheet centred on a darker background. */
function rasterise(file: string, frameW: number, frameH: number, sheetW: number): FrameData {
  const svg = readFileSync(join(SHEETS, `${file}.svg`), 'utf8');
  const sheet = new Resvg(svg, { fitTo: { mode: 'width', value: sheetW }, background: '#ffffff' }).render();
  const data = new Uint8ClampedArray(frameW * frameH * 4);
  for (let i = 0; i < frameW * frameH; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 70;
    data[i * 4 + 3] = 255;
  }
  const ox = Math.round((frameW - sheet.width) / 2);
  const oy = Math.round((frameH - sheet.height) / 2);
  const px = sheet.pixels;
  for (let y = 0; y < sheet.height; y++) {
    const fy = y + oy;
    if (fy < 0 || fy >= frameH) continue;
    for (let x = 0; x < sheet.width; x++) {
      const fx = x + ox;
      if (fx < 0 || fx >= frameW) continue;
      const s = (y * sheet.width + x) * 4;
      const d = (fy * frameW + fx) * 4;
      data[d] = px[s];
      data[d + 1] = px[s + 1];
      data[d + 2] = px[s + 2];
    }
  }
  return { data, width: frameW, height: frameH };
}

/** Facts about a frame, to put in assertion messages so a CI-only failure explains itself. */
function describeFrame(f: FrameData): string {
  const luma = toLuma(f);
  let dark = 0;
  let sum = 0;
  for (const v of luma) {
    sum += v;
    if (v < 100) dark++;
  }
  const pct = (n: number) => ((n / luma.length) * 100).toFixed(1);
  return `frame ${f.width}x${f.height}, mean luma ${(sum / luma.length).toFixed(1)}, dark ${pct(dark)}%, platform ${process.platform}`;
}

describe('generated mock sheets', () => {
  const good = [
    ['sheet-S001', sheetPayload('MATH-U3', 'A', 'S001')],
    ['sheet-S003', sheetPayload('MATH-U3', 'B', 'S003')],
    ['sheet-S004', sheetPayload('READ-U1', 'A', 'S004')],
  ] as const;

  for (const [file, payload] of good) {
    it(`${file}: finds the markers at analysis size and reads the QR at QR size`, () => {
      const small = rasterise(file, 480, 640, 440);
      const markers = detectMarkers(toLuma(small), small.width, small.height);
      expect(markers).not.toBeNull();
      const large = rasterise(file, 640, 860, 600);
      expect(decodeQr(large), describeFrame(large)).toBe(payload);
      const report = evaluate(
        measure({ luma: toLuma(small), width: small.width, height: small.height, markers, qr: payload }),
      );
      expect(report.issues).toEqual([]);
    });
  }

  it('sheet-bad-missing-marker: no sheet found (even with filled bubbles around), but the QR is still readable', () => {
    const small = rasterise('sheet-bad-missing-marker', 480, 640, 440);
    expect(detectMarkers(toLuma(small), small.width, small.height)).toBeNull();
    const large = rasterise('sheet-bad-missing-marker', 640, 860, 600);
    expect(decodeQr(large), describeFrame(large)).toBe(sheetPayload('MATH-U3', 'A', 'S006'));
  });
});
