import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PRINT_FORMAT_REGISTRY,
  PRINT_FORMATS,
  checkBarcodeFit,
  generatePageCSS,
  generatePrintPdf,
  PrintFormatId,
} from './printFormats';

describe('printFormats', () => {
  describe('PRINT_FORMAT_REGISTRY', () => {
    it('contains all seven format IDs', () => {
      const ids: PrintFormatId[] = [
        'label-100x50',
        'label-40x21',
        'label-100x50-page',
        'label-40x21-page',
        'a4-page',
        'label-70x35-sheet',
        'label-70x25-sheet',
      ];
      for (const id of ids) {
        expect(PRINT_FORMAT_REGISTRY[id]).toBeDefined();
        expect(PRINT_FORMAT_REGISTRY[id].id).toBe(id);
      }
    });

    it('PRINT_FORMATS list matches registry values', () => {
      expect(PRINT_FORMATS).toHaveLength(7);
      for (const f of PRINT_FORMATS) {
        expect(PRINT_FORMAT_REGISTRY[f.id]).toBe(f);
      }
    });

    it('legacy label / a4 entries use correct layout modes', () => {
      expect(PRINT_FORMAT_REGISTRY['label-100x50'].mode).toBe('a4-grid');
      expect(PRINT_FORMAT_REGISTRY['label-40x21'].mode).toBe('a4-label-sheet');
      expect(PRINT_FORMAT_REGISTRY['a4-page'].mode).toBe('a4-grid');
    });

    it('page-sized label entries use page-per-label layout mode and exact dimensions', () => {
      const p100 = PRINT_FORMAT_REGISTRY['label-100x50-page'];
      expect(p100.mode).toBe('page-per-label');
      expect(p100.widthMm).toBe(100);
      expect(p100.heightMm).toBe(50);

      const p40 = PRINT_FORMAT_REGISTRY['label-40x21-page'];
      expect(p40.mode).toBe('page-per-label');
      expect(p40.widthMm).toBe(40);
      expect(p40.heightMm).toBe(21);
    });

    it('70×35 sheet format uses a4-label-sheet mode with correct grid and dimensions', () => {
      const f = PRINT_FORMAT_REGISTRY['label-70x35-sheet'];
      expect(f.mode).toBe('a4-label-sheet');
      expect(f.widthMm).toBe(70);
      expect(f.heightMm).toBe(35);
      expect(f.sheetCols).toBe(3);
      expect(f.sheetRows).toBe(8);
      expect(f.sheetTopMarginMm).toBe(-10);
      expect(f.sheetBarcodeOffsetMm).toBe(0);
      expect(f.sheetHorizontalOffsetMm).toBe(3);
    });

    it('70×25 sheet format uses a4-label-sheet mode with correct grid and dimensions', () => {
      const f = PRINT_FORMAT_REGISTRY['label-70x25-sheet'];
      expect(f.mode).toBe('a4-label-sheet');
      expect(f.widthMm).toBe(70);
      expect(f.heightMm).toBe(25);
      expect(f.sheetCols).toBe(3);
      expect(f.sheetRows).toBe(8);
      expect(f.sheetTopMarginMm).toBe(-13);
      expect(f.sheetBarcodeOffsetMm).toBe(0);
      expect(f.sheetHorizontalOffsetMm).toBe(5.5);
    });

    it('40×21 sheet format uses a4-label-sheet mode with correct grid and dimensions', () => {
      const f = PRINT_FORMAT_REGISTRY['label-40x21'];
      expect(f.mode).toBe('a4-label-sheet');
      expect(f.widthMm).toBe(40);
      expect(f.heightMm).toBe(21);
      expect(f.sheetCols).toBe(5);
      expect(f.sheetRows).toBe(14);
      expect(f.sheetTopMarginMm).toBe(-13);
      expect(f.sheetBarcodeOffsetMm).toBe(0);
      expect(f.sheetHorizontalOffsetMm).toBe(5.5);
    });
  });

  describe('checkBarcodeFit', () => {
    const label100x50 = PRINT_FORMAT_REGISTRY['label-100x50'];
    const label40x21 = PRINT_FORMAT_REGISTRY['label-40x21'];
    const a4 = PRINT_FORMAT_REGISTRY['a4-page'];

    it('barcode that fits within 100x50 label', () => {
      // 50mm wide barcode at 300 DPI = 50 * 300 / 25.4 ≈ 591 px
      const widthPx = 591;
      const heightPx = 200;
      const result = checkBarcodeFit(widthPx, heightPx, 300, label100x50);
      expect(result.fits).toBe(true);
      expect(result.overflowWidthMm).toBe(0);
      expect(result.overflowHeightMm).toBe(0);
      // Printable area is 96 x 46 mm
      expect(result.printableWidthMm).toBe(96);
      expect(result.printableHeightMm).toBe(46);
    });

    it('barcode that exceeds 40x21 label width', () => {
      // 50mm wide barcode at 300 DPI ≈ 591 px, label printable = 37mm
      const widthPx = 591;
      const heightPx = 100;
      const result = checkBarcodeFit(widthPx, heightPx, 300, label40x21);
      expect(result.fits).toBe(false);
      expect(result.overflowWidthMm).toBeGreaterThan(0);
    });

    it('barcode that exceeds 40x21 label height', () => {
      // 20mm tall barcode at 300 DPI ≈ 236 px, label printable height = 18mm
      const heightPx = 236;
      const widthPx = 100;
      const result = checkBarcodeFit(widthPx, heightPx, 300, label40x21);
      expect(result.fits).toBe(false);
      expect(result.overflowHeightMm).toBeGreaterThan(0);
    });

    it('barcode that exactly fits printable area', () => {
      // 96mm at 300 DPI = 96 * 300 / 25.4 = 1133.858... px
      // px * 25.4 / 300 should be <= 96mm
      const widthPx = Math.floor(96 * 300 / 25.4);
      const heightPx = Math.floor(46 * 300 / 25.4);
      const result = checkBarcodeFit(widthPx, heightPx, 300, label100x50);
      expect(result.fits).toBe(true);
    });

    it('computes mm from pixels correctly (no scaling factor)', () => {
      const widthPx = 600;
      const heightPx = 300;
      const dpi = 300;
      const result = checkBarcodeFit(widthPx, heightPx, dpi, a4);
      expect(result.barcodeWidthMm).toBeCloseTo(600 * 25.4 / 300, 5);
      expect(result.barcodeHeightMm).toBeCloseTo(300 * 25.4 / 300, 5);
    });

    it('A4 has correct printable area', () => {
      const result = checkBarcodeFit(1, 1, 300, a4);
      expect(result.printableWidthMm).toBe(190);
      expect(result.printableHeightMm).toBe(277);
    });
  });

  describe('generatePageCSS', () => {
    it('generates label-sized @page for 100x50', () => {
      const css = generatePageCSS(PRINT_FORMAT_REGISTRY['label-100x50']);
      expect(css).toBe('@page { size: 100mm 50mm; margin: 2mm; }');
    });

    it('generates label-sized @page for 40x21', () => {
      const css = generatePageCSS(PRINT_FORMAT_REGISTRY['label-40x21']);
      expect(css).toBe('@page { size: 40mm 21mm; margin: 1.5mm; }');
    });

    it('generates A4 @page', () => {
      const css = generatePageCSS(PRINT_FORMAT_REGISTRY['a4-page']);
      expect(css).toBe('@page { size: A4; margin: 10mm; }');
    });
  });

  describe('generatePrintPdf — page-per-label mode', () => {
    interface JsPdfMockInstance {
      addPage: ReturnType<typeof vi.fn>;
      addImage: ReturnType<typeof vi.fn>;
      setDrawColor: ReturnType<typeof vi.fn>;
      setLineWidth: ReturnType<typeof vi.fn>;
      rect: ReturnType<typeof vi.fn>;
      setFontSize: ReturnType<typeof vi.fn>;
      setFont: ReturnType<typeof vi.fn>;
      setTextColor: ReturnType<typeof vi.fn>;
      text: ReturnType<typeof vi.fn>;
      output: ReturnType<typeof vi.fn>;
    }
    const constructorCalls: unknown[][] = [];
    let lastInstance: JsPdfMockInstance | null = null;

    beforeEach(() => {
      constructorCalls.length = 0;
      lastInstance = null;
      vi.resetModules();
      vi.doMock('jspdf', () => {
        class JsPDFMock {
          addPage = vi.fn();
          addImage = vi.fn();
          setDrawColor = vi.fn();
          setLineWidth = vi.fn();
          rect = vi.fn();
          setFontSize = vi.fn();
          setFont = vi.fn();
          setTextColor = vi.fn();
          text = vi.fn();
          output = vi.fn(() => new ArrayBuffer(8));
          constructor(opts: unknown) {
            constructorCalls.push([opts]);
            lastInstance = this as unknown as JsPdfMockInstance;
          }
        }
        return { jsPDF: JsPDFMock };
      });

      // Stub window.open + URL.createObjectURL so deliverPdf's browser
      // fallback path doesn't blow up under jsdom.
      vi.spyOn(window, 'open').mockImplementation(() => null);
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:fake') as typeof URL.createObjectURL;
      const realRevoke = URL.revokeObjectURL;
      URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
      // Restore after each test via a registered cleanup.
      // (vitest runs beforeEach fresh anyway, but be tidy.)
      void realCreate;
      void realRevoke;
    });

    const item = (label?: string) => ({
      dataUrl: 'data:image/png;base64,AAAA',
      widthPx: 600,
      heightPx: 200,
      dpi: 300,
      label,
    });

    it('creates jsPDF with page dimensions matching the label (100x50, landscape)', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-100x50-page'];
      await gen([item('A')], fmt);

      expect(constructorCalls).toHaveLength(1);
      const opts = constructorCalls[0][0] as { unit: string; format: number[]; orientation: string };
      expect(opts.unit).toBe('mm');
      expect(opts.format).toEqual([100, 50]);
      // 100>=50 → landscape so jsPDF doesn't swap to a 50×100 portrait page
      expect(opts.orientation).toBe('landscape');
    });

    it('creates jsPDF with page dimensions matching the label (40x21, landscape)', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-40x21-page'];
      await gen([item('A')], fmt);

      const opts = constructorCalls[0][0] as { format: number[]; orientation: string };
      expect(opts.format).toEqual([40, 21]);
      expect(opts.orientation).toBe('landscape');
    });

    it('emits one page per item via addPage with matching orientation', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-100x50-page'];
      await gen([item('A'), item('B'), item('C')], fmt);

      expect(lastInstance).not.toBeNull();
      // 3 items → first page from constructor + 2 addPage calls
      expect(lastInstance!.addPage).toHaveBeenCalledTimes(2);
      for (const call of lastInstance!.addPage.mock.calls) {
        expect(call[0]).toEqual([100, 50]);
        expect(call[1]).toBe('landscape');
      }
      expect(lastInstance!.addImage).toHaveBeenCalledTimes(3);
    });

    it('does not draw label rectangles in page-per-label mode', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-100x50-page'];
      await gen([item('A'), item('B')], fmt);

      expect(lastInstance!.rect).not.toHaveBeenCalled();
    });

    it('a4-grid mode (regression): still creates an a4 portrait jsPDF', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-100x50'];
      await gen([item('A')], fmt);

      const opts = constructorCalls[0][0] as { format: string; orientation: string };
      expect(opts.format).toBe('a4');
      expect(opts.orientation).toBe('portrait');
    });
  });

  describe('generatePrintPdf — a4-label-sheet mode', () => {
    interface JsPdfMockInstance {
      addPage: ReturnType<typeof vi.fn>;
      addImage: ReturnType<typeof vi.fn>;
      setDrawColor: ReturnType<typeof vi.fn>;
      setLineWidth: ReturnType<typeof vi.fn>;
      rect: ReturnType<typeof vi.fn>;
      setFontSize: ReturnType<typeof vi.fn>;
      setFont: ReturnType<typeof vi.fn>;
      setTextColor: ReturnType<typeof vi.fn>;
      text: ReturnType<typeof vi.fn>;
      output: ReturnType<typeof vi.fn>;
    }
    const constructorCalls: unknown[][] = [];
    let lastInstance: JsPdfMockInstance | null = null;

    beforeEach(() => {
      constructorCalls.length = 0;
      lastInstance = null;
      vi.resetModules();
      vi.doMock('jspdf', () => {
        class JsPDFMock {
          addPage = vi.fn();
          addImage = vi.fn();
          setDrawColor = vi.fn();
          setLineWidth = vi.fn();
          rect = vi.fn();
          setFontSize = vi.fn();
          setFont = vi.fn();
          setTextColor = vi.fn();
          text = vi.fn();
          output = vi.fn(() => new ArrayBuffer(8));
          constructor(opts: unknown) {
            constructorCalls.push([opts]);
            lastInstance = this as unknown as JsPdfMockInstance;
          }
        }
        return { jsPDF: JsPDFMock };
      });

      vi.spyOn(window, 'open').mockImplementation(() => null);
      URL.createObjectURL = vi.fn(() => 'blob:fake') as typeof URL.createObjectURL;
      URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    });

    const item = (label?: string) => ({
      dataUrl: 'data:image/png;base64,AAAA',
      widthPx: 400,
      heightPx: 150,
      dpi: 300,
      label,
    });

    it('creates an A4 portrait jsPDF for a4-label-sheet format', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-70x35-sheet'];
      await gen([item()], fmt);

      const opts = constructorCalls[0][0] as { format: string; orientation: string };
      expect(opts.format).toBe('a4');
      expect(opts.orientation).toBe('portrait');
    });

    it('does not draw border rectangles in a4-label-sheet mode', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-70x35-sheet'];
      await gen([item(), item(), item()], fmt);

      expect(lastInstance!.rect).not.toHaveBeenCalled();
    });

    it('places 24 items on one page before adding a second page (3×8 grid)', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-70x35-sheet'];
      const items = Array.from({ length: 25 }, (_, i) => item(`L${i}`));
      await gen(items, fmt);

      expect(lastInstance!.addPage).toHaveBeenCalledTimes(1);
      expect(lastInstance!.addImage).toHaveBeenCalledTimes(25);
    });

    it('centres the label grid horizontally with rightward offset applied', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-70x35-sheet']; // sheetHorizontalOffsetMm = 3
      await gen([item()], fmt);

      // addImage(dataUrl, 'PNG', x, y, ...) → x is at index 2
      const xArg = lastInstance!.addImage.mock.calls[0][2] as number;
      // col=0 → centredX = (210-3*70)/2 + (70 - 33.87)/2 ≈ 18.06
      // + horizontalOffset(3) = ≈21.06
      const imgWmm = 400 * 25.4 / 300;
      const expectedX = (70 - imgWmm) / 2 + 3;
      expect(xArg).toBeCloseTo(expectedX, 1);
    });

    it('70×25 sheet: addImage is called with correct dimensions', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-70x25-sheet'];
      await gen([item()], fmt);

      expect(lastInstance!.addImage).toHaveBeenCalledTimes(1);
      // drawW and drawH match the item's physical mm size
      const [,, , , drawW, drawH] = lastInstance!.addImage.mock.calls[0];
      expect(drawW).toBeCloseTo(400 * 25.4 / 300, 1); // ≈33.87mm
      expect(drawH).toBeCloseTo(150 * 25.4 / 300, 1); // ≈12.7mm
    });

    it('negative sheetTopMarginMm positions barcode correctly (not clamped for 70×35)', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-70x35-sheet']; // sheetTopMarginMm = -10
      // item: 400×150 px at 300 dpi → imgHmm = 12.7mm
      await gen([item()], fmt);

      const yArg = lastInstance!.addImage.mock.calls[0][3] as number;
      // cellY = -10, centeredY = -10 + 2 + (31 - 12.7)/2 = 1.15mm
      // y = max(0, 1.15) = 1.15 (NOT clamped — this is the fix)
      expect(yArg).toBeCloseTo(1.15, 1);
      expect(yArg).toBeGreaterThan(0);
    });

    it('clamps at y=0 (page boundary) for small labels where centering would be negative', async () => {
      const { generatePrintPdf: gen } = await import('./printFormats');
      const fmt = PRINT_FORMAT_REGISTRY['label-70x25-sheet']; // sheetTopMarginMm = -10
      // Large barcode on small label: 400×150 px at 300 dpi → imgH = 12.7mm
      // centeredY = -10 + 2 + (21-12.7)/2 = -3.85 → clamps to 0
      await gen([item()], fmt);

      const yArg = lastInstance!.addImage.mock.calls[0][3] as number;
      expect(yArg).toBe(0);
    });
  });

  describe('buildPrintFormat', () => {
    it('returns a PrintFormat with all fields mapped', async () => {
      const { buildPrintFormat } = await import('./printFormats');
      const format = buildPrintFormat({
        id: 'custom-test',
        label: 'Custom 50×30',
        description: 'My custom label',
        widthMm: 50,
        heightMm: 30,
        marginMm: 3,
        mode: 'page-per-label',
      });
      expect(format.id).toBe('custom-test');
      expect(format.label).toBe('Custom 50×30');
      expect(format.description).toBe('My custom label');
      expect(format.widthMm).toBe(50);
      expect(format.heightMm).toBe(30);
      expect(format.marginMm).toBe(3);
      expect(format.mode).toBe('page-per-label');
    });

    it('uses default description when not provided', async () => {
      const { buildPrintFormat } = await import('./printFormats');
      const format = buildPrintFormat({
        id: 'no-desc',
        label: 'No Desc',
        widthMm: 100,
        heightMm: 50,
        marginMm: 5,
        mode: 'a4-grid',
      });
      expect(format.description).toBe('Custom print profile');
    });

    it('passes through legacy sheet-specific fields for a4-label-sheet', async () => {
      const { buildPrintFormat } = await import('./printFormats');
      const format = buildPrintFormat({
        id: 'sheet-custom',
        label: 'Sheet Custom',
        widthMm: 70,
        heightMm: 35,
        marginMm: 2,
        mode: 'a4-label-sheet',
        sheetCols: 3,
        sheetRows: 8,
        sheetTopMarginMm: -10,
        sheetBarcodeOffsetMm: 1,
        sheetHorizontalOffsetMm: 3,
      });
      expect(format.sheetCols).toBe(3);
      expect(format.sheetRows).toBe(8);
      expect(format.sheetTopMarginMm).toBe(-10);
      expect(format.sheetBarcodeOffsetMm).toBe(1);
      expect(format.sheetHorizontalOffsetMm).toBe(3);
    });

    it('maps directional offsets to internal fields', async () => {
      const { buildPrintFormat } = await import('./printFormats');
      const format = buildPrintFormat({
        id: 'directional',
        label: 'Directional',
        widthMm: 70,
        heightMm: 25,
        marginMm: 2,
        mode: 'a4-label-sheet',
        sheetCols: 3,
        sheetRows: 8,
        offsetTopMm: -13,
        offsetBottomMm: 2,
        offsetLeftMm: 1,
        offsetRightMm: 5.5,
      });
      // Top offset maps to sheetTopMarginMm
      expect(format.sheetTopMarginMm).toBe(-13);
      // Bottom offset maps to sheetBarcodeOffsetMm
      expect(format.sheetBarcodeOffsetMm).toBe(2);
      // Net horizontal = right - left
      expect(format.sheetHorizontalOffsetMm).toBe(4.5);
    });
  });
});
