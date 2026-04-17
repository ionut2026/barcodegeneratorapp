// Print format definitions and overflow detection for label/page printing.
// All calculations preserve exact barcode mil-size — no scaling is ever applied.

export type PrintFormatId = 'label-100x50' | 'label-40x21' | 'a4-page';

export interface PrintFormat {
  id: PrintFormatId;
  label: string;
  description: string;
  widthMm: number;
  heightMm: number;
  marginMm: number;
}

export const PRINT_FORMAT_REGISTRY: Record<PrintFormatId, PrintFormat> = {
  'label-100x50': {
    id: 'label-100x50',
    label: '100 \u00d7 50 mm Label',
    description: '300 DPI label printer',
    widthMm: 100,
    heightMm: 50,
    marginMm: 2,
  },
  'label-40x21': {
    id: 'label-40x21',
    label: '40 \u00d7 21 mm Label',
    description: '300 DPI label printer',
    widthMm: 40,
    heightMm: 21,
    marginMm: 2,
  },
  'a4-page': {
    id: 'a4-page',
    label: 'A4 Page',
    description: 'Standard A4 printing',
    widthMm: 210,
    heightMm: 297,
    marginMm: 10,
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
 * Generate a PDF on A4 portrait pages with barcodes stacked vertically,
 * each inside a drawn label-sized rectangle.
 *
 * The selected format controls the **rectangle size** drawn on the page:
 * - 100×50mm label → 100×50mm rectangles
 * - 40×21mm label  → 40×21mm rectangles
 * - A4 page        → no rectangles, barcodes placed at actual size
 *
 * Barcodes are centered inside each rectangle at their exact physical mm
 * size. If a barcode is wider than the rectangle, it is scaled down to fit.
 * Calls jsPDF dynamically to keep the import out of the initial bundle.
 */
export async function generatePrintPdf(
  items: PrintItem[],
  format: PrintFormat,
): Promise<void> {
  if (items.length === 0) return;

  const { jsPDF } = await import('jspdf');

  // Always use A4 portrait — avoids jsPDF landscape orientation bugs
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
  const labelTextH = 5; // space for text below barcode

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

  // Open PDF in a new tab for print preview
  const pdfBlob = pdf.output('blob');
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
