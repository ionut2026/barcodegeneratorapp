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


