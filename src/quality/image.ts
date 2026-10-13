/** Minimal RGBA frame, structurally compatible with the DOM ImageData. */
export interface FrameData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Region {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
}

/** Grayscale (Rec. 601 luma) of an RGBA frame, one byte per pixel. */
export function toLuma(frame: FrameData): Uint8Array {
  const { data, width, height } = frame;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return out;
}

export function clampRegion(region: Region | undefined, width: number, height: number): Region {
  if (!region) return { x0: 0, y0: 0, x1: width, y1: height };
  return {
    x0: Math.max(0, Math.floor(region.x0)),
    y0: Math.max(0, Math.floor(region.y0)),
    x1: Math.min(width, Math.ceil(region.x1)),
    y1: Math.min(height, Math.ceil(region.y1)),
  };
}

/** Variance of the Laplacian: a standard focus measure (higher is sharper). */
export function laplacianVariance(luma: Uint8Array, width: number, height: number, region?: Region): number {
  const r = clampRegion(region, width, height);
  const x0 = Math.max(1, r.x0);
  const y0 = Math.max(1, r.y0);
  const x1 = Math.min(width - 1, r.x1);
  const y1 = Math.min(height - 1, r.y1);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      const v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function meanBrightness(luma: Uint8Array, width: number, height: number, region?: Region): number {
  const r = clampRegion(region, width, height);
  let sum = 0;
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      sum += luma[y * width + x];
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** Fraction of pixels that are blown out (near-white saturation). */
export function glareFraction(luma: Uint8Array, width: number, height: number, region?: Region, level = 252): number {
  const r = clampRegion(region, width, height);
  let hot = 0;
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      if (luma[y * width + x] >= level) hot++;
      n++;
    }
  }
  return n === 0 ? 0 : hot / n;
}

/** Mean absolute luma difference between two same-sized frames (0 to 255). */
export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** Otsu's method: the luma threshold that best separates dark ink from paper. */
export function otsuThreshold(luma: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++;
  const total = luma.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/** A copy of the frame cropped to the given region. */
export function cropFrame(frame: FrameData, region: Region): FrameData {
  const r = clampRegion(region, frame.width, frame.height);
  const width = Math.max(0, r.x1 - r.x0);
  const height = Math.max(0, r.y1 - r.y0);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((r.y0 + y) * frame.width + r.x0) * 4;
    data.set(frame.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { data, width, height };
}

/** Grayscale copy of the frame, smoothed with a box filter of the given radius. Hides screen line patterns. */
export function blurredGray(luma: Uint8Array, width: number, height: number, radius: number): FrameData {
  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) {
        sum += luma[y * width + k];
        n++;
      }
      tmp[y * width + x] = sum / n;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) {
        sum += tmp[k * width + x];
        n++;
      }
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = sum / n;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}
