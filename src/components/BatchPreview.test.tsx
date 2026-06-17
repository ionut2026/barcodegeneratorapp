import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectPngDpi } from '@/lib/barcodeImageGenerator';
import { BarcodeImageResult } from '@/lib/barcodeImageGenerator';

describe('BatchPreview - PNG Download', () => {
  const mockImage: BarcodeImageResult = {
    value: 'TEST123',
    format: 'CODE39',
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    width: 100,
    height: 50,
    widthMm: 25.4,
    heightMm: 12.7,
    formatLabel: 'Code 39',
    checksumLabel: undefined,
  };

  beforeEach(() => {
    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('should inject DPI metadata into PNG data URL', () => {
    const dpi = 300;
    const result = injectPngDpi(mockImage.dataUrl, dpi);
    
    // Should return a data URL
    expect(result).toMatch(/^data:image\/png/);
    // Should include base64 data
    expect(result).toContain('base64,');
  });

  it('should handle different DPI values', () => {
    const dpi300Result = injectPngDpi(mockImage.dataUrl, 300);
    const dpi600Result = injectPngDpi(mockImage.dataUrl, 600);
    
    // Results should both be valid PNG data URLs
    expect(dpi300Result).toMatch(/^data:image\/png/);
    expect(dpi600Result).toMatch(/^data:image\/png/);
    
    // Results should be different (different DPI values)
    expect(dpi300Result).not.toBe(dpi600Result);
  });

  it('should preserve image data when injecting DPI', () => {
    const result = injectPngDpi(mockImage.dataUrl, 300);
    
    // Should produce a valid base64-encoded PNG
    const base64Part = result.split(',')[1];
    expect(base64Part).toBeDefined();
    expect(base64Part?.length).toBeGreaterThan(0);
  });

  it('should not modify non-PNG URLs', () => {
    const jpegUrl = 'data:image/jpeg;base64,test';
    const result = injectPngDpi(jpegUrl, 300);
    
    // Should return the same URL for non-PNG images
    expect(result).toBe(jpegUrl);
  });
});

describe('BatchPreview - Output Size preview scaling', () => {
  // Regression for bug where, at 600 DPI, Medium (s=1) and Large (s=2) bitmaps
  // both exceeded the grid cell width and got clamped to the same rendered size
  // by `max-width: 100%`. After ~5x nearest-neighbor downsampling of the QR
  // pattern, Large looked visually "smaller" (less dense / mangled) than even
  // Small (s=0.5), which rendered at its intrinsic 186px without clamping.
  //
  // Fix: preview width is now driven by `previewScale * PREVIEW_BASE_PX` rather
  // than the natural bitmap pixel count, so the on-screen size is strictly
  // proportional to the selected Output Size preset regardless of DPI.
  it('renders Small/Medium/Large at proportional widths regardless of bitmap DPI', async () => {
    const { render } = await import('@testing-library/react');
    const { BatchPreview } = await import('./BatchPreview');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const img: BarcodeImageResult = { value: 'X', dataUrl: png, width: 1, height: 1, widthMm: 1, heightMm: 1 };

    const widths: Record<string, string> = {};
    for (const [label, scale] of [['Small', 0.5], ['Medium', 1], ['Large', 2]] as const) {
      const { container, unmount } = render(
        <BatchPreview images={[img]} isGenerating={false} actionsDisabled={false} dpi={600} previewScale={scale} />
      );
      const el = container.querySelector('img[alt="X"]') as HTMLImageElement | null;
      widths[label] = el?.style.width ?? '';
      unmount();
    }

    expect(widths.Small).toBe('60px');
    expect(widths.Medium).toBe('120px');
    expect(widths.Large).toBe('240px');
  });

  it('defaults previewScale to 1 when prop omitted', async () => {
    const { render } = await import('@testing-library/react');
    const { BatchPreview } = await import('./BatchPreview');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const img: BarcodeImageResult = { value: 'Y', dataUrl: png, width: 1, height: 1, widthMm: 1, heightMm: 1 };
    const { container } = render(
      <BatchPreview images={[img]} isGenerating={false} actionsDisabled={false} />
    );
    const el = container.querySelector('img[alt="Y"]') as HTMLImageElement | null;
    expect(el?.style.width).toBe('120px');
  });

  // Regression for: "1D barcode display height changes when toggling DPI on
  // Batch screen". The bitmap aspect drifts because `modulePixels` rounds
  // non-linearly while bitmap height is linear in dpiScale. We now compute a
  // `displayAspectRatio` in the renderer that is DPI-invariant, and the
  // preview uses it to compute pixel-stable height.
  it('uses displayAspectRatio to compute stable preview height across DPIs', async () => {
    const { render } = await import('@testing-library/react');
    const { BatchPreview } = await import('./BatchPreview');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Three "renders" of the SAME logical barcode at different DPIs. The raw
    // pixel widths differ (rounding) but the canonical displayAspectRatio is
    // identical, so the on-screen height must be identical too.
    const ASPECT = 100 / 132; // canonical h/w, e.g. CODE128 50 mods, h=100, margin=10, X=7.5mil
    const renders: BarcodeImageResult[] = [
      { value: 'D96',  dataUrl: png, width: 56,  height: 32,  widthMm: 14.8,  heightMm: 8.47, displayAspectRatio: ASPECT },
      { value: 'D300', dataUrl: png, width: 120, height: 100, widthMm: 10.16, heightMm: 8.47, displayAspectRatio: ASPECT },
      { value: 'D600', dataUrl: png, width: 290, height: 200, widthMm: 12.27, heightMm: 8.47, displayAspectRatio: ASPECT },
    ];

    const heights: string[] = [];
    for (const img of renders) {
      const { container, unmount } = render(
        <BatchPreview images={[img]} isGenerating={false} actionsDisabled={false} previewScale={1} />
      );
      const el = container.querySelector(`img[alt="${img.value}"]`) as HTMLImageElement | null;
      heights.push(el?.style.height ?? '');
      unmount();
    }
    // All three heights are identical and derived from previewWidth (120) * aspect
    const expectedHeight = `${Math.round(120 * ASPECT)}px`;
    expect(heights[0]).toBe(expectedHeight);
    expect(heights[1]).toBe(expectedHeight);
    expect(heights[2]).toBe(expectedHeight);
  });

  it('falls back to height:auto when displayAspectRatio is missing (legacy results)', async () => {
    const { render } = await import('@testing-library/react');
    const { BatchPreview } = await import('./BatchPreview');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const img: BarcodeImageResult = { value: 'L', dataUrl: png, width: 1, height: 1, widthMm: 1, heightMm: 1 };
    const { container } = render(
      <BatchPreview images={[img]} isGenerating={false} actionsDisabled={false} />
    );
    const el = container.querySelector('img[alt="L"]') as HTMLImageElement | null;
    expect(el?.style.height).toBe('auto');
  });

  // Regression for: "EAN-2 height too big compared to other symbologies". A
  // narrow tall barcode (aspect > 1) at a fixed preview width would render as a
  // tower (e.g. aspect 2.0 → 240px tall vs ~60px for EAN-13). The height is now
  // capped at PREVIEW_MAX_HEIGHT_RATIO (1×) the preview width, and the width is
  // shrunk proportionally so the aspect ratio is preserved (no distortion).
  it('caps a tall narrow barcode height and shrinks width to preserve aspect', async () => {
    const { render } = await import('@testing-library/react');
    const { BatchPreview } = await import('./BatchPreview');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    // aspect 2.0 (height/width) → ideal height 240px at width 120, exceeds cap.
    const img: BarcodeImageResult = { value: 'EAN2', dataUrl: png, width: 22, height: 44, widthMm: 5, heightMm: 10, displayAspectRatio: 2 };
    const { container } = render(
      <BatchPreview images={[img]} isGenerating={false} actionsDisabled={false} previewScale={1} />
    );
    const el = container.querySelector('img[alt="EAN2"]') as HTMLImageElement | null;
    // Height capped at previewWidth (120) × 1; width = 120/2 = 60 to hold aspect.
    expect(el?.style.height).toBe('120px');
    expect(el?.style.width).toBe('60px');
  });

  it('does not enlarge a normal wide barcode (aspect < 1 stays at full preview width)', async () => {
    const { render } = await import('@testing-library/react');
    const { BatchPreview } = await import('./BatchPreview');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    // aspect 0.5 (typical 1D barcode) → height 60px, no cap applied.
    const img: BarcodeImageResult = { value: 'WIDE', dataUrl: png, width: 100, height: 50, widthMm: 10, heightMm: 5, displayAspectRatio: 0.5 };
    const { container } = render(
      <BatchPreview images={[img]} isGenerating={false} actionsDisabled={false} previewScale={1} />
    );
    const el = container.querySelector('img[alt="WIDE"]') as HTMLImageElement | null;
    expect(el?.style.width).toBe('120px');
    expect(el?.style.height).toBe('60px');
  });
});

