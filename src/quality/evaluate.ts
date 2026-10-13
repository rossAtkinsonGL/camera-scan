import { glareFraction, laplacianVariance, meanBrightness, type Region } from './image';
import type { MarkerResult } from './markers';

export type QualityIssue =
  | 'sheet-not-found'
  | 'sheet-too-small'
  | 'sheet-skewed'
  | 'too-dark'
  | 'glare'
  | 'blurry'
  | 'unsteady'
  | 'qr-not-readable';

export interface QualityMetrics {
  sharpness: number;
  brightness: number;
  glare: number;
  /** Mean luma change since the previous frame. Undefined for still images. */
  motion?: number;
  markers: MarkerResult | null;
  qr: string | null;
}

export interface QualityThresholds {
  /** Minimum Laplacian variance (measured at the analysis resolution). */
  minSharpness: number;
  /** Minimum mean brightness (0 to 255) of the sheet area. */
  minBrightness: number;
  /** Maximum fraction of blown-out pixels in the sheet area. */
  maxGlare: number;
  /** Maximum mean frame-to-frame luma change before we call it unsteady. */
  maxMotion: number;
  /** Minimum area of the marker quad as a fraction of the frame. */
  minSheetArea: number;
  /** Minimum opposite-edge ratio (1 = camera square-on to the page). */
  minSkew: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minSharpness: 150,
  minBrightness: 100,
  maxGlare: 0.15,
  maxMotion: 6,
  minSheetArea: 0.3,
  minSkew: 0.85,
};

/** Above this fraction of saturated pixels the whole page is bright, which is not a glare patch. */
const WHOLE_PAGE_SATURATION = 0.6;

export interface QualityReport {
  ok: boolean;
  /** Issues in priority order: fix the first one first. */
  issues: QualityIssue[];
  metrics: QualityMetrics;
}

export const ISSUE_MESSAGES: Record<QualityIssue, string> = {
  'sheet-not-found': 'Fit the whole sheet in view, including all four corner brackets',
  'sheet-too-small': 'Move closer to the sheet',
  'sheet-skewed': 'Hold the camera directly above the sheet',
  'too-dark': 'Needs more light',
  glare: 'Reduce glare on the page',
  blurry: 'Image is blurry, hold steady or let it focus',
  unsteady: 'Hold still',
  'qr-not-readable': 'Cannot read the QR code yet. Move closer or hold steady until it is sharp',
};

export interface MeasureInput {
  luma: Uint8Array;
  width: number;
  height: number;
  markers: MarkerResult | null;
  qr: string | null;
  motion?: number;
}

/** Measures sharpness, brightness and glare, over the sheet area when one was found. */
export function measure(input: MeasureInput): QualityMetrics {
  const { luma, width, height, markers, qr, motion } = input;
  const region: Region | undefined = markers
    ? { x0: markers.bounds.x0, y0: markers.bounds.y0, x1: markers.bounds.x1, y1: markers.bounds.y1 }
    : undefined;
  return {
    sharpness: laplacianVariance(luma, width, height, region),
    brightness: meanBrightness(luma, width, height, region),
    glare: glareFraction(luma, width, height, region),
    motion,
    markers,
    qr,
  };
}

export interface EvaluateOptions {
  /** Require the corner markers and QR code to be present. Default true. */
  expectSheet?: boolean;
  thresholds?: Partial<QualityThresholds>;
}

export function evaluate(metrics: QualityMetrics, options: EvaluateOptions = {}): QualityReport {
  const t = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const expectSheet = options.expectSheet ?? true;
  const issues: QualityIssue[] = [];

  if (expectSheet) {
    if (!metrics.markers) {
      issues.push('sheet-not-found');
    } else {
      if (metrics.markers.areaFraction < t.minSheetArea) issues.push('sheet-too-small');
      if (metrics.markers.skew < t.minSkew) issues.push('sheet-skewed');
    }
  }
  // Without the sheet located we only measured the whole frame, which says little.
  if (!expectSheet || metrics.markers) {
    if (metrics.brightness < t.minBrightness) issues.push('too-dark');
    // Glare is a blown-out patch on otherwise normal paper. If most of the sheet is saturated
    // it is just white paper (or a bright screen) and the ink is still readable, so not glare.
    if (metrics.glare > t.maxGlare && metrics.glare < WHOLE_PAGE_SATURATION) issues.push('glare');
    if (metrics.sharpness < t.minSharpness) issues.push('blurry');
  }
  if (metrics.motion !== undefined && metrics.motion > t.maxMotion) issues.push('unsteady');
  if (expectSheet && metrics.markers && !metrics.qr) issues.push('qr-not-readable');

  return { ok: issues.length === 0, issues, metrics };
}
