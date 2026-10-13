import { describe, expect, it } from 'vitest';
import { evaluate, measure } from './evaluate';
import { cropFrame, frameDifference, toLuma, type FrameData } from './image';
import { detectMarkers, qrSearchRegions } from './markers';
import { decodeQr } from './qr';
import { sheetPayload } from './sheetLayout';
import { boxBlur, renderSheet } from './testing/syntheticSheet';

// Portrait phone frame at the analysis size, sheet filling most of it.
const PORTRAIT = { width: 480, height: 640, scale: 2.0 };
// Landscape frame, sheet fills the height.
const LANDSCAPE = { width: 640, height: 480, scale: 1.55 };

function analyse(frame: ReturnType<typeof renderSheet>, qr: string | null = 'x') {
  const luma = toLuma(frame);
  const markers = detectMarkers(luma, frame.width, frame.height);
  return { luma, markers, report: evaluate(measure({ luma, width: frame.width, height: frame.height, markers, qr })) };
}

describe('marker detection', () => {
  it('finds the four corner brackets on a portrait frame', () => {
    const { markers } = analyse(renderSheet(PORTRAIT));
    expect(markers).not.toBeNull();
    expect(markers!.skew).toBeGreaterThan(0.95);
    expect(markers!.areaFraction).toBeGreaterThan(0.3);
  });

  it('finds them when the sheet is landscape or rotated', () => {
    expect(analyse(renderSheet(LANDSCAPE)).markers).not.toBeNull();
    expect(analyse(renderSheet({ ...LANDSCAPE, rotate90: true, scale: 1.55 })).markers).not.toBeNull();
  });

  it('finds the brackets when the sheet is turned by hand', () => {
    for (const rotateDeg of [-25, -12, 12, 25]) {
      const { markers } = analyse(renderSheet({ ...PORTRAIT, scale: 1.45, rotateDeg }));
      expect(markers, 'rotated ' + rotateDeg).not.toBeNull();
    }
  });

  it('does not find a sheet when a marker is missing', () => {
    for (let i = 0; i < 4; i++) {
      expect(analyse(renderSheet({ ...PORTRAIT, omitMarker: i })).markers).toBeNull();
    }
  });

  it('does not find a sheet in an empty frame', () => {
    const empty = renderSheet({ ...PORTRAIT, scale: 0.01 });
    expect(analyse(empty).markers).toBeNull();
  });

  it('reports lower skew when the camera is tilted', () => {
    const tilted = analyse(renderSheet({ ...PORTRAIT, keystone: 0.3 }));
    expect(tilted.markers).not.toBeNull();
    expect(tilted.markers!.skew).toBeLessThan(0.85);
    expect(tilted.report.issues).toContain('sheet-skewed');
  });
});

describe('QR decoding', () => {
  it('reads the payload from a rendered sheet', () => {
    const payload = sheetPayload('MATH-U3', 'B', 'S042');
    expect(decodeQr(renderSheet({ ...PORTRAIT, scale: 2.2, payload }))).toBe(payload);
  });

  it('returns null when there is no QR code', () => {
    expect(decodeQr(renderSheet({ ...PORTRAIT, scale: 0.01 }))).toBeNull();
  });
});

/** Darkens rows and columns in a fine grid, like the pixel pattern you see photographing a screen. */
function addScreenLines(f: FrameData, period: number, amp: number): FrameData {
  const d = new Uint8ClampedArray(f.data);
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const m =
        1 -
        amp * (0.5 + 0.5 * Math.sin((2 * Math.PI * y) / period)) -
        amp * (0.5 + 0.5 * Math.sin((2 * Math.PI * x) / (period + 1.7)));
      const i = (y * f.width + x) * 4;
      d[i] *= m;
      d[i + 1] *= m;
      d[i + 2] *= m;
    }
  }
  return { data: d, width: f.width, height: f.height };
}

describe('QR search regions', () => {
  const payload = sheetPayload('MATH-U3', 'A', 'S001');

  for (const [name, opts] of [
    ['upright', {}],
    ['turned 90 degrees', { rotate90: true }],
    ['turned by hand', { rotateDeg: 15 }],
  ] as const) {
    it('finds the QR code by cropping near the sheet, ' + name, () => {
      const frame = renderSheet({ ...PORTRAIT, scale: 1.45, payload, ...opts });
      const markers = detectMarkers(toLuma(frame), frame.width, frame.height)!;
      expect(markers).not.toBeNull();
      const found = qrSearchRegions(markers.corners, frame.width, frame.height).map((r) =>
        decodeQr(cropFrame(frame, { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 })),
      );
      expect(found).toContain(payload);
    });
  }
});

describe('QR decoding through screen line patterns', () => {
  it('reads a QR code photographed through a fine screen line pattern', () => {
    const payload = sheetPayload('MATH-U3', 'A', 'S001');
    const frame = addScreenLines(renderSheet({ width: 720, height: 1000, scale: 640 / 210, payload }), 3, 0.5);
    expect(decodeQr(frame)).toBe(payload);
  });
});

describe('quality evaluation', () => {
  it('passes a clean, well-framed sheet', () => {
    const { report } = analyse(renderSheet(PORTRAIT));
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('flags a blurred sheet', () => {
    const sharp = analyse(renderSheet(PORTRAIT)).report.metrics.sharpness;
    const blurred = analyse(boxBlur(renderSheet(PORTRAIT), 3)).report;
    expect(blurred.metrics.sharpness).toBeLessThan(sharp / 3);
    expect(blurred.issues).toContain('blurry');
  });

  it('flags a dark sheet', () => {
    const frame = renderSheet(PORTRAIT);
    for (let i = 0; i < frame.data.length; i += 4) {
      frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = frame.data[i] * 0.3;
    }
    expect(analyse(frame).report.issues).toContain('too-dark');
  });

  it('flags a glare patch, but not a uniformly bright page', () => {
    const frame = renderSheet(PORTRAIT);
    for (let i = 0; i < frame.data.length; i += 4) {
      frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = frame.data[i] * 0.85; // paper ~208
    }
    for (let y = 200; y < 420; y++) {
      for (let x = 100; x < 330; x++) {
        const i = (y * frame.width + x) * 4;
        frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = 255;
      }
    }
    expect(analyse(frame).report.issues).toContain('glare');

    const white = renderSheet(PORTRAIT);
    for (let i = 0; i < white.data.length; i += 4) {
      if (white.data[i] === 245) white.data[i] = white.data[i + 1] = white.data[i + 2] = 255;
    }
    expect(analyse(white).report.issues).not.toContain('glare');
  });

  it('flags a sheet that is too small in frame', () => {
    const { report } = analyse(renderSheet({ ...PORTRAIT, scale: 1.0 }));
    expect(report.issues).toContain('sheet-too-small');
  });

  it('flags a missing QR code', () => {
    expect(analyse(renderSheet(PORTRAIT), null).report.issues).toContain('qr-not-readable');
  });

  it('flags unsteady frames', () => {
    const a = toLuma(renderSheet(PORTRAIT));
    const b = toLuma(renderSheet({ ...PORTRAIT, centerX: 240 + 12, centerY: 320 + 9 }));
    expect(frameDifference(a, a)).toBe(0);
    const motion = frameDifference(a, b);
    const luma = a;
    const markers = detectMarkers(luma, 480, 640);
    const report = evaluate(measure({ luma, width: 480, height: 640, markers, qr: 'x', motion }));
    expect(report.issues).toContain('unsteady');
  });

  it('skips sheet checks when no sheet is expected', () => {
    const luma = toLuma(renderSheet({ ...PORTRAIT, scale: 0.01 }));
    const m = measure({ luma, width: 480, height: 640, markers: null, qr: null });
    expect(evaluate(m, { expectSheet: false }).issues).not.toContain('sheet-not-found');
  });
});
