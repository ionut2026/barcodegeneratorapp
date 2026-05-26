// Print format definitions and overflow detection for label/page printing.
// All calculations preserve exact barcode mil-size — no scaling is ever applied.

export type PrintFormatId =
  | 'label-100x50'
  | 'label-40x21'
  | 'label-100x50-page'
  | 'label-40x21-page'
  | 'a4-page'
  | 'label-70x35-sheet'
  | 'label-70x25-sheet';

// Layout mode for the generated PDF:
//  - 'a4-grid'        → PDF page is A4; barcodes stacked/gridded inside,
//                       optionally with a label-sized rectangle drawn around each.
//  - 'page-per-label' → PDF page itself matches the label dimensions; one
//                       barcode per page, centred. Required for label printers
//                       loaded with continuous 100×50 / 40×21 mm rolls that
//                       choke on A4 page sizing.
//  - 'a4-label-sheet' → PDF page is A4; labels are placed in a fixed grid
//                       (sheetCols × sheetRows), edge-to-edge, with exact top
//                       and side margins. Barcode centred inside each label cell.
export type PrintLayoutMode = 'a4-grid' | 'page-per-label' | 'a4-label-sheet';

export interface PrintFormat {
  id: PrintFormatId;
  label: string;
  description: string;
  /** Label cell width in mm (also the column width for a4-label-sheet). */
  widthMm: number;
  /** Label cell height in mm (also the row height for a4-label-sheet). */
  heightMm: number;
  /** Inner margin within each label cell used when centering the barcode. */
  marginMm: number;
  mode: PrintLayoutMode;
  /** Number of label columns on the sheet (a4-label-sheet only). */
  sheetCols?: number;
  /** Number of label rows on the sheet (a4-label-sheet only). */
  sheetRows?: number;
  /** Top (and mirrored bottom) page margin in mm (a4-label-sheet only). */
  sheetTopMarginMm?: number;
  /**
   * Upward correction applied to every barcode within its label cell (mm,
   * a4-label-sheet only).  Use this to compensate when the printer's
   * hardware non-printable top margin is larger than the label sheet's
   * physical top margin, causing barcodes to appear too low on the label.
   * Formula: printerHardwareMarginMm − labelSheetTopMarginMm.
   * Clamped so the barcode never renders above the cell boundary.
   */
  sheetBarcodeOffsetMm?: number;
  /**
   * Rightward correction applied to every barcode within its label cell (mm,
   * a4-label-sheet only).  Use this to compensate when the printer's
   * hardware non-printable left margin shifts content leftward on the page.
   */
  sheetHorizontalOffsetMm?: number;
  /**
   * When true, draw a thin border around every label cell on the printed
   * sheet (a4-label-sheet only). Useful for visually verifying that
   * barcodes are centred within their cells for a given label size.
   */
  showGrid?: boolean;
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
    label: '40 × 21 mm Label Sheet',
    description: '5 × 14 grid on A4 · print at Actual Size (100%)',
    widthMm: 40,
    heightMm: 21,
    marginMm: 1.5,
    mode: 'a4-label-sheet',
    sheetCols: 5,
    sheetRows: 14,
    sheetTopMarginMm: -13,
    sheetBarcodeOffsetMm: 0,
    sheetHorizontalOffsetMm: 5.5,
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
  'label-70x35-sheet': {
    id: 'label-70x35-sheet',
    label: '70 × 35 mm Label Sheet',
    description: '3 × 8 grid on A4 · print at Actual Size (100%)',
    widthMm: 70,
    heightMm: 35,
    marginMm: 2,
    mode: 'a4-label-sheet',
    sheetCols: 3,
    sheetRows: 8,
    sheetTopMarginMm: -10,
    sheetBarcodeOffsetMm: 0,
    sheetHorizontalOffsetMm: 3,
  },
  'label-70x25-sheet': {
    id: 'label-70x25-sheet',
    label: '70 × 25 mm Label Sheet',
    description: '3 × 8 grid on A4 · print at Actual Size (100%)',
    widthMm: 70,
    heightMm: 25,
    marginMm: 2,
    mode: 'a4-label-sheet',
    sheetCols: 3,
    sheetRows: 8,
    sheetTopMarginMm: -13,
    sheetBarcodeOffsetMm: 0,
    sheetHorizontalOffsetMm: 5.5,
  },
};

export const PRINT_FORMATS: PrintFormat[] = Object.values(PRINT_FORMAT_REGISTRY);

/**
 * Build a PrintFormat object from a user-defined print profile.
 * This bypasses the static PRINT_FORMAT_REGISTRY and constructs a format
 * usable by generatePrintPdf() directly.
 */
export function buildPrintFormat(profile: {
  id: string;
  label: string;
  description?: string;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  mode: PrintLayoutMode;
  sheetCols?: number;
  sheetRows?: number;
  // New directional offsets (preferred)
  offsetTopMm?: number;
  offsetBottomMm?: number;
  offsetLeftMm?: number;
  offsetRightMm?: number;
  // Legacy fields (backward-compat)
  sheetTopMarginMm?: number;
  sheetBarcodeOffsetMm?: number;
  sheetHorizontalOffsetMm?: number;
  // Visualization
  showGrid?: boolean;
}): PrintFormat {
  // Map directional offsets → internal PrintFormat fields.
  // Top offset → sheetTopMarginMm (grid vertical position).
  // Right minus Left → sheetHorizontalOffsetMm (net horizontal shift).
  // Legacy fields used as fallback when directional offsets are absent.
  const hasDirectional = profile.offsetTopMm !== undefined || profile.offsetLeftMm !== undefined || profile.offsetRightMm !== undefined;

  const topMargin = hasDirectional
    ? (profile.offsetTopMm ?? 0)
    : profile.sheetTopMarginMm;

  const horizontalOffset = hasDirectional
    ? (profile.offsetRightMm ?? 0) - (profile.offsetLeftMm ?? 0)
    : profile.sheetHorizontalOffsetMm;

  return {
    id: profile.id as PrintFormatId,
    label: profile.label,
    description: profile.description ?? 'Custom print profile',
    widthMm: profile.widthMm,
    heightMm: profile.heightMm,
    marginMm: profile.marginMm,
    mode: profile.mode,
    sheetCols: profile.sheetCols,
    sheetRows: profile.sheetRows,
    sheetTopMarginMm: topMargin,
    // NOTE: offsetBottomMm is intentionally NOT mapped to sheetBarcodeOffsetMm.
    // sheetBarcodeOffsetMm is an internal printer-calibration field that shifts
    // barcodes UPWARD within their cell — wiring offsetBottomMm to it caused
    // every barcode to render above cell-centre (visible centering bug).
    // Bottom offset is now treated as informational only; the row grid already
    // stacks from the top, so the bottom margin is implicit (pageH − topMargin
    // − rows·labelH). Legacy fallback is preserved for old saved profiles.
    sheetBarcodeOffsetMm: hasDirectional ? 0 : profile.sheetBarcodeOffsetMm,
    sheetHorizontalOffsetMm: horizontalOffset,
    showGrid: profile.showGrid,
  };
}

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
// top-left coordinates and the original draw dimensions.
//
// IMPORTANT: this helper never scales the image. Callers must verify the
// barcode fits using checkBarcodeFit() before calling generatePrintPdf().
// Scaling would shrink bar widths below the configured X-dimension and
// silently break scannability — by policy we let the print fail loudly
// (or refuse it upstream) instead.
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
  const drawW = imgWmm;
  const drawH = imgHmm;
  const x = rectX + (rectW - drawW) / 2;
  const y = rectY + margin + (innerH - reserveBottomMm - drawH) / 2;
  // innerW is unused here (kept for symmetry / future use); reference it so
  // the linter doesn't flag the parameter.
  void innerW;
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

  // ── Mode: a4-label-sheet ────────────────────────────────────────────────
  // Fixed grid of label cells on an A4 page (e.g. 3 cols × 8 rows).
  // Labels are placed edge-to-edge; top margin is sheetTopMarginMm. The left
  // margin is derived from the label width so the grid is centred on the page.
  if (format.mode === 'a4-label-sheet') {
    const pageW = 210;
    const pageH = 297;
    const cols = format.sheetCols ?? 3;
    const rows = format.sheetRows ?? 8;
    const topMargin = format.sheetTopMarginMm ?? 10;
    const labelW = format.widthMm;
    const labelH = format.heightMm;
    const cellMargin = format.marginMm;
    // Centre the column block horizontally on the A4 page.
    const leftMargin = (pageW - cols * labelW) / 2;

    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
    });

    const perPage = cols * rows;
    const totalPages = Math.ceil(items.length / perPage);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage('a4', 'portrait');

      // Optional: draw a thin border around every cell on this page so the
      // user can visually verify that each barcode is centred inside its
      // label area. Drawn first so barcodes overlay the lines cleanly.
      if (format.showGrid) {
        pdf.setDrawColor(150);
        pdf.setLineWidth(0.1);
        for (let slot = 0; slot < perPage; slot++) {
          const col = slot % cols;
          const row = Math.floor(slot / cols);
          const cellX = leftMargin + col * labelW;
          const cellY = topMargin + row * labelH;
          // Clip cells that fall outside the printable A4 page (e.g. when
          // sheetTopMarginMm is negative for printer calibration).
          if (cellY + labelH <= 0 || cellY >= pageH) continue;
          pdf.rect(cellX, cellY, labelW, labelH);
        }
      }

      for (let slot = 0; slot < perPage; slot++) {
        const idx = page * perPage + slot;
        if (idx >= items.length) break;

        const col = slot % cols;
        const row = Math.floor(slot / cols);

        const item = items[idx];
        const imgWmm = item.widthPx * 25.4 / item.dpi;
        const imgHmm = item.heightPx * 25.4 / item.dpi;

        const cellX = leftMargin + col * labelW;
        const cellY = topMargin + row * labelH;

        // Centre the barcode within the cell at its ORIGINAL configured
        // physical size. We intentionally never scale here: shrinking the
        // image would reduce the X-dimension (bar width) below the
        // configured value and silently degrade scannability. Callers must
        // pre-flight with checkBarcodeFit() and refuse the print if the
        // barcode is larger than the label cell.
        const { x, y: centeredY, drawW, drawH } = fitInsideRect(
          imgWmm,
          imgHmm,
          cellX,
          cellY,
          labelW,
          labelH,
          cellMargin,
          item.label ? labelTextH : 0,
        );

        // Apply printer calibration offsets:
        // Vertical: the grid is positioned via negative sheetTopMarginMm to
        // pre-compensate for the printer's hardware top margin. The normal
        // centering math within cells then produces the correct physical
        // position. Clamp at y=0 (page boundary) — not cellY — because with
        // negative sheetTopMarginMm, row 0's cellY is negative but the
        // barcode content must stay within the printable page.
        const upwardOffset = format.sheetBarcodeOffsetMm ?? 0;
        const y = Math.max(0, centeredY - upwardOffset);

        // Horizontal: shift barcode rightward to correct for the printer's
        // hardware left margin shifting content leftward on the page.
        const rightOffset = format.sheetHorizontalOffsetMm ?? 0;
        const xFinal = x + rightOffset;

        pdf.addImage(item.dataUrl, 'PNG', xFinal, y, drawW, drawH);

        if (item.label) {
          pdf.setFontSize(7);
          pdf.setFont('courier');
          pdf.setTextColor(0);
          // Position text below barcode, clamped within the page.
          const textY = Math.max(0, y + drawH + 3.5);
          pdf.text(item.label, cellX + labelW / 2 + rightOffset, textY, { align: 'center' });
        }
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
        const innerH = rectH - 2 * rectMargin;

        // Draw the barcode at its exact physical mm size — never scale.
        // The pre-flight checkBarcodeFit() call upstream is responsible for
        // refusing prints that would overflow.
        const drawW = imgWmm;
        const drawH = imgHmm;

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
