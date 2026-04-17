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
 * Generate a PDF with one barcode per page for label formats, or a grid for A4.
 * The barcode image is placed at its exact physical mm size — never scaled.
 * Calls jsPDF dynamically to keep the import out of the initial bundle.
 */
export async function generatePrintPdf(
  items: PrintItem[],
  format: PrintFormat,
): Promise<void> {
  if (items.length === 0) return;

  const { jsPDF } = await import('jspdf');

  const pageW = format.widthMm;
  const pageH = format.heightMm;
  const margin = format.marginMm;
  const printableW = pageW - 2 * margin;
  const printableH = pageH - 2 * margin;
  const isLabel = format.id !== 'a4-page';

  // jsPDF page format: [width, height] in mm, landscape when width > height
  const orientation = pageW > pageH ? 'landscape' as const : 'portrait' as const;
  // jsPDF wants [shorter, longer] for the format array regardless of orientation
  const formatArr: [number, number] = pageW > pageH
    ? [pageH, pageW]
    : [pageW, pageH];

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: formatArr,
  });

  if (isLabel) {
    // Label mode: one barcode centered per page
    for (let i = 0; i < items.length; i++) {
      if (i > 0) pdf.addPage(formatArr, orientation);

      const item = items[i];
      const imgWmm = item.widthPx * 25.4 / item.dpi;
      const imgHmm = item.heightPx * 25.4 / item.dpi;

      // Center the barcode on the page (within margins)
      const x = margin + (printableW - imgWmm) / 2;
      const y = margin + (printableH - imgHmm) / 2;

      pdf.addImage(item.dataUrl, 'PNG', x, y, imgWmm, imgHmm);

      if (item.label) {
        pdf.setFontSize(7);
        pdf.setFont('courier');
        pdf.text(item.label, pageW / 2, y + imgHmm + 3, { align: 'center' });
      }
    }
  } else {
    // A4 grid mode: multiple barcodes per page
    const gap = 10;
    const rowGap = 8;
    const labelH = 8;
    const firstItem = items[0];
    const imgWmm = firstItem.widthPx * 25.4 / firstItem.dpi;
    const imgHmm = firstItem.heightPx * 25.4 / firstItem.dpi;

    const cols = Math.max(1, Math.floor((printableW + gap) / (imgWmm + gap)));
    const cellW = (printableW - (cols - 1) * gap) / cols;
    // Scale ratio only used for A4 grid layout — labels never scale
    const scaleRatio = cellW / imgWmm;
    const cellH = imgHmm * scaleRatio + labelH;

    let y = margin;

    items.forEach((item, i) => {
      if (y + cellH > pageH - margin) {
        pdf.addPage(formatArr, orientation);
        y = margin;
      }
      const col = i % cols;
      const x = margin + col * (cellW + gap);
      const itemScaleRatio = cellW / (item.widthPx * 25.4 / item.dpi);
      const itemHmm = (item.heightPx * 25.4 / item.dpi) * itemScaleRatio;

      pdf.addImage(item.dataUrl, 'PNG', x, y, cellW, itemHmm);

      if (item.label) {
        pdf.setFontSize(7);
        pdf.setFont('courier');
        pdf.text(item.label, x + cellW / 2, y + itemHmm + 3, { align: 'center' });
      }

      if (col === cols - 1) y += itemHmm + labelH + rowGap;
    });
  }

  // Open PDF in a new tab for print preview (user can print from there)
  const pdfBlob = pdf.output('blob');
  const url = URL.createObjectURL(pdfBlob);
  window.open(url, '_blank');
  // Clean up after a delay to let the browser tab load
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
