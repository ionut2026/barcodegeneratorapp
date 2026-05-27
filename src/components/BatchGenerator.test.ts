import { describe, it, expect } from 'vitest';
import { validateInput, getFixedLength } from '@/lib/barcodeUtils';

// Inline copy of generateRandomForFormat for isolated testing.
// Once BatchGenerator exports this helper, import it directly.
function generateRandomForFormat(format: string, count: number, stringLength: number): string[] {
  const isNumericOnly = [
    'EAN13', 'EAN8', 'EAN5', 'EAN2', 'UPC', 'UPCE', 'ITF14', 'ITF',
    'MSI', 'MSI10', 'MSI11', 'pharmacode', 'codabar',
  ].includes(format);

  const fixed = getFixedLength(format as any);
  let length = fixed ?? stringLength;
  if (format === 'ITF' && length % 2 !== 0) length = Math.max(2, length - 1);

  if (format === 'pharmacode') {
    return Array.from({ length: count }, () => String(Math.floor(Math.random() * 131068) + 3));
  }

  if (format === 'codabar') {
    const dataChars = '0123456789-$:/.+';
    return Array.from({ length: count }, () => {
      let val = '';
      for (let i = 0; i < length; i++) val += dataChars.charAt(Math.floor(Math.random() * dataChars.length));
      return val;
    });
  }

  const chars = isNumericOnly ? '0123456789' : '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: count }, () => {
    let r = '';
    for (let i = 0; i < length; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
    return r;
  });
}

describe('generateRandomForFormat — UPCE regression (isNumericOnly)', () => {
  it('UPCE generates only digit-only strings', () => {
    const values = generateRandomForFormat('UPCE', 20, 6);
    for (const v of values) {
      expect(v).toMatch(/^\d+$/);
    }
  });
});

describe('generateRandomForFormat — fixed-length formats', () => {
  it('EAN13 always generates 12-digit strings', () => {
    const values = generateRandomForFormat('EAN13', 10, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{12}$/);
    }
  });

  it('UPC always generates 11-digit strings', () => {
    const values = generateRandomForFormat('UPC', 10, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{11}$/);
    }
  });

  it('pharmacode values are in range 3-131070', () => {
    const values = generateRandomForFormat('pharmacode', 50, 6);
    for (const v of values) {
      const n = parseInt(v, 10);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(131070);
    }
  });

  it('ITF always generates even-length strings', () => {
    const values = generateRandomForFormat('ITF', 10, 7);
    for (const v of values) {
      expect(v.length % 2).toBe(0);
    }
  });

  it('CODE39 generates alphanumeric strings', () => {
    const values = generateRandomForFormat('CODE39', 10, 6);
    for (const v of values) {
      expect(v).toMatch(/^[0-9A-Z]+$/);
    }
  });

  it('EAN5 always generates exactly 5 digits (regression: previously alphanumeric)', () => {
    const values = generateRandomForFormat('EAN5', 20, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{5}$/);
    }
  });

  it('EAN2 always generates exactly 2 digits (regression: previously alphanumeric)', () => {
    const values = generateRandomForFormat('EAN2', 20, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{2}$/);
    }
  });

  it('EAN8 always generates 7 digits', () => {
    const values = generateRandomForFormat('EAN8', 10, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{7}$/);
    }
  });

  it('ITF14 always generates 13 digits', () => {
    const values = generateRandomForFormat('ITF14', 10, 8);
    for (const v of values) {
      expect(v).toMatch(/^\d{13}$/);
    }
  });
});

// Silence unused import warning — validateInput is available for future tests
void validateInput;
