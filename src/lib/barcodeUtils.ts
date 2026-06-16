// Barcode utility functions

import { Weight } from "lucide-react";

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

/**
 * Quality presets. `blur` is a fraction of the module (narrowest bar) width,
 * NOT a fixed pixel value — so the perceived softness is consistent across
 * DPIs and X-dimensions. Effective pixel blur = blur × modulePixels.
 *
 *   A: 0      → crystal clear, no anti-aliasing softening
 *   B: 0.35   → visibly soft edge (~⅓ of a bar)
 *   C: 0.85   → clearly degraded, almost ~1 bar of bleed
 */
export const QUALITY_LEVELS: { value: QualityLevel; label: string; description: string; blur: number }[] = [
  { value: 'A', label: 'High (A)', description: 'Crystal clear, sharp edges', blur: 0 },
  { value: 'B', label: 'Medium (B)', description: 'Slightly softened edges', blur: 0.35 },
  { value: 'C', label: 'Low (C)', description: 'Blurred, degraded appearance', blur: 0.85 },
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
  '7CheckDR':   (text) => text + String(calculate7CheckDRChecksum(text, CHECK_DR_WEIGHTS)),
  mod16Japan:   (text) => text + calculateMod16JapanChecksum(text),
  ean13:        (text) => text.length === 12 ? text + calculateEAN13Checksum(text) : text,
  upc:          (text) => text.length === 11 ? text + calculateUPCChecksum(text) : text,
};

export function applyChecksum(text: string, format: BarcodeFormat, checksumType: ChecksumType): string {
  if (checksumType === 'none' || !text.trim()) return text;
  const applier = CHECKSUM_APPLIER_REGISTRY[checksumType];
  return applier ? applier(text, format) : text;
}

// ── Intrinsic checksum (JsBarcode-implicit) ───────────────────────────────────
// For formats whose check digit is computed automatically by JsBarcode (EAN-13,
// EAN-8, UPC-A, UPC-E, ITF-14), the user is not asked to choose a checksum —
// `applyChecksum` returns the value unchanged. This helper appends the same
// check digit JsBarcode will compute so callers (notably the batch screen) can
// display the full encoded value as a text label / file name. The bar
// encoding itself is unaffected: JsBarcode receives the 12-digit value and
// computes the 13th digit internally; this helper just reproduces that digit
// for display purposes so the label matches the bars.
export function applyIntrinsicChecksum(text: string, format: BarcodeFormat): string {
  if (!text) return text;
  if (!/^\d+$/.test(text)) return text;
  switch (format) {
    case 'EAN13':
      return text.length === 12 ? text + calculateEAN13Checksum(text) : text;
    case 'EAN8':
      // EAN-8 uses the same GS1 Mod 10 algorithm (weights 3,1 from right) —
      // calculateGS1Mod10 is length-agnostic and produces the canonical EAN-8
      // check digit when given the 7 data digits.
      return text.length === 7 ? text + calculateGS1Mod10(text) : text;
    case 'UPC':
      return text.length === 11 ? text + calculateUPCChecksum(text) : text;
    case 'UPCE': {
      // UPC-E displayed value is the 8-digit form (NS + 6 data + check). The
      // check is computed from the UPC-A expansion — same logic as the
      // renderer path in normalizeForRendering().
      if (text.length !== 7) return text;
      const ns = text[0];
      const middleSix = text.slice(1);
      const upcA = expandUPCEtoUPCA(middleSix, ns);
      return text + String(calculateUPCChecksum(upcA));
    }
    case 'ITF14':
      return text.length === 13 ? text + calculateGS1Mod10(text) : text;
    default:
      return text;
  }
}

// Compose user-selected and intrinsic check digits — convenience for callers
// (e.g., batch mode) that want the value as it would appear printed under the
// barcode. Equivalent to applyIntrinsicChecksum(applyChecksum(...)).
export function getDisplayValue(text: string, format: BarcodeFormat, checksumType: ChecksumType): string {
  return applyIntrinsicChecksum(applyChecksum(text, format, checksumType), format);
}

// Fixed-length formats whose input must be exactly N characters. Returns the
// required length, or null when the format accepts variable-length input.
// Used by the batch screen to auto-update the "String Length" hint when the
// user picks a fixed-length symbology.
export function getFixedLength(format: BarcodeFormat): number | null {
  switch (format) {
    case 'EAN13': return 12;
    case 'EAN8':  return 7;
    case 'UPC':   return 11;
    case 'UPCE':  return 7;
    case 'ITF14': return 13;
    case 'EAN5':  return 5;
    case 'EAN2':  return 2;
    default:      return null;
  }
}

export const BARCODE_FORMATS: { value: BarcodeFormat; label: string; description: string; validChars: string; lengthHint: string; category: '1D' | '2D' }[] = [
  // 1D Barcodes
  {
    value: 'codabar',
    label: 'Codabar',
    description: 'Libraries, blood banks, shipping',
    validChars: '0-9, -, $, :, /, ., + (numeric & symbols)',
    lengthHint: 'Any length',
    category: '1D'
  },
  {
    value: 'CODE39',
    label: 'CODE 39',
    description: 'Alphanumeric, widely used in industrial applications',
    validChars: 'A-Z, 0-9, -, ., $, /, +, %, space',
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
    lengthHint: '12 digits (check digit auto-computed)',
    category: '1D'
  },
  { 
    value: 'EAN8', 
    label: 'EAN-8', 
    description: 'Short version of EAN-13',
    validChars: '0-9 only',
    lengthHint: '7 digits (check digit auto-computed)',
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
    lengthHint: '11 digits (check digit auto-computed)',
    category: '1D'
  },
  { 
    value: 'UPCE', 
    label: 'UPC-E', 
    description: 'Compressed UPC for small packages',
    validChars: '0-9 only',
    lengthHint: '7 digits (check digit auto-computed)',
    category: '1D'
  },
  { 
    value: 'ITF14', 
    label: 'ITF-14', 
    description: 'Interleaved 2 of 5, shipping containers',
    validChars: '0-9 only',
    lengthHint: '13 digits (check digit auto-computed)',
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

// Modulo 11-A checksum (AIM/USS Codabar Mod 11 variant).
// Weights cycle 2,3,4,5,6,7 from the rightmost data digit. The unbounded
// `i+2` weighting used previously made the weighted sum grow large for any
// input >9 digits, which pushed many otherwise-valid inputs into the
// remainder=1 → check=10 ('X') trap. Cycling weights match the documented
// Codabar Modulo 11-A algorithm and keep the check digit in the 0..10 range
// for realistic input lengths.
export function calculateMod11AChecksum(input: string): string {
  const digits = input.replace(/\D/g, '').split('').map(Number).reverse();
  let sum = 0;

  for (let i = 0; i < digits.length; i++) {
    const weight = 2 + (i % 10); // cycles 2,3,4,5,6,7
    sum += digits[i] * weight;
  }

  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  return check === 10 ? '0' : String(check);
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
/* export function calculate7CheckDRChecksum(input: string): string {
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
} */

// Default cycling weights for 7 Check DR — used by all UI/registry callers.
// Defined here so call sites in applyChecksum, validationEngine and the
// ChecksumCalculator stay in sync. Change this constant to globally retune.
export const CHECK_DR_WEIGHTS: number[] = [3, 1, 7, 9];

// Implementation to match the one from the CAR appplication
export function calculate7CheckDRChecksum(input: string, weights: number[]): number {
  const digits = input.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * weights[i % weights.length];
  }
  
  return sum % 7;
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
  // EAN-13, EAN-8, UPC-A, UPC-E, ITF-14: validation now rejects inputs that
  // include the check digit, so normalization is no longer needed — only the
  // data-digit length reaches the renderer, which JsBarcode handles directly.
};

// Map our internal `BarcodeFormat` value to the format string JsBarcode expects.
//
// Most formats map 1:1, but `CODE93` is special: JsBarcode's plain `CODE93`
// encoder only accepts the 47-symbol alphabet (`0-9 A-Z - . space $ / + %`)
// — passing `@`, `#`, `$`, lowercase letters, etc., causes JsBarcode to throw.
// JsBarcode also ships `CODE93FullASCII` which uses the spec-defined paired
// escape characters (e.g. `(+)A` for `a`, `(%)V` for `@`) to encode the full
// 0x00–0x7F ASCII range. The on-the-wire symbol is still a Code 93 barcode,
// and ZXing's `Code93Reader.decodeExtended()` automatically resolves the
// escape pairs back to the original ASCII characters — so the round-trip
// scan keeps working unchanged. We always route CODE93 through the Full ASCII
// encoder so the UI honours the documented "All ASCII characters" capability.
export function getJsBarcodeFormat(format: BarcodeFormat): string {
  if (format === 'CODE93') return 'CODE93FullASCII';
  return format;
}

// Normalize input for JsBarcode: handle UPC-E 7→8 digit conversion
export function normalizeForRendering(text: string, format: BarcodeFormat): string {
  // Codabar: JsBarcode requires start/stop characters (A-D). If the user input
  // doesn't already have them, wrap with 'A' ... 'A' automatically.
  if (format === 'codabar') {
    const hasStart = /^[A-Da-d]/.test(text);
    const hasStop = /[A-Da-d]$/.test(text);
    if (!hasStart && !hasStop) return 'A' + text + 'A';
    if (!hasStart) return 'A' + text;
    if (!hasStop) return text + 'A';
    return text;
  }
  // UPC-E: JsBarcode accepts 6 or 8 digits only. For 7-digit input (NS + 6 data),
  // expand to UPC-A, compute check digit, and pass full 8 digits.
  if (format === 'UPCE' && /^\d{7}$/.test(text)) {
    const ns = text[0];
    const middleSix = text.slice(1);
    const upcA = expandUPCEtoUPCA(middleSix, ns); // 11 digits
    const check = calculateUPCChecksum(upcA);
    return text + String(check);
  }
  const rule = NORMALIZE_REGISTRY[format];
  if (rule && rule[0].test(text)) return text.slice(0, rule[1]);
  return text;
}

// ── UPC-E ↔ UPC-A expansion ───────────────────────────────────────────────────
// Used by both the renderer and the validator. Mirrors JsBarcode's UPC-E rules
// (en.wikipedia.org/wiki/Universal_Product_Code#UPC-E) so we can validate the
// user-supplied check digit before letting JsBarcode silently reject it.
const UPCE_EXPANSIONS = [
  'XX00000XXX', 'XX10000XXX', 'XX20000XXX', 'XXX00000XX', 'XXXX00000X',
  'XXXXX00005', 'XXXXX00006', 'XXXXX00007', 'XXXXX00008', 'XXXXX00009',
];

export function expandUPCEtoUPCA(middleSix: string, numberSystem: string): string {
  const lastE = parseInt(middleSix[middleSix.length - 1], 10);
  const expansion = UPCE_EXPANSIONS[lastE];
  let body = '';
  let i = 0;
  for (const c of expansion) {
    body += (c === 'X') ? middleSix[i++] : c;
  }
  return numberSystem + body;
}

// ── Input validation registry ─────────────────────────────────────────────────
// Each entry is a validator function that returns an error result or null (valid).

type ValidationResult = { valid: boolean; message: string };
export interface ValidateOptions {
  /**
   * When true (default), validators that know the check-digit algorithm will
   * reject inputs whose user-supplied check digit doesn't match the computed
   * one. Set to false for tools (like the format analyzer) that want to
   * surface a "checksum invalid" state separately rather than reject outright.
   */
  strictCheckDigit?: boolean;
}
type FormatValidator = (text: string, checksumType: ChecksumType, opts: ValidateOptions) => ValidationResult | null;

const digitsOnly = (label: string): FormatValidator => (text) =>
  /^\d+$/.test(text) ? null : { valid: false, message: `${label} only supports digits (0-9)` };

const VALIDATION_REGISTRY: Partial<Record<BarcodeFormat, FormatValidator>> = {
  CODE39: (text) =>
    /^[A-Z0-9\-\.\s\$\/\+\%]+$/.test(text) ? null : { valid: false, message: 'CODE 39 only supports A-Z (uppercase), 0-9, -, ., $, /, +, %, and space' },
  EAN13: (text, _ct, opts) => {
    const d = digitsOnly('EAN-13')(text, _ct, opts); if (d) return d;
    // Relaxed mode (format analyzer): accept 12 or 13 digits for identification
    if (opts.strictCheckDigit === false) {
      if (text.length !== 12 && text.length !== 13) return { valid: false, message: 'Invalid barcode value! EAN-13 requires exactly 12 digits (check digit is auto-computed)' };
      return null;
    }
    if (text.length !== 12) return { valid: false, message: 'Invalid barcode value! EAN-13 requires exactly 12 digits (check digit is auto-computed)' };
    return null;
  },
  EAN8: (text, _ct, opts) => {
    const d = digitsOnly('EAN-8')(text, _ct, opts); if (d) return d;
    if (opts.strictCheckDigit === false) {
      if (text.length !== 7 && text.length !== 8) return { valid: false, message: 'Invalid barcode value! EAN-8 requires exactly 7 digits (check digit is auto-computed)' };
      return null;
    }
    if (text.length !== 7) return { valid: false, message: 'Invalid barcode value! EAN-8 requires exactly 7 digits (check digit is auto-computed)' };
    return null;
  },
  EAN5: (text) => {
    if (/[^0-9]/.test(text)) return { valid: false, message: 'EAN-5 only supports digits (0-9). Remove any non-numeric characters.' };
    if (text.length !== 5) return { valid: false, message: 'EAN-5 requires exactly 5 digits (currently ' + text.length + ')' };
    return null;
  },
  EAN2: (text) => {
    if (/[^0-9]/.test(text)) return { valid: false, message: 'EAN-2 only supports digits (0-9). Remove any non-numeric characters.' };
    if (text.length !== 2) return { valid: false, message: 'EAN-2 requires exactly 2 digits (currently ' + text.length + ')' };
    return null;
  },
  UPC: (text, _ct, opts) => {
    const d = digitsOnly('UPC-A')(text, _ct, opts); if (d) return d;
    if (opts.strictCheckDigit === false) {
      if (text.length !== 11 && text.length !== 12) return { valid: false, message: 'Invalid barcode value! UPC-A requires exactly 11 digits (check digit is auto-computed)' };
      return null;
    }
    if (text.length !== 11) return { valid: false, message: 'Invalid barcode value! UPC-A requires exactly 11 digits (check digit is auto-computed)' };
    return null;
  },
  UPCE: (text, _ct, opts) => {
    const d = digitsOnly('UPC-E')(text, _ct, opts); if (d) return d;
    if (opts.strictCheckDigit === false) {
      if (text.length !== 7 && text.length !== 6 && text.length !== 8) return { valid: false, message: 'Invalid barcode value! UPC-E requires exactly 7 digits (number system + 6 data digits; check digit is auto-computed)' };
      return null;
    }
    if (text.length !== 7) return { valid: false, message: 'Invalid barcode value! UPC-E requires exactly 7 digits (number system + 6 data digits; check digit is auto-computed)' };
    if (text[0] !== '0' && text[0] !== '1') return { valid: false, message: 'UPC-E must start with number system 0 or 1' };
    return null;
  },
  ITF14: (text, _ct, opts) => {
    const d = digitsOnly('ITF-14')(text, _ct, opts); if (d) return d;
    if (opts.strictCheckDigit === false) {
      if (text.length !== 13 && text.length !== 14) return { valid: false, message: 'Invalid barcode value! ITF-14 requires exactly 13 digits (check digit is auto-computed)' };
      return null;
    }
    if (text.length !== 13) return { valid: false, message: 'Invalid barcode value! ITF-14 requires exactly 13 digits (check digit is auto-computed)' };
    return null;
  },
  ITF: (text, checksumType) => {
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
  MSI:     (text, ct, opts) => digitsOnly('MSI formats')(text, ct, opts),
  MSI10:   (text, ct, opts) => digitsOnly('MSI formats')(text, ct, opts),
  MSI11:   (text, ct, opts) => digitsOnly('MSI formats')(text, ct, opts),
  MSI1010: (text, ct, opts) => digitsOnly('MSI formats')(text, ct, opts),
  MSI1110: (text, ct, opts) => digitsOnly('MSI formats')(text, ct, opts),
  codabar: (text, checksumType) => {
    if (!/^[0-9\-\$\:\/\.\+]+$/.test(text)) {
      return { valid: false, message: 'Codabar only supports digits (0-9) and symbols: -, $, :, /, ., +' };
    }
    // Spec-driven checksum constraints — without these, the applier silently
    // returns the text with no check digit and the user thinks the option is broken.
    if (checksumType === 'japanNW7' && text.length !== 10) {
      return { valid: false, message: 'Codabar + Japan NW-7 (JIS X 0503) requires exactly 10 characters' };
    }
    if (checksumType === 'mod16Japan' && text.length !== 10) {
      return { valid: false, message: 'Codabar + Modulo 16 Japan (JIS X 0503) requires exactly 10 characters' };
    }
    if (checksumType === 'mod11A' && calculateMod11AChecksum(text) === 'X') {
      return { valid: false, message: 'Codabar + Modulo 11-A: this value yields check digit "X", which is not a valid Codabar character. Try a different value or a different checksum.' };
    }
    return null;
  },
  // CODE93, qrcode, azteccode, datamatrix, pdf417, CODE128: no special validation
};

export function validateInput(
  text: string,
  format: BarcodeFormat,
  checksumType: ChecksumType = 'none',
  opts: ValidateOptions = {},
): ValidationResult {
  if (!text.trim()) {
    return { valid: false, message: 'Please enter a value' };
  }
  const validator = VALIDATION_REGISTRY[format];
  if (validator) {
    const result = validator(text, checksumType, opts);
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
/**
 * Reference DPI used to interpret pixel-valued config fields (height, margin,
 * fontSize) as a physical size. These fields define dimensions in "logical
 * pixels at BASE_DPI"; render code multiplies by `dpi / BASE_DPI` to produce
 * the actual pixel count at the configured DPI. This keeps the printed /
 * exported physical size stable when DPI changes — DPI becomes a pure
 * quality knob (more pixels per mm) instead of also changing physical size.
 */
export const BASE_DPI = 300;

/** Convert a "logical px at BASE_DPI" value to actual render pixels at `dpi`. */
export function physicalPxScale(dpi: number): number {
  return dpi / BASE_DPI;
}

/**
 * bwip-js hard-limits `textsize` to the open interval (0, 25) — passing 25 or
 * higher throws `bwipp.renmatrixBadTextsize`. Our render code multiplies the
 * user-selected fontSize by DPI scale to keep text physically consistent across
 * DPIs; at 600+ DPI that product easily exceeds bwip's ceiling and crashes the
 * 2D render path (Generate tab, Batch tab, export, print).
 *
 * Clamp to the [1, 24] integer range so we always honour bwip's contract. The
 * trade-off: at very high DPI with large fonts the human-readable text caps at
 * ~24pt instead of scaling further. This only affects the on-bar text label,
 * not the barcode modules themselves, so scannability is unchanged.
 */
export const BWIP_MAX_TEXTSIZE = 24;
export function clampBwipTextsize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(BWIP_MAX_TEXTSIZE, Math.max(1, Math.round(value)));
}

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
  // widthMils is the user's requested X-dim (intent). It's not pre-snapped —
  // snapToPixelGrid is applied non-destructively at render time so changing
  // DPI re-evaluates the actual pixel size cleanly. 7.5 mil is the GS1
  // healthcare minimum X-dimension.
  return {
    format: 'CODE39',
    text: 'BARCODE123',
    widthMils: 7.5,
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
