// Barcode analysis logic — independent of all existing features.
// Detects compatible formats and validates checksums from a raw barcode value.
//
// Architecture: dispatch is registry-based. Adding a new format requires only
// updating BARCODE_FORMATS + INTRINSIC/OPTIONAL registries in validationEngine.ts;
// this file then participates automatically. Format-specific overrides for
// confidence and checksum messaging live in the small registries below.

import { BarcodeFormat, BARCODE_FORMATS, ChecksumType, validateInput } from './barcodeUtils';
import {
  BarcodeValidator,
  ValidationException,
  ChecksumValidationResult,
} from './validationEngine';

export type ChecksumStatus = 'valid' | 'invalid' | 'not_applicable' | 'intrinsic';

export interface FormatMatch {
  format: BarcodeFormat;
  label: string;
  description: string;
  category: '1D' | '2D';
  checksumStatus: ChecksumStatus;
  checksumLabel: string;
  checksumNote: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AnalysisResult {
  input: string;
  matches: FormatMatch[];
  primaryMatch: FormatMatch | null;
}

type ChecksumEval = { status: ChecksumStatus; label: string; note: string };

// ── Checksum evaluation ──────────────────────────────────────────────────────

const validator = new BarcodeValidator();

// Formats whose checksum behaviour doesn't fit the validator pattern
// (no intrinsic check, no optional check candidates).
const CHECKSUM_OVERRIDES: Partial<Record<BarcodeFormat, ChecksumEval>> = {
  EAN5:       { status: 'not_applicable', label: '—', note: 'Supplemental add-on code; no standalone checksum' },
  EAN2:       { status: 'not_applicable', label: '—', note: 'Supplemental add-on code; no standalone checksum' },
  pharmacode: { status: 'not_applicable', label: '—', note: 'Pharmacode uses binary encoding; no separate check digit' },
};

// Formats with optional checksums: the analyzer probes each candidate algorithm
// and returns the first one that validates. If none match, the value simply has
// no detectable check character.
const OPTIONAL_CANDIDATES: Partial<Record<BarcodeFormat, ChecksumType[]>> = {
  CODE39:  ['mod43'],
  codabar: ['mod16'],
  MSI:     ['mod10', 'mod11'],
  ITF:     ['mod10'],
};

const OPTIONAL_NONE_DETECTED_NOTE: Partial<Record<BarcodeFormat, string>> = {
  CODE39:  'Mod 43 is optional for CODE 39; no valid check character detected',
  codabar: 'Checksum is optional for Codabar; no valid check character detected',
  MSI:     'Checksum is optional for MSI; none detected',
  ITF:     'Mod 10 is optional for ITF; none detected',
};

// Algorithm names mirroring INTRINSIC_REGISTRY in validationEngine — used to
// label `invalid` outcomes (which surface via ValidationException, not the
// returned ChecksumValidationResult).
const INTRINSIC_ALGORITHM_NAMES: Partial<Record<BarcodeFormat, string>> = {
  EAN13: 'EAN-13 Mod 10',
  EAN8:  'EAN-8 Mod 10',
  UPC:   'UPC-A Mod 10',
  ITF14: 'GS1 Mod 10',
};

function mapResult(cv: ChecksumValidationResult): ChecksumEval {
  switch (cv.status) {
    case 'valid':
      return { status: 'valid', label: cv.algorithm, note: cv.message };
    case 'invalid':
      return { status: 'invalid', label: cv.algorithm, note: cv.message };
    case 'intrinsic':
      return { status: 'intrinsic', label: cv.algorithm, note: cv.message };
    case 'not_applicable':
      return { status: 'not_applicable', label: '—', note: cv.message };
    case 'skipped':
    default:
      return { status: 'not_applicable', label: '—', note: cv.message };
  }
}

function evaluateChecksum(input: string, format: BarcodeFormat): ChecksumEval {
  const override = CHECKSUM_OVERRIDES[format];
  if (override) return override;

  const candidates = OPTIONAL_CANDIDATES[format];
  if (candidates) {
    for (const candidate of candidates) {
      try {
        const result = validator.validate(input, format, candidate);
        if (result.checksumValidation.status === 'valid') {
          return mapResult(result.checksumValidation);
        }
      } catch (e) {
        // ValidationException = strict-match mismatch on this candidate.
        // Optional checksums tolerate misses; try the next candidate.
        if (e instanceof ValidationException) continue;
        throw e;
      }
    }
    return {
      status: 'not_applicable',
      label: '—',
      note: OPTIONAL_NONE_DETECTED_NOTE[format] ?? 'No valid check character detected',
    };
  }

  try {
    const result = validator.validate(input, format);
    return mapResult(result.checksumValidation);
  } catch (e) {
    if (e instanceof ValidationException) {
      const label = INTRINSIC_ALGORITHM_NAMES[e.format] ?? e.format;
      return { status: 'invalid', label, note: e.details };
    }
    throw e;
  }
}

// ── Confidence scoring ───────────────────────────────────────────────────────

type ConfidenceFn = (input: string, isNumeric: boolean) => 'high' | 'medium' | 'low';

const CONFIDENCE_REGISTRY: Partial<Record<BarcodeFormat, ConfidenceFn>> = {
  EAN13: (i, n) => (i.length === 12 || i.length === 13) && n ? 'high' : 'medium',
  EAN8:  (i, n) => (i.length === 7 || i.length === 8) && n ? 'high' : 'medium',
  EAN5:  (i, n) => i.length === 5 && n ? 'high' : 'medium',
  EAN2:  (i, n) => i.length === 2 && n ? 'high' : 'medium',
  UPC:   (i, n) => (i.length === 11 || i.length === 12) && n ? 'high' : 'medium',
  UPCE:  (i, n) => i.length >= 6 && i.length <= 8 && n ? 'high' : 'medium',
  ITF14: (i, n) => (i.length === 13 || i.length === 14) && n ? 'high' : 'medium',
  pharmacode: (i, n) => {
    const num = parseInt(i, 10);
    return n && num >= 3 && num <= 131070 ? 'high' : 'low';
  },
  CODE39:  (i) => /^[A-Z0-9\-\.\s\$\/\+\%]+$/.test(i.toUpperCase()) ? 'medium' : 'low',
  codabar: (i) => /^[0-9\-\$\:\/\.\+]+$/.test(i) ? 'medium' : 'low',
  ITF:     (_, n) => n ? 'medium' : 'low',
  MSI:     (_, n) => n ? 'medium' : 'low',
  MSI10:   (_, n) => n ? 'medium' : 'low',
  MSI11:   (_, n) => n ? 'medium' : 'low',
  MSI1010: (_, n) => n ? 'medium' : 'low',
  MSI1110: (_, n) => n ? 'medium' : 'low',
};

function getConfidence(input: string, format: BarcodeFormat): 'high' | 'medium' | 'low' {
  const isNumeric = /^\d+$/.test(input);
  const fn = CONFIDENCE_REGISTRY[format];
  return fn ? fn(input, isNumeric) : 'low';
}

// ── Public API ───────────────────────────────────────────────────────────────

export function analyzeBarcode(input: string): AnalysisResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { input: trimmed, matches: [], primaryMatch: null };
  }

  const matches: FormatMatch[] = [];

  for (const formatDef of BARCODE_FORMATS) {
    const validation = validateInput(trimmed, formatDef.value);
    if (!validation.valid) continue;

    const checksumResult = evaluateChecksum(trimmed, formatDef.value);
    const confidence = getConfidence(trimmed, formatDef.value);

    matches.push({
      format: formatDef.value,
      label: formatDef.label,
      description: formatDef.description,
      category: formatDef.category,
      checksumStatus: checksumResult.status,
      checksumLabel: checksumResult.label,
      checksumNote: checksumResult.note,
      confidence,
    });
  }

  // Sort: high confidence first, then medium, then low. Within equal confidence, 1D before 2D.
  const confidenceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const categoryOrder: Record<string, number> = { '1D': 0, '2D': 1 };
  matches.sort((a, b) => {
    if (confidenceOrder[a.confidence] !== confidenceOrder[b.confidence]) {
      return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    }
    return categoryOrder[a.category] - categoryOrder[b.category];
  });

  return {
    input: trimmed,
    matches,
    primaryMatch: matches.length > 0 ? matches[0] : null,
  };
}
