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
    it('contains all five format IDs', () => {
      const ids: PrintFormatId[] = [
        'label-100x50',
        'label-40x21',
        'label-100x50-page',
        'label-40x21-page',
        'a4-page',
      ];
      for (const id of ids) {
        expect(PRINT_FORMAT_REGISTRY[id]).toBeDefined();
        expect(PRINT_FORMAT_REGISTRY[id].id).toBe(id);
      }
    });

    it('PRINT_FORMATS list matches registry values', () => {
      expect(PRINT_FORMATS).toHaveLength(5);
      for (const f of PRINT_FORMATS) {
        expect(PRINT_FORMAT_REGISTRY[f.id]).toBe(f);
      }
    });

    it('legacy label / a4 entries use a4-grid layout mode', () => {
      expect(PRINT_FORMAT_REGISTRY['label-100x50'].mode).toBe('a4-grid');
      expect(PRINT_FORMAT_REGISTRY['label-40x21'].mode).toBe('a4-grid');
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
      // 50mm wide barcode at 300 DPI ≈ 591 px, label printable = 36mm
      const widthPx = 591;
      const heightPx = 100;
      const result = checkBarcodeFit(widthPx, heightPx, 300, label40x21);
      expect(result.fits).toBe(false);
      expect(result.overflowWidthMm).toBeGreaterThan(0);
    });

    it('barcode that exceeds 40x21 label height', () => {
      // 20mm tall barcode at 300 DPI ≈ 236 px, label printable height = 17mm
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
      expect(css).toBe('@page { size: 40mm 21mm; margin: 2mm; }');
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
});
