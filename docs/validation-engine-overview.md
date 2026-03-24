# Barcode Validation Engine — Technical Overview

**Project:** Barcode Generator Application
**Date:** March 2026
**Scope:** Universal, high-integrity barcode validation pipeline

---

## Executive Summary

The Validation Engine is a three-layer system that independently verifies barcode integrity at every stage of the generation lifecycle. It catches check-digit errors before rendering, confirms the rendered image is physically scannable, and produces an ISO 15416-inspired compliance certificate that can be stored, audited, and exported. Every format and algorithm is registered in plain data structures — no switch statements, no hard-coded format lists — so adding a new barcode standard requires only a single registry entry.

---

## 1. The Problem

Barcode generation without validation has three silent failure modes:

| Failure Mode | Symptom | Real-World Impact |
|---|---|---|
| Wrong check digit in the input data | Barcode renders, scanners reject it | Shipment or product label is non-scannable at point of use |
| Rendering defect (fractional bar widths, clipped symbol) | Image looks fine on screen, scanner cannot decode it | Downstream system failure, manual re-entry |
| X-dimension below healthcare minimum | Barcode reads on a desktop scanner, fails on handheld in clinical use | Regulatory non-compliance (ISO 15416 / GS1 Healthcare) |

The Validation Engine addresses all three failure modes in a single, automated pipeline.

---

## 2. Architecture — Three Layers

```
┌─────────────────────────────────────────────────────┐
│  Layer 1 — ValidationEngine  (validationEngine.ts)  │
│  Registry-based static checksum verification        │
│  Throws ValidationException on check-digit mismatch │
├─────────────────────────────────────────────────────┤
│  Layer 2 — ValidationService (validationService.ts) │
│  Renders barcode → ZXing round-trip scan            │
│  Produces ValidationCertificate (ISO grade A–F)     │
├─────────────────────────────────────────────────────┤
│  Layer 3 — ValidationRunner  (validationRunner.ts)  │
│  Batch execution of TestCase arrays                 │
│  Progress callbacks, aggregate pass/fail/warn stats │
└─────────────────────────────────────────────────────┘
```

---

## 3. Layer 1 — Validation Engine

### 3.1 Design Principle: Registry Over Switch

All routing is via two plain JavaScript records. The `validate()` method contains **no switch statements and no if-else chains on format names**. Adding a new barcode format means adding one entry to a registry — nothing else changes.

### 3.2 Intrinsic Checksum Registry

Formats where a check digit is always computed (or where error correction is encoding-level):

| Format | Algorithm | Behaviour |
|---|---|---|
| EAN-13 | Mod 10 (GS1) | 12-digit input → `not_applicable` (renderer adds check); 13-digit → strict verify |
| EAN-8 | Mod 10 | 7-digit → `not_applicable`; 8-digit → strict verify |
| UPC-A | Mod 10 | 11-digit → `not_applicable`; 12-digit → strict verify |
| UPC-E | — | `intrinsic` — requires UPC-A expansion; scanner verifies |
| ITF-14 | GS1 Mod 10 | 13-digit → `not_applicable`; 14-digit → strict verify |
| CODE 128 | Mod 103 | `intrinsic` — encoding-level; auto-verified by scanner |
| CODE 93 | Mod 47 × 2 | `intrinsic` — dual encoding-level checksums |
| MSI-10/11/1010/1110 | Mod 10 / Mod 11 variants | `intrinsic` — check digit appended during rendering |
| QR Code | Reed-Solomon | `intrinsic` — error correction embedded in 2D symbol |
| Aztec Code | Reed-Solomon | `intrinsic` |
| Data Matrix | Reed-Solomon | `intrinsic` |
| PDF417 | Reed-Solomon | `intrinsic` |

### 3.3 Optional Checksum Registry

Formats where the application can optionally append a check character:

| ChecksumType key | Algorithm Name | Used by |
|---|---|---|
| `mod10` | Mod 10 (Luhn) | ITF, MSI |
| `mod11` | Mod 11 | ITF, MSI, industrial |
| `mod43` | Mod 43 (Code 39) | CODE 39 |
| `mod16` | Mod 16 (Codabar) | Codabar |
| `japanNW7` | Japan NW-7 | Codabar (Japan) |
| `jrc` | JRC | Industrial |
| `luhn` | Luhn | Financial / ID cards |
| `mod11PZN` | Mod 11 PZN | German pharmacy (PZN) |
| `mod11A` | Mod 11-A | European postal |
| `mod10Weight2` | Mod 10 Weight 2 | Interleaved / logistics |
| `mod10Weight3` | Mod 10 Weight 3 | Logistics |
| `7CheckDR` | 7 Check DR | Deutsche Bahn |
| `mod16Japan` | Mod 16 Japan | Codabar Japan variant |

### 3.4 Validation Flow

```
validate(value, format, checksumType)
         │
         ├─► INTRINSIC_REGISTRY[format] exists?
         │       YES → run intrinsicFn(value)
         │               status === 'invalid'? → throw ValidationException  ← Strict Match
         │               otherwise             → return ValidationResult
         │
         ├─► checksumType !== 'none'?
         │       YES → evaluateOptional(value, checksumType)
         │               (slice last char as provided, compute expected from body)
         │               status === 'invalid'? → throw ValidationException  ← Strict Match
         │               otherwise             → return ValidationResult
         │
         └─► No checksum configured → status: 'skipped' → return ValidationResult
```

### 3.5 ValidationException — Data Integrity Guard

```ts
throw new ValidationException(
  `Strict Match failed for EAN13: Check digit should be 7, got 0`,
  'EAN13',           // format
  '5901234123450',   // value that was rejected
  'Check digit should be 7, got 0',  // details
);
```

When a `ValidationException` is thrown the barcode is **not rendered**. The UI surfaces the error message to the user so they can correct the check digit before proceeding.

### 3.6 ChecksumValidationResult Shape

```ts
interface ChecksumValidationResult {
  status:    'valid' | 'invalid' | 'not_applicable' | 'intrinsic' | 'skipped';
  algorithm: string;   // e.g. "EAN-13 Mod 10"
  expected:  string | null;
  provided:  string | null;
  message:   string;
}
```

---

## 4. Layer 2 — Validation Service

### 4.1 Full Pipeline

```
certify(BarcodeConfig)
    │
    ├─ Step 1: BarcodeValidator.validateConfig(config)
    │          → throws ValidationException → abort, grade F, record error
    │
    ├─ Step 2: generateBarcodeImage(text, format, scale, margin)
    │          → PNG data-URL (headless canvas, no DOM required)
    │          → failure → abort, grade F, record error
    │
    ├─ Step 3: ZXing BrowserMultiFormatReader.decodeFromImageUrl(dataUrl)
    │          → decoded text (or NotFoundException / FormatException / ChecksumException)
    │
    ├─ Step 4: Bit-perfect comparison
    │          normalizeForRendering(decoded, format) === normalizeForRendering(expected, format)
    │          (strips intrinsic check digits for format-agnostic comparison)
    │
    ├─ Step 5: computeISOGrade(roundTripSuccess, bitPerfectMatch, checksumStatus, xDimensionMils)
    │
    └─ Step 6: Return ValidationCertificate (never throws — all errors in .errors[])
```

### 4.2 ZXing Decode Configuration

The service decodes against all 13 supported formats simultaneously:

```
QR_CODE, AZTEC, DATA_MATRIX, PDF_417,
CODE_128, CODE_39, CODE_93,
EAN_13, EAN_8, UPC_A, UPC_E, ITF, CODABAR
```

`TRY_HARDER = true` is enabled so that small or low-contrast images are still decoded.

### 4.3 Normalisation for Bit-Perfect Comparison

EAN-13, UPC-A, and ITF-14 have intrinsic check digits. ZXing returns the **full value including the check digit**. The input may be the **body only** (user supplies 12 digits, renderer adds the 13th). Without normalisation, the comparison would always fail.

`normalizeForRendering(text, format)` strips the check digit from both sides before comparison, making the match format-agnostic.

### 4.4 ISO Compliance Grade

| Grade | Round-Trip | Bit-Perfect | Checksum | X-Dimension |
|---|---|---|---|---|
| **A** | Pass | Pass | any except invalid | ≥ 7.5 mils |
| **B** | Pass | Pass | any except invalid | < 7.5 mils |
| **F** | Fail OR mismatch OR checksum invalid | — | — | — |

Formats without a checksum (`skipped` / `not_applicable`) are not penalised — a scannable barcode with no checksum still qualifies for Grade A/B based solely on X-dimension.

The 7.5 mil threshold (`HEALTHCARE_X_DIM_MILS = 7.5`) is the ISO 15416 / GS1 Healthcare minimum bar X-dimension for clinical scanning equipment.

### 4.5 ValidationCertificate — Example

```json
{
  "timestamp": "2026-03-23T14:22:10.000Z",
  "symbologyDetected": "EAN-13",
  "rawData": "590123412345",
  "decodedData": "5901234123457",
  "checksumCalculationStatus": {
    "status": "not_applicable",
    "algorithm": "EAN-13 Mod 10",
    "expected": null,
    "provided": null,
    "message": "12-digit input — check digit will be computed by renderer"
  },
  "isoGrade": "A",
  "bitPerfectMatch": true,
  "roundTripSuccess": true,
  "xDimensionMils": 7.5,
  "xDimensionCompliant": true,
  "errors": [],
  "testLabel": "EAN-13 Healthcare Label"
}
```

---

## 5. Layer 3 — Validation Runner

The runner executes a batch of `TestCase` descriptors, merges each with the application's default `BarcodeConfig`, calls `certify()`, and aggregates results.

### 5.1 Usage Example

```ts
import { runValidationSuite, TestCase } from './validationRunner';

const cases: TestCase[] = [
  { value: '590123412345', format: 'EAN13',   widthMils: 7.5, label: 'EAN-13 healthcare' },
  { value: 'HELLO',        format: 'CODE39',  checksumType: 'mod43', label: 'CODE39+Mod43' },
  { value: '00012345600012', format: 'ITF14', widthMils: 5.0, label: 'ITF-14 sub-threshold' },
];

const result = await runValidationSuite(cases, (done, total, cert) => {
  console.log(`[${done}/${total}] ${cert.testLabel}: Grade ${cert.isoGrade}`);
});

console.log(`Passed: ${result.passed}  Failed: ${result.failed}  Warnings: ${result.warnings}`);
console.log(`Duration: ${result.durationMs}ms`);
```

### 5.2 ValidationSuiteResult

```ts
interface ValidationSuiteResult {
  total:        number;                  // test cases run
  passed:       number;                  // grade A or B
  failed:       number;                  // grade F
  warnings:     number;                  // grade C or D
  certificates: ValidationCertificate[]; // one per test case
  durationMs:   number;                  // wall-clock time
}
```

---

## 6. Test Coverage

All three layers are exercised by `src/lib/validationEngine.test.ts` (79 test cases):

| Test Group | Cases | What is Verified |
|---|---|---|
| `ValidationException` shape | 2 | Is Error subclass, correct properties |
| EAN-13 intrinsic | 4 | 12-digit not_applicable, 13-digit pass, 13-digit fail+throw, validateConfig delegate |
| EAN-8 intrinsic | 3 | Same pattern as EAN-13 |
| UPC-A intrinsic | 3 | Same pattern |
| ITF-14 intrinsic | 3 | GS1 Mod 10 vector, pass, fail+throw |
| Encoding-level / 2D intrinsic | 10 | All 10 formats → status: intrinsic |
| CODE 39 Mod 43 | 4 | skipped, valid, throw on wrong, throw when body lacks check |
| Codabar Mod 16 | 2 | valid, throw on wrong |
| MSI optional (Mod10, Mod11) | 2 | Known test vectors |
| ITF optional (Mod10) | 1 | Body + computed check → valid |
| OPTIONAL_REGISTRY completeness | 13 | Every algorithm key is wired (not 'skipped') |
| All BARCODE_FORMATS produce result | 22 | Dynamic discovery — every format gives a defined status |
| `computeISOGrade` | 9 | All grade combinations + boundary at 7.5 mils |
| `validateConfig()` wrapper | 2 | Delegates format+checksumType, propagates exception |

The `computeISOGrade` boundary tests explicitly verify:
- `xDimensionMils = 7.5` → grade A (at the threshold, qualifies)
- `xDimensionMils = 7.4` → grade B (just below the threshold)

---

## 7. Requirements-to-Implementation Mapping

| Requirement | Implementation |
|---|---|
| Independently verify check digits | `INTRINSIC_REGISTRY` per-format functions recalculate from first principles |
| Block generation on bad check digit | `ValidationException` thrown before `generateBarcodeImage()` is called |
| Support optional checksums (CODE39, Codabar, …) | `OPTIONAL_REGISTRY` keyed by `ChecksumType`; `evaluateOptional()` strips last char |
| Extensible without editing core logic | Registry entries only; `validate()` has no format switch |
| Confirm rendered image is scannable | ZXing `BrowserMultiFormatReader.decodeFromImageUrl()` round-trip |
| Bit-perfect data integrity | `normalizeForRendering()` applied to both decoded and expected before comparison |
| ISO 15416 X-dimension compliance | `xDimensionMils >= HEALTHCARE_X_DIM_MILS (7.5)` check in `computeISOGrade()` |
| Audit trail per barcode | `ValidationCertificate` — JSON-serializable, includes timestamp, grade, decoded data, errors |
| Batch testing | `runValidationSuite(TestCase[], onProgress?)` — sequential, progress callbacks, aggregate stats |
| Never throw from batch runner | `certify()` catches all exceptions internally; errors surface in `certificate.errors[]` |

---

## 8. File Inventory

| File | Role |
|---|---|
| `src/lib/validationEngine.ts` | Layer 1: `BarcodeValidator`, registries, `ValidationException` |
| `src/lib/validationService.ts` | Layer 2: `ValidationService`, `computeISOGrade`, `ValidationCertificate` |
| `src/lib/validationRunner.ts` | Layer 3: `runValidationSuite`, `TestCase`, `ValidationSuiteResult` |
| `src/lib/validationEngine.test.ts` | 79-case unit test suite (Vitest) |
| `src/lib/barcodeUtils.ts` | Checksum algorithm implementations, format registry |
| `src/lib/barcodeImageGenerator.ts` | Headless PNG generation (used by `certify()` in Step 2) |
