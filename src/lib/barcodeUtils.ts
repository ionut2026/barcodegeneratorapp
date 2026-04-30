// Barcode utility functions

export type BarcodeFormat = 
  // 1D Barcodes (JsBarcode)
  | 'CODE39'
  | 'CODE93'
  | 'CODE128'
  | 'EAN13'
  | 'EAN8'
  | 'EAN5'
  | 'EAN2'
  | 'UPC'
  | 'UPCE'
  | 'ITF14'
  | 'ITF'
  | 'MSI'
  | 'MSI10'
  | 'MSI11'
  | 'MSI1010'
  | 'MSI1110'
  | 'pharmacode'
  | 'codabar'
  // 2D Barcodes (bwip-js)
  | 'qrcode'
  | 'azteccode'
  | 'datamatrix'
  | 'pdf417';

// Helper to check if format is 2D (sourced from BARCODE_FORMATS registry below).
// Implemented as a function call wrapping a lazy lookup so the registry stays
// the single source of truth — adding a 2D format only requires updating
// BARCODE_FORMATS, never this helper.
export function is2DBarcode(format: BarcodeFormat): boolean {
  return BARCODE_FORMATS.find((f) => f.value === format)?.category === '2D';
}

export type ChecksumType = 
  | 'none' 
  | 'mod10' 
  | 'mod11' 
  | 'mod43' 
  | 'mod16' 
  | 'japanNW7' 
  | 'jrc' 
  | 'luhn' 
  | 'mod11PZN' 
  | 'mod11A' 
  | 'mod10Weight2' 
  | 'mod10Weight3' 
  | '7CheckDR' 
  | 'mod16Japan'
  | 'ean13' 
  | 'upc';

export type QualityLevel = 'A' | 'B' | 'C';

export const QUALITY_LEVELS: { value: QualityLevel; label: string; description: string; blur: number }[] = [
  { value: 'A', label: 'High (A)', description: 'Crystal clear, sharp edges', blur: 0 },
  { value: 'B', label: 'Medium (B)', description: 'Slightly softened edges', blur: 0.5 },
  { value: 'C', label: 'Low (C)', description: 'Blurred, degraded appearance', blur: 1.2 },
];

export interface BarcodeConfig {
  format: BarcodeFormat;
  text: string;
  widthMils: number;
  dpi: number;
  height: number;
  displayValue: boolean;
  fontSize: number;
  lineColor: string;
  background: string;
  margin: number;
  checksumType: ChecksumType;
  quality: QualityLevel;
  scale: number;
}

// ── Checksum options registry ─────────────────────────────────────────────────
// Maps each format to its available checksum options. `null` means intrinsic
// checksum (no user choice); missing key falls back to [none].

type ChecksumOption = { value: ChecksumType; label: string };

const CHECKSUM_OPTIONS_REGISTRY: Partial<Record<BarcodeFormat, ChecksumOption[] | null>> = {
  CODE39:  [{ value: 'none', label: 'None' }, { value: 'mod43', label: 'Modulo 43' }],
  codabar: [
    { value: 'none', label: 'None' },
    { value: 'mod16', label: 'Modulo 16' },
    { value: 'japanNW7', label: 'Japan NW-7' },
    { value: 'jrc', label: 'JRC' },
    { value: 'luhn', label: 'Luhn' },
    { value: 'mod11PZN', label: 'Modulo 11 PZN' },
    { value: 'mod11A', label: 'Modulo 11-A' },
    { value: 'mod10Weight2', label: 'Modulo 10 Weight 2' },
    { value: 'mod10Weight3', label: 'Modulo 10 Weight 3' },
    { value: '7CheckDR', label: '7 Check DR' },
    { value: 'mod16Japan', label: 'Modulo 16 Japan' },
  ],
  ITF:     [{ value: 'none', label: 'None' }, { value: 'mod10', label: 'Modulo 10 (auto-pads for even length)' }],
  MSI:     [{ value: 'none', label: 'None' }, { value: 'mod10', label: 'Modulo 10' }, { value: 'mod11', label: 'Modulo 11' }],
  // Intrinsic checksums — no user options
  EAN13:   null,
  EAN8:    null,
  UPC:     null,
  UPCE:    null,
  CODE128: null,
  MSI10:   null,
  MSI11:   null,
  MSI1010: null,
  MSI1110: null,
  ITF14:   null,
};

export function getApplicableChecksums(format: BarcodeFormat): ChecksumOption[] {
  const entry = CHECKSUM_OPTIONS_REGISTRY[format];
  if (entry === null) return [];               // intrinsic checksum — no user choice
  if (entry !== undefined) return entry;        // format-specific options
  return [{ value: 'none', label: 'None' }];   // default for formats with no checksum
}

// ── Checksum application registry ─────────────────────────────────────────────
// Maps each ChecksumType to a function that appends the check character(s).

type ChecksumApplier = (text: string, format: BarcodeFormat) => string;

const CHECKSUM_APPLIER_REGISTRY: Record<string, ChecksumApplier> = {
  mod10: (text, format) => {
    // ITF/ITF14 use GS1 weighted Mod 10; MSI uses Luhn
    const checkDigit = (format === 'ITF' || format === 'ITF14')
      ? calculateGS1Mod10(text)
      : calculateMod10(text);
    let result = text + checkDigit;
    // ITF requires even number of digits — pad with leading zero if needed
    if ((format === 'ITF' || format === 'ITF14') && result.length % 2 !== 0) {
      result = '0' + result;
    }
    return result;
  },
  mod11: (text, format) => {
    const check = calculateMod11(text);
    if (check === 10) {
      // Check digit 10 maps to 'X' — invalid for numeric-only formats (MSI).
      // Return text unchanged so validation catches the incompatibility.
      const numericOnly = ['MSI', 'MSI10', 'MSI11', 'MSI1010', 'MSI1110', 'ITF', 'ITF14'].includes(format);
      return numericOnly ? text : text + 'X';
    }
    return text + check;
  },
  mod43:        (text) => text + calculateMod43Checksum(text),
  mod16:        (text) => text + calculateMod16Checksum(text),
  japanNW7:     (text) => text + calculateJapanNW7Checksum(text),
  jrc:          (text) => text + calculateJRCChecksum(text),
  luhn:         (text) => text + calculateLuhnChecksum(text),
  mod11PZN:     (text) => text + calculateMod11PZNChecksum(text),
  mod11A:       (text) => {
    const result = calculateMod11AChecksum(text);
    // 'X' is not a valid character for codabar — skip checksum for these values
    return result === 'X' ? text : text + result;
  },
  mod10Weight2: (text) => text + calculateMod10Weight2Checksum(text),
  mod10Weight3: (text) => text + calculateMod10Weight3Checksum(text),
  '7CheckDR':   (text) => text + calculate7CheckDRChecksum(text),
  mod16Japan:   (text) => text + calculateMod16JapanChecksum(text),
  ean13:        (text) => text.length === 12 ? text + calculateEAN13Checksum(text) : text,
  upc:          (text) => text.length === 11 ? text + calculateUPCChecksum(text) : text,
};

export function applyChecksum(text: string, format: BarcodeFormat, checksumType: ChecksumType): string {
  if (checksumType === 'none' || !text.trim()) return text;
  const applier = CHECKSUM_APPLIER_REGISTRY[checksumType];
  return applier ? applier(text, format) : text;
}

export const BARCODE_FORMATS: { value: BarcodeFormat; label: string; description: string; validChars: string; lengthHint: string; category: '1D' | '2D' }[] = [
  // 1D Barcodes
  {
    value: 'codabar',
    label: 'Codabar',
    description: 'Libraries, blood banks, shipping',
    validChars: '0-9, -, $, :, /, ., +',
    lengthHint: 'Any length',
    category: '1D'
  },
  {
    value: 'CODE39',
    label: 'CODE 39',
    description: 'Alphanumeric, widely used in industrial applications',
    validChars: 'A-Z, 0-9, -, ., $, /, +, %, SPACE',
    lengthHint: 'Any length',
    category: '1D'
  },
  { 
    value: 'CODE93', 
    label: 'CODE 93', 
    description: 'Higher density than CODE 39, full ASCII support',
    validChars: 'All ASCII characters',
    lengthHint: 'Any length',
    category: '1D'
  },
  { 
    value: 'CODE128', 
    label: 'CODE 128', 
    description: 'High-density, supports full ASCII',
    validChars: 'All ASCII characters (0-127)',
    lengthHint: 'Any length',
    category: '1D'
  },
  { 
    value: 'EAN13',
    label: 'EAN-13', 
    description: 'European Article Number, retail products',
    validChars: '0-9 only',
    lengthHint: '12 or 13 digits',
    category: '1D'
  },
  { 
    value: 'EAN8', 
    label: 'EAN-8', 
    description: 'Short version of EAN-13',
    validChars: '0-9 only',
    lengthHint: '7 or 8 digits',
    category: '1D'
  },
  { 
    value: 'EAN5', 
    label: 'EAN-5', 
    description: 'UPC/EAN supplemental 5-digit add-on',
    validChars: '0-9 only',
    lengthHint: 'Exactly 5 digits',
    category: '1D'
  },
  { 
    value: 'EAN2', 
    label: 'EAN-2', 
    description: 'UPC/EAN supplemental 2-digit add-on',
    validChars: '0-9 only',
    lengthHint: 'Exactly 2 digits',
    category: '1D'
  },
  { 
    value: 'UPC', 
    label: 'UPC-A', 
    description: 'Universal Product Code, US retail',
    validChars: '0-9 only',
    lengthHint: '11 or 12 digits',
    category: '1D'
  },
  { 
    value: 'UPCE', 
    label: 'UPC-E', 
    description: 'Compressed UPC for small packages',
    validChars: '0-9 only',
    lengthHint: '6, 7, or 8 digits',
    category: '1D'
  },
  { 
    value: 'ITF14', 
    label: 'ITF-14', 
    description: 'Interleaved 2 of 5, shipping containers',
    validChars: '0-9 only',
    lengthHint: '13 or 14 digits',
    category: '1D'
  },
  { 
    value: 'ITF', 
    label: 'ITF', 
    description: 'Interleaved 2 of 5',
    validChars: '0-9 only',
    lengthHint: 'Even number of digits',
    category: '1D'
  },
  { 
    value: 'MSI', 
    label: 'MSI', 
    description: 'Modified Plessey, inventory control',
    validChars: '0-9 only',
    lengthHint: 'Any length',
    category: '1D'
  },
  { 
    value: 'MSI10', 
    label: 'MSI Mod 10', 
    description: 'MSI with Mod 10 check digit',
    validChars: '0-9 only',
    lengthHint: 'Any length',
    category: '1D'
  },
  { 
    value: 'MSI11', 
    label: 'MSI Mod 11', 
    description: 'MSI with Mod 11 check digit',
    validChars: '0-9 only',
    lengthHint: 'Any length',
    category: '1D'
  },
  {
    value: 'MSI1010' as const,
    label: 'MSI Double Mod 10',
    description: 'MSI with two Mod 10 check digits',
    validChars: '0-9 only',
    lengthHint: 'Any length',
    category: '1D' as const,
  },
  {
    value: 'MSI1110' as const,
    label: 'MSI Mod 11 + Mod 10',
    description: 'MSI with Mod 11 followed by Mod 10 check digits',
    validChars: '0-9 only',
    lengthHint: 'Any length',
    category: '1D' as const,
  },
  { 
    value: 'pharmacode', 
    label: 'Pharmacode', 
    description: 'Pharmaceutical packaging',
    validChars: '0-9 only',
    lengthHint: 'Number 3-131070',
    category: '1D'
  },
  // 2D Barcodes
  { 
    value: 'qrcode', 
    label: 'QR Code', 
    description: 'Quick Response code, widely used for URLs and data',
    validChars: 'All characters',
    lengthHint: 'Up to 4,296 chars',
    category: '2D'
  },
  { 
    value: 'azteccode', 
    label: 'Aztec Code', 
    description: 'High-density 2D barcode, used in transport tickets',
    validChars: 'All ASCII characters',
    lengthHint: 'Up to 3,832 chars',
    category: '2D'
  },
  { 
    value: 'datamatrix', 
    label: 'Data Matrix', 
    description: '2D matrix barcode for small items',
    validChars: 'All ASCII characters',
    lengthHint: 'Up to 2,335 chars',
    category: '2D'
  },
  { 
    value: 'pdf417', 
    label: 'PDF417', 
    description: 'Stacked linear barcode, used in IDs and shipping',
    validChars: 'All ASCII characters',
    lengthHint: 'Up to 1,850 chars',
    category: '2D'
  },
];

// Calculate various checksums

// Standard Luhn algorithm (Mod 10 with doubling)
export function calculateMod10(input: string): number {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  let isOdd = true;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if (isOdd) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isOdd = !isOdd;
  }

  return (10 - (sum % 10)) % 10;
}

// GS1 Mod 10 (weights 3,1 from right) — used by ITF, ITF-14, EAN, UPC
export function calculateGS1Mod10(input: string): number {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const posFromRight = digits.length - 1 - i;
    sum += digits[i] * (posFromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

// Mod 11 checksum with weights 2-7
export function calculateMod11(input: string): number {
  const digits = input.replace(/\D/g, '').split('').map(Number).reverse();
  const weights = [2, 3, 4, 5, 6, 7];
  let sum = 0;
  
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * weights[i % weights.length];
  }
  
  const remainder = sum % 11;
  return remainder === 0 ? 0 : 11 - remainder;
}

// Modulo 43 for CODE39 and CODE39 Full ASCII
export function calculateMod43Checksum(input: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
  let sum = 0;
  
  for (const char of input.toUpperCase()) {
    const index = chars.indexOf(char);
    if (index !== -1) {
      sum += index;
    }
  }
  
  return chars[sum % 43];
}

// Legacy CODE39 checksum (same as Mod43)
export function calculateCode39Checksum(input: string): string {
  return calculateMod43Checksum(input);
}

// Modulo 16 for Codabar
export function calculateMod16Checksum(input: string): string {
  const codabarChars = '0123456789-$:/.+';
  let sum = 0;
  
  for (const char of input) {
    const index = codabarChars.indexOf(char);
    if (index !== -1) {
      sum += index;
    }
  }
  
  const check = (16 - (sum % 16)) % 16;
  return codabarChars[check];
}

// Codabar Japan NW-7 / Mod 16 Japan shared weight tables (JIS X 0503).
// Used by both calculateJapanNW7Checksum (Mod 11) and
// calculateMod16JapanChecksum (Mod 16).
const JAPAN_NW7_FIRST_WEIGHT  = [5, 9, 10, 7, 8, 4, 5, 3, 6, 2];
const JAPAN_NW7_SECOND_WEIGHT = [6, 2, 10, 4, 3, 7, 6, 8, 5, 9];
const JAPAN_NW7_LENGTH = 10;

// Japan NW-7 checksum for Codabar (JIS X 0503).
// Algorithm: weighted Mod 11 using FIRST_WEIGHT; if the result is 10
// (non-numeric in Mod 11), retry with SECOND_WEIGHT; if the second pass
// also yields 10, the input is indeterminate and we return ''. The spec
// requires exactly 10 numerical values — anything else returns ''.
export function calculateJapanNW7Checksum(input: string): string {
  const codabarChars = '0123456789-$:/.+ABCD';

  // Decode characters to numerical values; reject anything not in the Codabar set
  // so non-Codabar input doesn't silently produce a misaligned weighted sum.
  const values: number[] = [];
  for (const char of input.toUpperCase()) {
    const index = codabarChars.indexOf(char);
    if (index === -1) return '';
    values.push(index);
  }

  if (values.length !== JAPAN_NW7_LENGTH) return '';

  let firstSum = 0;
  for (let i = 0; i < JAPAN_NW7_LENGTH; i++) firstSum += values[i] * JAPAN_NW7_FIRST_WEIGHT[i];
  let check = 11 - (firstSum % 11);

  if (check === 10) {
    let secondSum = 0;
    for (let i = 0; i < JAPAN_NW7_LENGTH; i++) secondSum += values[i] * JAPAN_NW7_SECOND_WEIGHT[i];
    check = 11 - (secondSum % 11);
  }

  if (check === 11) check = 0;
  if (check === 10) return ''; // indeterminate per spec

  return codabarChars[check];
}

// JRC (Japanese Railway) checksum
export function calculateJRCChecksum(input: string): string {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 2);
  }
  
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

// Luhn algorithm (same as standard credit card check)
export function calculateLuhnChecksum(input: string): string {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if ((digits.length - i) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

// Modulo 11 PZN (Pharmazentralnummer) checksum
export function calculateMod11PZNChecksum(input: string): string {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * (i + 1);
  }
  
  const check = sum % 11;
  if (check === 10) return '!'; // PZN spec: remainder 10 = invalid PZN, no valid check digit exists
  return String(check);
}

// Modulo 11-A checksum
export function calculateMod11AChecksum(input: string): string {
  const digits = input.replace(/\D/g, '').split('').map(Number).reverse();
  let sum = 0;
  
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * (i + 2);
  }
  
  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  return check === 10 ? 'X' : String(check);
}

// Modulo 10 with weight 2 (alternating 1,2)
export function calculateMod10Weight2Checksum(input: string): string {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  
  for (let i = 0; i < digits.length; i++) {
    const weight = i % 2 === 0 ? 1 : 2;
    let weighted = digits[i] * weight;
    if (weighted > 9) weighted -= 9;
    sum += weighted;
  }
  
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

// Modulo 10 with weight 3 (alternating 1,3)
export function calculateMod10Weight3Checksum(input: string): string {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  
  for (let i = 0; i < digits.length; i++) {
    const weight = i % 2 === 0 ? 1 : 3;
    sum += digits[i] * weight;
  }
  
  const check = (10 - (sum % 10)) % 10;
  return String(check);
}

// 7 Check DR (Digital Root based)
export function calculate7CheckDRChecksum(input: string): string {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  
  for (const digit of digits) {
    sum += digit;
  }
  
  // Digital root calculation
  let dr = sum;
  while (dr > 9) {
    dr = String(dr).split('').map(Number).reduce((a, b) => a + b, 0);
  }
  
  const check = (7 - (dr % 7)) % 7;
  return String(check);
}

// Modulo 16 Japan variant (JIS X 0503 / AIM USS-Codabar).
// Algorithm: weighted Mod 16 using JAPAN_NW7_FIRST_WEIGHT (same weights as
// Japan NW-7); if the result is > 9 (non-numeric in Mod 16), retry with
// JAPAN_NW7_SECOND_WEIGHT. The spec requires exactly 10 input values.
// Accepts the JIS aliases T, N, *, E for start/stop characters A, B, C, D
// respectively — they share values 16–19 with their A–D counterparts.
export function calculateMod16JapanChecksum(input: string): string {
  const codabarChars = '0123456789-$:/.+ABCD';
  const aliasMap: Record<string, string> = { T: 'A', N: 'B', '*': 'C', E: 'D' };

  const values: number[] = [];
  for (const rawChar of input.toUpperCase()) {
    const char = aliasMap[rawChar] ?? rawChar;
    const index = codabarChars.indexOf(char);
    if (index === -1) return '';
    values.push(index);
  }

  if (values.length !== JAPAN_NW7_LENGTH) return '';

  let firstSum = 0;
  for (let i = 0; i < JAPAN_NW7_LENGTH; i++) firstSum += values[i] * JAPAN_NW7_FIRST_WEIGHT[i];
  let check = 16 - (firstSum % 16);
  if (check === 16) check = 0;
  else if (check > 9) {
    let secondSum = 0;
    for (let i = 0; i < JAPAN_NW7_LENGTH; i++) secondSum += values[i] * JAPAN_NW7_SECOND_WEIGHT[i];
    check = 16 - (secondSum % 16);
    if (check === 16) check = 0;
  }

  return codabarChars[check];
}

// EAN-13 checksum
export function calculateEAN13Checksum(input: string): number {
  const digits = input.replace(/\D/g, '').slice(0, 12).split('').map(Number);
  let sum = 0;
  
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  
  return (10 - (sum % 10)) % 10;
}

// UPC-A checksum (Modulo 10)
export function calculateUPCChecksum(input: string): number {
  const digits = input.replace(/\D/g, '').slice(0, 11).split('').map(Number);
  let oddSum = 0;
  let evenSum = 0;
  
  for (let i = 0; i < 11; i++) {
    if (i % 2 === 0) {
      oddSum += digits[i];
    } else {
      evenSum += digits[i];
    }
  }
  
  const total = (oddSum * 3) + evenSum;
  return (10 - (total % 10)) % 10;
}

// ── Normalization registry ────────────────────────────────────────────────────
// Strip check digits so JsBarcode recalculates them. Each entry is a
// [regex, sliceEnd] pair: if the input matches the regex, return text.slice(0, sliceEnd).

const NORMALIZE_REGISTRY: Partial<Record<BarcodeFormat, [RegExp, number]>> = {
  EAN13: [/^\d{13}$/, 12],   // JsBarcode EAN13 expects 12 digits
  EAN8:  [/^\d{8}$/,  7],    // JsBarcode EAN8 expects 7 digits
  UPC:   [/^\d{12}$/, 11],   // JsBarcode UPC expects 11 digits
  UPCE:  [/^\d{8}$/,  7],    // JsBarcode UPC-E expects 6 or 7 digits; 8 = includes check digit
  ITF14: [/^\d{14}$/, 13],   // JsBarcode ITF14 expects 13 digits
};

// Normalize input for JsBarcode: strip check digits so JsBarcode recalculates them
export function normalizeForRendering(text: string, format: BarcodeFormat): string {
  const rule = NORMALIZE_REGISTRY[format];
  if (rule && rule[0].test(text)) return text.slice(0, rule[1]);
  return text;
}

// ── Input validation registry ─────────────────────────────────────────────────
// Each entry is a validator function that returns an error result or null (valid).

type ValidationResult = { valid: boolean; message: string };
type FormatValidator = (text: string, checksumType?: ChecksumType) => ValidationResult | null;

const digitsOnly = (label: string): FormatValidator => (text) =>
  /^\d+$/.test(text) ? null : { valid: false, message: `${label} only supports digits (0-9)` };

const VALIDATION_REGISTRY: Partial<Record<BarcodeFormat, FormatValidator>> = {
  CODE39: (text) =>
    /^[A-Z0-9\-\.\s\$\/\+\%]+$/.test(text) ? null : { valid: false, message: 'CODE 39 only supports A-Z (uppercase), 0-9, -, ., $, /, +, %, and space' },
  EAN13: (text) =>
    digitsOnly('EAN-13')(text) ?? (text.length !== 12 && text.length !== 13 ? { valid: false, message: 'EAN-13 requires exactly 12 or 13 digits' } : null),
  EAN8: (text) =>
    digitsOnly('EAN-8')(text) ?? (text.length !== 7 && text.length !== 8 ? { valid: false, message: 'EAN-8 requires exactly 7 or 8 digits' } : null),
  EAN5: (text) =>
    /^\d{5}$/.test(text) ? null : { valid: false, message: 'EAN-5 requires exactly 5 digits' },
  EAN2: (text) =>
    /^\d{2}$/.test(text) ? null : { valid: false, message: 'EAN-2 requires exactly 2 digits' },
  UPC: (text) =>
    digitsOnly('UPC-A')(text) ?? (text.length !== 11 && text.length !== 12 ? { valid: false, message: 'UPC-A requires exactly 11 or 12 digits' } : null),
  UPCE: (text) =>
    digitsOnly('UPC-E')(text) ?? (text.length < 6 || text.length > 8 ? { valid: false, message: 'UPC-E requires 6, 7, or 8 digits' } : null),
  ITF14: (text) =>
    digitsOnly('ITF-14')(text) ?? (text.length !== 13 && text.length !== 14 ? { valid: false, message: 'ITF-14 requires exactly 13 or 14 digits' } : null),
  ITF: (text, checksumType = 'none') => {
    if (!/^\d+$/.test(text)) return { valid: false, message: 'ITF requires an even number of digits (digits only)' };
    if (checksumType === 'mod10') {
      // With checksum, the check digit is appended to the input. The total must be
      // even for ITF encoding, so the raw input must have an ODD number of digits.
      // Even-length input would require a silent leading-zero pad which alters the data.
      if (text.length % 2 === 0) return { valid: false, message: 'ITF with checksum requires an odd number of digits (the check digit will be appended to make it even)' };
    } else {
      if (text.length % 2 !== 0) return { valid: false, message: 'ITF requires an even number of digits' };
    }
    return null;
  },
  pharmacode: (text) => {
    if (!/^\d+$/.test(text)) return { valid: false, message: 'Pharmacode requires a number between 3 and 131070' };
    const num = parseInt(text, 10);
    return isNaN(num) || num < 3 || num > 131070 ? { valid: false, message: 'Pharmacode requires a number between 3 and 131070' } : null;
  },
  MSI:     (text) => digitsOnly('MSI formats')(text),
  MSI10:   (text) => digitsOnly('MSI formats')(text),
  MSI11:   (text) => digitsOnly('MSI formats')(text),
  MSI1010: (text) => digitsOnly('MSI formats')(text),
  MSI1110: (text) => digitsOnly('MSI formats')(text),
  codabar: (text) =>
    /^[A-Da-d]?[0-9\-\$\:\/\.\+]+[A-Da-d]?$/.test(text) ? null
      : { valid: false, message: 'Codabar only supports digits (0-9), -, $, :, /, ., + and optional A-D start/stop characters' },
  // CODE93, qrcode, azteccode, datamatrix, pdf417, CODE128: no special validation
};

export function validateInput(text: string, format: BarcodeFormat, checksumType: ChecksumType = 'none'): ValidationResult {
  if (!text.trim()) {
    return { valid: false, message: 'Please enter a value' };
  }
  const validator = VALIDATION_REGISTRY[format];
  if (validator) {
    const result = validator(text, checksumType);
    if (result) return result;
  }
  return { valid: true, message: '' };
}

/**
 * Snap a requested X-dimension (in mils) to the nearest achievable whole-pixel
 * module width for a given DPI.
 *
 * Printers can only render whole pixels. This function resolves the physical
 * reality of a requested module size:
 *   7.5 mil @ 300 DPI → 2.25 px → rounds to 2 px → actual 6.67 mil (0.169 mm)
 *   5 mil   @ 300 DPI → 1.5 px  → rounds to 2 px → actual 6.67 mil (0.169 mm)
 *  10 mil   @ 300 DPI → 3.0 px  → exact   3 px   → actual 10 mil   (0.254 mm)
 */
export function snapToPixelGrid(widthMils: number, dpi: number): {
  modulePixels: number;
  actualMils: number;
  actualMm: number;
  requestedMils: number;
} {
  const exactPixels = widthMils * dpi / 1000;
  const modulePixels = Math.max(1, Math.round(exactPixels));
  const actualMils = (modulePixels * 1000) / dpi;
  const actualMm = modulePixels * 25.4 / dpi;
  return { modulePixels, actualMils, actualMm, requestedMils: widthMils };
}

export function getDefaultConfig(): BarcodeConfig {
  // Default: 2 px module at 300 DPI = 6.67 mil (0.169 mm).
  // 7.5 mil is NOT achievable at 300 DPI (7.5 × 300/1000 = 2.25 → rounds to 2 px).
  const { actualMils } = snapToPixelGrid(7.5, 300);
  return {
    format: 'CODE39',
    text: 'BARCODE123',
    widthMils: +actualMils.toFixed(2),
    dpi: 300,
    height: 100,
    displayValue: true,
    fontSize: 20,
    lineColor: '#000000',
    background: '#FFFFFF',
    margin: 10,
    checksumType: 'none',
    quality: 'A',
     scale: 1,
  };
}
