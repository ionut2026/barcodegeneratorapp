import { describe, it, expect } from 'vitest';
import {
  PRINT_FORMAT_REGISTRY,
  PRINT_FORMATS,
  checkBarcodeFit,
  generatePageCSS,
  PrintFormatId,
} from './printFormats';

describe('printFormats', () => {
  describe('PRINT_FORMAT_REGISTRY', () => {
    it('contains all three format IDs', () => {
      const ids: PrintFormatId[] = ['label-100x50', 'label-40x21', 'a4-page'];
      for (const id of ids) {
        expect(PRINT_FORMAT_REGISTRY[id]).toBeDefined();
        expect(PRINT_FORMAT_REGISTRY[id].id).toBe(id);
      }
    });

    it('PRINT_FORMATS list matches registry values', () => {
      expect(PRINT_FORMATS).toHaveLength(3);
      for (const f of PRINT_FORMATS) {
        expect(PRINT_FORMAT_REGISTRY[f.id]).toBe(f);
      }
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
});
