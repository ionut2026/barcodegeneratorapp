// Print format definitions and overflow detection for label/page printing.
// All calculations preserve exact barcode mil-size — no scaling is ever applied.

export type PrintFormatId =
  | 'label-100x50'
  | 'label-40x21'
  | 'label-100x50-page'
  | 'label-40x21-page'
  | 'a4-page';

// Layout mode for the generated PDF:
//  - 'a4-grid'        → PDF page is A4; barcodes stacked/gridded inside,
//                       optionally with a label-sized rectangle drawn around each.
//  - 'page-per-label' → PDF page itself matches the label dimensions; one
//                       barcode per page, centred. Required for label printers
//                       loaded with continuous 100×50 / 40×21 mm rolls that
//                       choke on A4 page sizing.
export type PrintLayoutMode = 'a4-grid' | 'page-per-label';

export interface PrintFormat {
  id: PrintFormatId;
  label: string;
  description: string;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  mode: PrintLayoutMode;
}

export const PRINT_FORMAT_REGISTRY: Record<PrintFormatId, PrintFormat> = {
  'label-100x50': {
    id: 'label-100x50',
    label: '100 \u00d7 50 mm Label',
    description: 'Stacked on A4 page',
    widthMm: 100,
    heightMm: 50,
    marginMm: 2,
    mode: 'a4-grid',
  },
  'label-40x21': {
    id: 'label-40x21',
    label: '40 \u00d7 21 mm Label',
    description: 'Stacked on A4 page',
    widthMm: 40,
    heightMm: 21,
    marginMm: 2,
    mode: 'a4-grid',
  },
  'label-100x50-page': {
    id: 'label-100x50-page',
    label: '100 \u00d7 50 mm Label (page-sized)',
    description: 'Single per page \u2014 label printer',
    widthMm: 100,
    heightMm: 50,
    marginMm: 2,
    mode: 'page-per-label',
  },
  'label-40x21-page': {
    id: 'label-40x21-page',
    label: '40 \u00d7 21 mm Label (page-sized)',
    description: 'Single per page \u2014 label printer',
    widthMm: 40,
    heightMm: 21,
    marginMm: 2,
    mode: 'page-per-label',
  },
  'a4-page': {
    id: 'a4-page',
    label: 'A4 Page',
    description: 'Standard A4 printing',
    widthMm: 210,
    heightMm: 297,
    marginMm: 10,
    mode: 'a4-grid',
  },
};

export const PRINT_FORMATS: PrintFormat[] = Object.values(PRINT_FORMAT_REGISTRY);

export interface FitResult {
  fits: boolean;
  barcodeWidthMm: number;
  barcodeHeightMm: number;
  printableWidthMm: number;
  printableHeightMm: number;
  overflowWidthMm: number;
  overflowHeightMm: number;
}

export function checkBarcodeFit(
  barcodeWidthPx: number,
  barcodeHeightPx: number,
  dpi: number,
  format: PrintFormat,
): FitResult {
  const barcodeWidthMm = barcodeWidthPx * 25.4 / dpi;
  const barcodeHeightMm = barcodeHeightPx * 25.4 / dpi;
  const printableWidthMm = format.widthMm - 2 * format.marginMm;
  const printableHeightMm = format.heightMm - 2 * format.marginMm;
  const overflowWidthMm = Math.max(0, barcodeWidthMm - printableWidthMm);
  const overflowHeightMm = Math.max(0, barcodeHeightMm - printableHeightMm);

  return {
    fits: barcodeWidthMm <= printableWidthMm && barcodeHeightMm <= printableHeightMm,
    barcodeWidthMm,
    barcodeHeightMm,
    printableWidthMm,
    printableHeightMm,
    overflowWidthMm,
    overflowHeightMm,
  };
}

export function generatePageCSS(format: PrintFormat): string {
  if (format.id === 'a4-page') {
    return `@page { size: A4; margin: ${format.marginMm}mm; }`;
  }
  return `@page { size: ${format.widthMm}mm ${format.heightMm}mm; margin: ${format.marginMm}mm; }`;
}

// Centre an image of size (drawW × drawH) inside a rectangle starting at
// (rectX, rectY) with size (rectW × rectH) and an inner margin of `margin`,
// optionally reserving `reserveBottomMm` for a text label. Returns the
// top-left coordinates plus the (possibly scaled-down) draw dimensions.
function fitInsideRect(
  imgWmm: number,
  imgHmm: number,
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number,
  margin: number,
  reserveBottomMm: number,
): { x: number; y: number; drawW: number; drawH: number } {
  const innerW = rectW - 2 * margin;
  const innerH = rectH - 2 * margin;
  let drawW = imgWmm;
  let drawH = imgHmm;
  if (drawW > innerW) {
    const s = innerW / drawW;
    drawW *= s;
    drawH *= s;
  }
  if (drawH > innerH - reserveBottomMm) {
    const s = (innerH - reserveBottomMm) / drawH;
    drawW *= s;
    drawH *= s;
  }
  const x = rectX + (rectW - drawW) / 2;
  const y = rectY + margin + (innerH - reserveBottomMm - drawH) / 2;
  return { x, y, drawW, drawH };
}

// ---------------------------------------------------------------------------
// PDF generation via jsPDF — avoids browser @page rotation issues
// ---------------------------------------------------------------------------

export interface PrintItem {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  label?: string;
}

/**
 * Generate a PDF for printing.
 *
 * Two layout modes (selected via `format.mode`):
 *
 * **`'a4-grid'`** — PDF page is always A4 portrait; barcodes are placed
 * inside the page:
 *   - For label formats (100×50, 40×21) one column of label-sized rectangles
 *     is drawn down the page and barcodes are centred inside each rectangle.
 *   - For the A4 format itself, no rectangles are drawn — barcodes are
 *     gridded at their actual mm size.
 *
 * **`'page-per-label'`** — PDF page itself matches the label dimensions
 * (e.g. 100×50 mm). Exactly one barcode per page, centred inside the
 * `marginMm` printable area. This is the mode required by label printers
 * loaded with continuous 100×50 / 40×21 mm rolls — they choke on A4 page
 * sizing.
 *
 * In every case the barcode is rendered at its exact physical mm size; if it
 * exceeds the available area it is scaled down (never up) to fit. jsPDF is
 * imported dynamically to keep it out of the initial bundle.
 */
export async function generatePrintPdf(
  items: PrintItem[],
  format: PrintFormat,
): Promise<void> {
  if (items.length === 0) return;

  const { jsPDF } = await import('jspdf');

  const labelTextH = 5; // space reserved for text label below barcode

  // ── Mode: page-per-label ────────────────────────────────────────────────
  // PDF page itself is the label size. One barcode per page. Pass the
  // dimensions as a [W, H] tuple with orientation: 'portrait' so jsPDF treats
  // them literally (no auto-rotation regardless of W vs H).
  if (format.mode === 'page-per-label') {
    const pageW = format.widthMm;
    const pageH = format.heightMm;
    const margin = format.marginMm;
    // jsPDF swaps the format tuple to match the orientation: 'portrait'
    // forces width <= height, 'landscape' forces width >= height. Pick the
    // orientation that preserves our intended (W × H) so a 100×50 label
    // does not come out as a 50×100 portrait page.
    const orientation: 'portrait' | 'landscape' = pageW >= pageH ? 'landscape' : 'portrait';

    const pdf = new jsPDF({
      unit: 'mm',
      format: [pageW, pageH],
      orientation,
    });

    for (let i = 0; i < items.length; i++) {
      if (i > 0) pdf.addPage([pageW, pageH], orientation);

      const item = items[i];
      const imgWmm = item.widthPx * 25.4 / item.dpi;
      const imgHmm = item.heightPx * 25.4 / item.dpi;

      const { x, y, drawW, drawH } = fitInsideRect(
        imgWmm,
        imgHmm,
        0,
        0,
        pageW,
        pageH,
        margin,
        item.label ? labelTextH : 0,
      );

      pdf.addImage(item.dataUrl, 'PNG', x, y, drawW, drawH);

      if (item.label) {
        pdf.setFontSize(7);
        pdf.setFont('courier');
        pdf.setTextColor(0);
        pdf.text(item.label, pageW / 2, y + drawH + 3.5, { align: 'center' });
      }
    }

    await deliverPdf(pdf);
    return;
  }

  // ── Mode: a4-grid ───────────────────────────────────────────────────────
  // Always use A4 portrait — avoids jsPDF landscape orientation bugs.
  const pageW = 210;
  const pageH = 297;
  const pageMargin = 10;

  const pdf = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: 'portrait',
  });

  const isLabel = format.id !== 'a4-page';

  // Rectangle dimensions for label formats
  const rectW = isLabel ? format.widthMm : 0;
  const rectH = isLabel ? format.heightMm : 0;
  const rectMargin = isLabel ? format.marginMm : 0;

  // Gaps between cells
  const gapX = 4;
  const gapY = 4;

  const printableW = pageW - 2 * pageMargin;
  const printableH = pageH - 2 * pageMargin;

  if (isLabel) {
    // ── Label mode: single column, left-aligned, stacked vertically ──
    const rows = Math.max(1, Math.floor((printableH + gapY) / (rectH + gapY)));

    const totalPages = Math.ceil(items.length / rows);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage('a4', 'portrait');

      for (let row = 0; row < rows; row++) {
        const idx = page * rows + row;
        if (idx >= items.length) break;

        const rectX = pageMargin;
        const cellY = pageMargin + row * (rectH + gapY);

        // Draw label border rectangle
        pdf.setDrawColor(160);
        pdf.setLineWidth(0.3);
        pdf.rect(rectX, cellY, rectW, rectH);

        const item = items[idx];
        const imgWmm = item.widthPx * 25.4 / item.dpi;
        const imgHmm = item.heightPx * 25.4 / item.dpi;

        // Available area inside the rectangle
        const innerW = rectW - 2 * rectMargin;
        const innerH = rectH - 2 * rectMargin;

        // Scale barcode down if it exceeds the rectangle's inner area
        let drawW = imgWmm;
        let drawH = imgHmm;
        if (drawW > innerW) {
          const s = innerW / drawW;
          drawW *= s;
          drawH *= s;
        }
        if (drawH > innerH - labelTextH) {
          const s = (innerH - labelTextH) / drawH;
          drawW *= s;
          drawH *= s;
        }

        // Center barcode inside the rectangle
        const x = rectX + (rectW - drawW) / 2;
        const y = cellY + rectMargin + (innerH - labelTextH - drawH) / 2;

        pdf.addImage(item.dataUrl, 'PNG', x, y, drawW, drawH);

        if (item.label) {
          pdf.setFontSize(7);
          pdf.setFont('courier');
          pdf.setTextColor(0);
          pdf.text(item.label, rectX + rectW / 2, y + drawH + 3.5, { align: 'center' });
        }
      }
    }
  } else {
    // ── A4 mode: multi-column grid, left-aligned, no rectangles ──
    const firstImgWmm = items[0].widthPx * 25.4 / items[0].dpi;
    const firstImgHmm = items[0].heightPx * 25.4 / items[0].dpi;
    const cellH = firstImgHmm + labelTextH;

    const cols = Math.max(1, Math.floor((printableW + gapX) / (firstImgWmm + gapX)));
    const rows = Math.max(1, Math.floor((printableH + gapY) / (cellH + gapY)));
    const perPage = cols * rows;

    const totalPages = Math.ceil(items.length / perPage);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage('a4', 'portrait');

      for (let slot = 0; slot < perPage; slot++) {
        const idx = page * perPage + slot;
        if (idx >= items.length) break;

        const col = slot % cols;
        const row = Math.floor(slot / cols);

        const item = items[idx];
        const imgWmm = item.widthPx * 25.4 / item.dpi;
        const imgHmm = item.heightPx * 25.4 / item.dpi;

        const x = pageMargin + col * (firstImgWmm + gapX) + (firstImgWmm - imgWmm) / 2;
        const cellY = pageMargin + row * (cellH + gapY);

        pdf.addImage(item.dataUrl, 'PNG', x, cellY, imgWmm, imgHmm);

        if (item.label) {
          pdf.setFontSize(7);
          pdf.setFont('courier');
          pdf.setTextColor(0);
          const labelX = pageMargin + col * (firstImgWmm + gapX) + firstImgWmm / 2;
          pdf.text(item.label, labelX, cellY + imgHmm + 3.5, { align: 'center' });
        }
      }
    }
  }

  // Hand the PDF off for preview.
  await deliverPdf(pdf);
}

// Hand a finished jsPDF document off for preview. In packaged Electron builds
// (file:// origin) blob: URLs cannot reliably be opened in a new BrowserWindow,
// so we write the bytes to a temp file via IPC and let the OS default PDF
// viewer handle it — the user gets a familiar Ctrl+P dialog. In the browser we
// fall back to window.open(blob:) which opens a tab.
async function deliverPdf(pdf: import('jspdf').jsPDF): Promise<void> {
  const openPdf = typeof window !== 'undefined' ? window.electronAPI?.openPdf : undefined;
  if (openPdf) {
    // Send raw bytes via structured clone instead of base64. Avoids a base64
    // encode in jsPDF, a ~33% inflated IPC payload, and a base64 decode in
    // the main process — measurably faster on multi-page batch prints.
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    const fileName = `barcode-${Date.now()}.pdf`;
    const result = await openPdf(bytes, fileName);
    if (!result.ok) {
      // Surface the failure to callers so they can toast; no fallback to
      // window.open here because on file:// origin that path is the one we
      // are specifically working around.
      throw new Error(`Failed to open PDF: ${result.error}`);
    }
    return;
  }

  const pdfBlob = pdf.output('blob');
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
