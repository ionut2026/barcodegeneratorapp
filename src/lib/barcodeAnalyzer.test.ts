import { describe, it, expect } from 'vitest';
import { analyzeBarcode } from './barcodeAnalyzer';
import { calculateMod43Checksum } from './barcodeUtils';

// ---------------------------------------------------------------------------
// analyzeBarcode('')
// ---------------------------------------------------------------------------
describe('analyzeBarcode empty string', () => {
  it('returns matches: []', () => {
    const result = analyzeBarcode('');
    expect(result.matches).toEqual([]);
  });

  it('returns primaryMatch: null', () => {
    const result = analyzeBarcode('');
    expect(result.primaryMatch).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode with valid EAN-13
// ---------------------------------------------------------------------------
describe('analyzeBarcode with known EAN-13 "5901234123457"', () => {
  it('matches array contains a match with format EAN13', () => {
    const result = analyzeBarcode('5901234123457');
    const ean13Match = result.matches.find((m) => m.format === 'EAN13');
    expect(ean13Match).toBeDefined();
  });

  it('EAN13 match has checksumStatus "valid"', () => {
    const result = analyzeBarcode('5901234123457');
    const ean13Match = result.matches.find((m) => m.format === 'EAN13');
    expect(ean13Match?.checksumStatus).toBe('valid');
  });

  it('EAN13 match has confidence "high"', () => {
    const result = analyzeBarcode('5901234123457');
    const ean13Match = result.matches.find((m) => m.format === 'EAN13');
    expect(ean13Match?.confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode with EAN-13 bad check digit
// ---------------------------------------------------------------------------
describe('analyzeBarcode with EAN-13 bad check digit "5901234123450"', () => {
  it('EAN13 match has checksumStatus "invalid"', () => {
    // Valid check digit for "590123412345" is 7; we pass 0 instead
    const result = analyzeBarcode('5901234123450');
    const ean13Match = result.matches.find((m) => m.format === 'EAN13');
    expect(ean13Match).toBeDefined();
    expect(ean13Match?.checksumStatus).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode with CODE39 value (no check char appended)
// ---------------------------------------------------------------------------
describe('analyzeBarcode with CODE39 "HELLO"', () => {
  it('matches array contains CODE39', () => {
    const result = analyzeBarcode('HELLO');
    const code39Match = result.matches.find((m) => m.format === 'CODE39');
    expect(code39Match).toBeDefined();
  });

  it('CODE39 match checksumStatus is "not_applicable" (no check char appended)', () => {
    const result = analyzeBarcode('HELLO');
    const code39Match = result.matches.find((m) => m.format === 'CODE39');
    expect(code39Match?.checksumStatus).toBe('not_applicable');
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode with CODE39 + Mod43
// ---------------------------------------------------------------------------
describe('analyzeBarcode with CODE39 + valid Mod43 check char', () => {
  it('CODE39 match checksumStatus should be "valid"', () => {
    const checkChar = calculateMod43Checksum('HELLO');
    const inputWithCheck = 'HELLO' + checkChar;
    const result = analyzeBarcode(inputWithCheck);
    const code39Match = result.matches.find((m) => m.format === 'CODE39');
    expect(code39Match).toBeDefined();
    expect(code39Match?.checksumStatus).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode with UPC-A
// ---------------------------------------------------------------------------
describe('analyzeBarcode with UPC-A "036000291452"', () => {
  it('UPC match has checksumStatus "valid"', () => {
    // 036000291452: check digit 2 is valid for "03600029145"
    const result = analyzeBarcode('036000291452');
    const upcMatch = result.matches.find((m) => m.format === 'UPC');
    expect(upcMatch).toBeDefined();
    expect(upcMatch?.checksumStatus).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode with numeric string
// ---------------------------------------------------------------------------
describe('analyzeBarcode with numeric "12345678" (8 chars)', () => {
  it('should match multiple formats', () => {
    const result = analyzeBarcode('12345678');
    expect(result.matches.length).toBeGreaterThan(1);
  });

  it('should include CODE128 in matches', () => {
    const result = analyzeBarcode('12345678');
    const code128 = result.matches.find((m) => m.format === 'CODE128');
    expect(code128).toBeDefined();
  });

  it('should include ITF (even length)', () => {
    const result = analyzeBarcode('12345678');
    const itf = result.matches.find((m) => m.format === 'ITF');
    expect(itf).toBeDefined();
  });

  it('should include MSI in matches', () => {
    const result = analyzeBarcode('12345678');
    const msi = result.matches.find((m) => m.format === 'MSI');
    expect(msi).toBeDefined();
  });

  it('all matches have a checksumStatus', () => {
    const result = analyzeBarcode('12345678');
    for (const match of result.matches) {
      expect(['valid', 'invalid', 'not_applicable', 'intrinsic']).toContain(match.checksumStatus);
    }
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode sorting
// ---------------------------------------------------------------------------
describe('analyzeBarcode sorting', () => {
  it('primaryMatch is the first element of matches', () => {
    const result = analyzeBarcode('5901234123457');
    if (result.matches.length > 0) {
      expect(result.primaryMatch).toEqual(result.matches[0]);
    }
  });

  it('matches are sorted high confidence before medium before low', () => {
    const result = analyzeBarcode('12345678');
    const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    for (let i = 0; i < result.matches.length - 1; i++) {
      const curr = confidenceOrder[result.matches[i].confidence];
      const next = confidenceOrder[result.matches[i + 1].confidence];
      expect(curr).toBeLessThanOrEqual(next);
    }
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode EAN-8 checksum
// ---------------------------------------------------------------------------
describe('analyzeBarcode EAN-8 checksum', () => {
  it('valid EAN-8 "12345670" has checksumStatus valid', () => {
    // verify: weights 3,1,3,1,3,1,3 on 1234567 → 3+2+9+4+15+6+21=60; (10-0)%10=0
    const result = analyzeBarcode('12345670');
    const ean8 = result.matches.find(m => m.format === 'EAN8');
    expect(ean8).toBeDefined();
    expect(ean8?.checksumStatus).toBe('valid');
  });

  it('invalid EAN-8 "12345679" has checksumStatus invalid', () => {
    const result = analyzeBarcode('12345679');
    const ean8 = result.matches.find(m => m.format === 'EAN8');
    expect(ean8?.checksumStatus).toBe('invalid');
  });

  it('7-digit EAN-8 "1234567" has checksumStatus not_applicable', () => {
    const result = analyzeBarcode('1234567');
    const ean8 = result.matches.find(m => m.format === 'EAN8');
    expect(ean8?.checksumStatus).toBe('not_applicable');
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode ITF14 checksum (GS1 Mod 10)
// ---------------------------------------------------------------------------
describe('analyzeBarcode ITF14 checksum (GS1 Mod 10)', () => {
  it('correctly validates ITF14 using GS1 weights not Luhn', () => {
    // GS1 check for "0001234560001": weights 3,1 from left
    // 0*3+0*1+0*3+1*1+2*3+3*1+4*3+5*1+6*3+0*1+0*3+0*1+1*3 = 48; (10-8)%10=2
    // So "00012345600012" should be valid
    const result = analyzeBarcode('00012345600012');
    const itf14 = result.matches.find(m => m.format === 'ITF14');
    expect(itf14).toBeDefined();
    expect(itf14?.checksumStatus).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// analyzeBarcode 2D formats
// ---------------------------------------------------------------------------
describe('analyzeBarcode with URL "https://example.com"', () => {
  it('matches include qrcode', () => {
    const result = analyzeBarcode('https://example.com');
    const qr = result.matches.find((m) => m.format === 'qrcode');
    expect(qr).toBeDefined();
  });

  it('matches include azteccode', () => {
    const result = analyzeBarcode('https://example.com');
    const aztec = result.matches.find((m) => m.format === 'azteccode');
    expect(aztec).toBeDefined();
  });

  it('matches include datamatrix', () => {
    const result = analyzeBarcode('https://example.com');
    const dm = result.matches.find((m) => m.format === 'datamatrix');
    expect(dm).toBeDefined();
  });

  it('matches include pdf417', () => {
    const result = analyzeBarcode('https://example.com');
    const pdf = result.matches.find((m) => m.format === 'pdf417');
    expect(pdf).toBeDefined();
  });

  it('2D format matches have confidence "low"', () => {
    const result = analyzeBarcode('https://example.com');
    const twoDFormats = ['qrcode', 'azteccode', 'datamatrix', 'pdf417'];
    for (const fmt of twoDFormats) {
      const match = result.matches.find((m) => m.format === fmt);
      expect(match?.confidence).toBe('low');
    }
  });
});

// Regression for H1 refactor: when an optional checksum candidate throws
// ValidationException (Strict Match miss), the analyzer must fall back to
// 'not_applicable' rather than letting the exception escape.
describe('analyzeBarcode optional-checksum candidate fallback (regression for H1)', () => {
  it('CODE39 input where last char is not the Mod43 check returns not_applicable', () => {
    // 'HELLO' Mod43 check is computed; 'HELLOZ' appends a near-arbitrary char.
    // If 'Z' happens to be the real Mod43 check this test self-skips.
    const real = calculateMod43Checksum('HELLO');
    const candidate = real === 'Z' ? 'Y' : 'Z';
    const result = analyzeBarcode('HELLO' + candidate);
    const m = result.matches.find((x) => x.format === 'CODE39');
    expect(m).toBeDefined();
    expect(m?.checksumStatus).toBe('not_applicable');
  });

  it('analyzeBarcode does not throw on inputs that look like wrong optional checks', () => {
    expect(() => analyzeBarcode('1234X')).not.toThrow();
    expect(() => analyzeBarcode('A1234X')).not.toThrow();
    expect(() => analyzeBarcode('999999')).not.toThrow();
  });
});

