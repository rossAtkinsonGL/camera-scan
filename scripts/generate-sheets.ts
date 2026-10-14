/**
 * Generates mock answer sheets (SVG, PNG and PDF) with corner markers and a
 * QR code, into demo/public/sheets. Run with: npm run sheets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { BUBBLE, SHEET, bubbles, bracketRects, mockAnswers, sheetPayload } from '../src/quality/sheetLayout';

interface SheetSpec {
  file: string;
  student: string;
  studentId: string;
  assessment: string;
  form: string;
  /** Leave a corner marker off (TL, TR, BL, BR = 0..3) to make a deliberately bad sheet. */
  omitMarker?: number;
  note?: string;
}

const SPECS: SheetSpec[] = [
  { file: 'sheet-S001', student: 'Alex Morgan', studentId: 'S001', assessment: 'MATH-U3', form: 'A' },
  { file: 'sheet-S002', student: 'Priya Shah', studentId: 'S002', assessment: 'MATH-U3', form: 'A' },
  { file: 'sheet-S003', student: 'Jordan Lee', studentId: 'S003', assessment: 'MATH-U3', form: 'B' },
  { file: 'sheet-S004', student: 'Maria Garcia', studentId: 'S004', assessment: 'READ-U1', form: 'A' },
  { file: 'sheet-S005', student: 'Tom Becker', studentId: 'S005', assessment: 'READ-U1', form: 'B' },
  {
    file: 'sheet-bad-missing-marker',
    student: 'Sam Rivera',
    studentId: 'S006',
    assessment: 'MATH-U3',
    form: 'A',
    omitMarker: 1,
    note: 'Deliberately broken: top-right corner bracket is missing. The app should say it cannot find the sheet.',
  },
];

const MM_TO_PT = 72 / 25.4;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'public');

/** The same sheets twice: with the mock answers filled in, and empty (to print and fill in by hand). */
const VARIANTS = [
  { dir: 'sheets', empty: false },
  { dir: 'empty-sheets', empty: true },
];

function qrModules(payload: string) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = SHEET.qr.size / (n + 8); // 4-module quiet zone each side
  const dark: { x: number; y: number }[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(x, y)) dark.push({ x: SHEET.qr.x + (x + 4) * cell, y: SHEET.qr.y + (y + 4) * cell });
    }
  }
  return { dark, cell };
}

/** Left edge and baseline (mm) and font size (mm) of each text line, in labelsFor order. */
const LABEL_LAYOUT = {
  title: { x: 24, y: 26, size: 7 },
  sub: { x: 24, y: 34, size: 4.5 },
  name: { x: 24, y: 52, size: 4.5 },
  id: { x: 24, y: 60, size: 4.5 },
  note: { x: 24, y: 72, size: 3.2 },
} as const;

/**
 * Fonts differ between machines (Arial here, a wider fallback on Linux), so a line that only just
 * clears the QR code on one machine can run into it on another. Assume a wide font (0.75em per
 * character) and refuse to generate a sheet where text beside the QR code could reach it.
 */
function assertClearOfQr(labels: Record<keyof typeof LABEL_LAYOUT, string>) {
  const quietGap = 4;
  for (const key of Object.keys(LABEL_LAYOUT) as (keyof typeof LABEL_LAYOUT)[]) {
    const { x, y, size } = LABEL_LAYOUT[key];
    const beside = y > SHEET.qr.y && y - size < SHEET.qr.y + SHEET.qr.size;
    const widest = x + labels[key].length * size * 0.75;
    if (beside && widest > SHEET.qr.x - quietGap) {
      throw new Error(`Text "${labels[key]}" could run into the QR code (needs ${widest.toFixed(0)}mm, limit ${SHEET.qr.x - quietGap}mm).`);
    }
  }
}

function labelsFor(spec: SheetSpec) {
  const labels = {
    title: 'Mock Answer Sheet',
    sub: `${spec.assessment}  |  Form ${spec.form}`,
    name: `Name: ${spec.student}`,
    id: `Student ID: ${spec.studentId}`,
    note: 'MOCK SHEET for camera testing. Fill bubbles completely.',
  };
  assertClearOfQr(labels);
  return labels;
}

function svgFor(spec: SheetSpec, payload: string, empty: boolean): string {
  const brackets = bracketRects().filter((_, i) => i !== spec.omitMarker).flat();
  const { dark, cell } = qrModules(payload);
  const answers = mockAnswers(payload);
  const L = labelsFor(spec);
  const f = (n: number) => n.toFixed(3);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.width}mm" height="${SHEET.height}mm" viewBox="0 0 ${SHEET.width} ${SHEET.height}" font-family="Arial, Helvetica, sans-serif">`);
  parts.push(`<rect width="${SHEET.width}" height="${SHEET.height}" fill="#fff"/>`);
  for (const r of brackets) parts.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#000"/>`);
  parts.push(`<path fill="#000" d="${dark.map((m) => `M${f(m.x)} ${f(m.y)}h${f(cell)}v${f(cell)}h${f(-cell)}z`).join('')}"/>`);
  parts.push(`<text x="24" y="26" font-size="7" font-weight="bold">${L.title}</text>`);
  parts.push(`<text x="24" y="34" font-size="4.5">${L.sub}</text>`);
  parts.push(`<text x="24" y="52" font-size="4.5">${L.name}</text>`);
  parts.push(`<text x="24" y="60" font-size="4.5">${L.id}</text>`);
  parts.push(`<text x="24" y="72" font-size="3.2" fill="#444">${L.note}</text>`);
  for (let col = 0; col < 2; col++) {
    const x0 = [30, 120][col];
    ['A', 'B', 'C', 'D'].forEach((letter, o) => parts.push(`<text x="${x0 + 16 + o * 14}" y="90" font-size="3.6" text-anchor="middle">${letter}</text>`));
  }
  for (const b of bubbles()) {
    const filled = !empty && answers[b.question - 1] === b.option;
    parts.push(`<circle cx="${b.cx}" cy="${b.cy}" r="${BUBBLE.radius}" fill="${filled ? '#000' : 'none'}" stroke="#000" stroke-width="0.4"/>`);
    if (b.option === 0) parts.push(`<text x="${b.cx - 13}" y="${b.cy + 1.4}" font-size="4" text-anchor="end">${b.question}</text>`);
  }
  if (spec.note) parts.push(`<text x="24" y="270" font-size="3.4" fill="#b91c1c">${spec.note}</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

async function pdfFor(spec: SheetSpec, payload: string, empty: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([SHEET.width * MM_TO_PT, SHEET.height * MM_TO_PT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const X = (mm: number) => mm * MM_TO_PT;
  const Y = (mm: number) => (SHEET.height - mm) * MM_TO_PT;
  const black = rgb(0, 0, 0);
  for (const r of bracketRects().filter((_, i) => i !== spec.omitMarker).flat()) {
    page.drawRectangle({ x: X(r.x), y: Y(r.y + r.h), width: X(r.w), height: X(r.h), color: black });
  }
  const { dark, cell } = qrModules(payload);
  for (const m of dark) {
    page.drawRectangle({ x: X(m.x), y: Y(m.y + cell), width: X(cell), height: X(cell), color: black });
  }
  const L = labelsFor(spec);
  page.drawText(L.title, { x: X(24), y: Y(26), size: 7 * MM_TO_PT, font: bold });
  page.drawText(L.sub, { x: X(24), y: Y(34), size: 4.5 * MM_TO_PT, font });
  page.drawText(L.name, { x: X(24), y: Y(52), size: 4.5 * MM_TO_PT, font });
  page.drawText(L.id, { x: X(24), y: Y(60), size: 4.5 * MM_TO_PT, font });
  page.drawText(L.note, { x: X(24), y: Y(72), size: 3.2 * MM_TO_PT, font, color: rgb(0.27, 0.27, 0.27) });
  const answers = mockAnswers(payload);
  [30, 120].forEach((x0) =>
    ['A', 'B', 'C', 'D'].forEach((letter, o) =>
      page.drawText(letter, { x: X(x0 + 16 + o * 14) - font.widthOfTextAtSize(letter, 3.6 * MM_TO_PT) / 2, y: Y(90 + 1.2), size: 3.6 * MM_TO_PT, font }),
    ),
  );
  for (const b of bubbles()) {
    const filled = !empty && answers[b.question - 1] === b.option;
    page.drawCircle({ x: X(b.cx), y: Y(b.cy), size: X(BUBBLE.radius), borderColor: black, borderWidth: 0.4 * MM_TO_PT, color: filled ? black : undefined });
    if (b.option === 0) {
      const t = String(b.question);
      page.drawText(t, { x: X(b.cx - 13) - font.widthOfTextAtSize(t, 4 * MM_TO_PT), y: Y(b.cy + 1.4), size: 4 * MM_TO_PT, font });
    }
  }
  if (spec.note) page.drawText(spec.note, { x: X(24), y: Y(270), size: 3.4 * MM_TO_PT, font, color: rgb(0.73, 0.11, 0.11), maxWidth: X(160) });
  return doc.save();
}

function indexHtml(empty: boolean): string {
  const heading = empty ? 'Empty answer sheets' : 'Mock answer sheets';
  const cards = SPECS.map((s) => {
    const payload = sheetPayload(s.assessment, s.form, s.studentId);
    return `<section>
  <h2>${s.student} <small>${s.file === 'sheet-bad-missing-marker' ? '(bad sheet)' : ''}</small></h2>
  <p>QR: <code>${payload}</code>${s.note ? `<br><em>${s.note}</em>` : ''}</p>
  <p><a href="${s.file}.pdf">PDF</a> &middot; <a href="${s.file}.png">PNG</a> &middot; <a href="${s.file}.svg">SVG</a></p>
  <a href="${s.file}.png"><img src="${s.file}.png" alt="${heading} - ${empty ? 'blank' : 'filled'} sheet for ${s.student}" loading="lazy"></a>
</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#e5e7eb;color:#111}
section{max-width:720px;margin:0 auto 32px;background:#fff;padding:16px;border-radius:8px}
img{width:100%;border:1px solid #ccc}
h1{max-width:720px;margin:0 auto 8px}
.intro{max-width:720px;margin:0 auto 24px}
</style></head><body>
<h1>${heading}</h1>
<p class="intro">${empty ? 'No bubbles are filled in. Print one and mark it by hand to test real answers.' : 'Open one on a screen (turn the brightness up, avoid glare) or print it, then point the scanner app at it.'} Each sheet has four L-shaped corner brackets and a QR code naming the assessment, form and student. ${empty ? '<a href="../sheets/">Sheets with answers filled in</a>' : '<a href="../empty-sheets/">Empty sheets</a>'} &middot; <a href="../">Back to the scanner</a></p>
${cards}
</body></html>`;
}

async function main() {
  for (const { dir, empty } of VARIANTS) {
    const out = join(PUBLIC, dir);
    mkdirSync(out, { recursive: true });
    for (const spec of SPECS) {
      const payload = sheetPayload(spec.assessment, spec.form, spec.studentId);
      const svg = svgFor(spec, payload, empty);
      writeFileSync(join(out, `${spec.file}.svg`), svg);
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1654 }, background: '#ffffff', font: { loadSystemFonts: true } })
        .render()
        .asPng();
      writeFileSync(join(out, `${spec.file}.png`), png);
      writeFileSync(join(out, `${spec.file}.pdf`), await pdfFor(spec, payload, empty));
      console.log(`${dir}/${spec.file}: ${payload}`);
    }
    writeFileSync(join(out, 'index.html'), indexHtml(empty));
    console.log(`Wrote ${SPECS.length} sheets to ${out}`);
  }
}

void main();
