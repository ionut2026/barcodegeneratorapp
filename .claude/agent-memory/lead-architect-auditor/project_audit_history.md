---
name: project_audit_history
description: Complete audit trail for the 2026-03-27 session — all Phase 1 DEBT/CR findings resolved, Phase 2 decomposition complete, Phase 3 in progress. Includes test count progression.
type: project
---

# Audit History — 2026-03-27 Session

## Phase 1 — Full Codebase Audit (all findings resolved as of 2026-03-27)

### DEBT Items Fixed

| ID | Location | Issue | Resolution |
|----|----------|-------|------------|
| DEBT-1 | `validationEngine.ts` `OPTIONAL_REGISTRY` | `ean13`/`upc` ChecksumTypes were orphaned — present in CHECKSUM_APPLIER_REGISTRY and ChecksumType union, absent from OPTIONAL_REGISTRY. Caused silent `status: 'skipped'` on validate(). | Added both entries to OPTIONAL_REGISTRY |
| DEBT-2 | `barcodeUtils.ts` `BARCODE_FORMATS` array | `MSI1010` and `MSI1110` existed in all type registries but were invisible in UI — not in BARCODE_FORMATS metadata. | Added both with labels "MSI Double Mod 10" and "MSI Mod 11 + Mod 10" |
| DEBT-3 | `validationEngine.ts` `computeISOGrade` | Return type declared `'A'|'B'|'C'|'D'|'F'` but C/D paths were unreachable. `warnings` count was permanently 0, making grade B impossible. | Contracted return type to `'A'|'B'|'F'`; grade B now emitted when X-dimension is below `HEALTHCARE_X_DIM_MILS` threshold; `warnings` now correctly counts grade B results |
| DEBT-4 | `BatchGenerator.tsx` `isNumericOnly` | Phantom `CODE128C` entry (CODE128C does its own digit-only enforcement separately) and missing `UPCE` (which requires numeric-only). | Fixed both: removed CODE128C, added UPCE |
| DEBT-5 | `barcodeImageGenerator.ts` | Deprecated `unescape()` used for SVG data URL decoding — removed from the ECMAScript standard path. | Replaced with `TextEncoder`/`TextDecoder` pattern |
| DEBT-6 | `BarcodePreview.tsx` `printBarcode()` 2D path | `tempCanvas` created for 2D print rendering was never zeroed after use — leak in print flow. | Added `canvas.width = 0; canvas.height = 0` after extraction |
| DEBT-7 | `BarcodePreview.tsx` | 865-line God Object handling 9 responsibilities: render pipeline, effects, certification, export actions, print, dimensions, checksum display, preview styles, dead state. | PARTIALLY RESOLVED — see Phase 2 and Phase 3 below |
| DEBT-8 | `ChecksumCalculator.tsx` | `useEffect` with suppressed dependency array via `// eslint-disable-next-line` comment. Stale closure risk on format/value changes. | Replaced with `useMemo` and correct dependency list |
| DEBT-9 | Everywhere `window.electronAPI` is called | `(window as any).electronAPI` — raw `any` cast, no type safety on IPC calls. | Created `src/types/electron.d.ts` with full typed interface for `window.electronAPI` |

### Critical Regressions Fixed

| ID | Location | Issue | Resolution |
|----|----------|-------|------------|
| CR-1 | `BarcodePreview.tsx` clipboard path | `navigator.clipboard.writeText()` — unhandled rejection. If clipboard is denied, error silently swallowed. | Added `.catch()` handler wired to sonner toast |
| CR-2 | `BatchGenerator.tsx` ZIP export | `JSZip` image entries missing `height` parameter — rendered output could be zero-height. | Added per-item `height` from measured canvas |
| CR-3 | `BatchGenerator.tsx` PDF export | Same missing `height` parameter in jsPDF `addImage()` call. | Same fix as CR-2 |
| CR-4 | `BatchGenerator.tsx` PDF layout | All PDF pages used `pdfImages[0]` width/height for every item — items 2..n rendered with wrong dimensions if format mix. | Changed to per-item dimension tracking (`pdfImages[i]`) |
| CR-5 | `BatchGenerator.tsx` `useEffect` | Stale closure on `generateBatch` — function reference captured at effect registration time, not re-captured on dep changes. | Added `generateBatch` to dependency array and memoized with `useCallback` |
| CR-8 | `BarcodePreview.tsx` 1D print path | `img.onerror` not set. If the base64 SVG blob is malformed, the print window opens blank with no feedback. | Added `img.onerror` handler with sonner error toast + window close |
| CR-9 | Multiple canvas sites | Bare `!` non-null assertion on `canvas.getContext('2d')` — crashes if context unavailable (e.g., GPU sandbox). | Replaced with null guard: `if (!ctx) throw new Error('Canvas 2D context unavailable')` |

### Test Files Added in Phase 1

| File | Status | Test Count |
|------|--------|------------|
| `src/lib/validationRunner.test.ts` | NEW | 10 tests |
| `src/lib/barcodeUtils.test.ts` | EXTENDED | +14 tests (Japan NW7 vectors, Mod11A vectors, `applyChecksum` ean13/upc paths) |
| `src/components/BatchGenerator.test.ts` | NEW | 6 tests (UPCE regression, fixed-length format enforcement) |

**Test count after Phase 1:** 370 (baseline) → **402**

---

## Phase 2 — DEBT-7 Safe Decomposition (completed 2026-03-27)

BarcodePreview.tsx was decomposed by extracting two units with no logic disruption.

### Extractions

**`src/hooks/useCertification.ts`** — Extracted:
- State: `certificate`, `isCertifying`, `certEnabled`
- Refs: `certifyTimerRef`, `certifyGenerationRef`
- Effect: 600ms debounce certification trigger with stale-generation cancellation
- Handler: `downloadCertificate`

**`src/components/BarcodeExportActions.tsx`** — Extracted:
- 3-button export toolbar: Copy Image, Download PNG, Print
- Internal `copied` state + 2-second reset timer
- Receives `onCopy`, `onDownload`, `onPrint` props

**Dead state removal:**
- `barcodeDimensions` state in BarcodePreview — was written on render but never read anywhere in JSX or effects. Removed entirely.

**Line count:** 865 → 737 (−128 lines)

### Test Files Added in Phase 2

| File | Status | Test Count |
|------|--------|------------|
| `src/hooks/useCertification.test.ts` | NEW | 8 tests |
| `src/components/BarcodeExportActions.test.tsx` | NEW | 6 tests |
| `src/components/BarcodePreview.dead-state.test.ts` | NEW | 2 tests (confirms `barcodeDimensions` removal didn't break render) |

**Test count after Phase 2:** 402 → **418**

---

## Phase 3 — `useBarcodeRenderer` Extraction (IN PROGRESS as of 2026-03-27)

### Objective
Extract the render pipeline from `BarcodePreview.tsx` into `src/hooks/useBarcodeRenderer.ts`.

### Prerequisite Gate
Pixel-output snapshot tests for `applyEffects` and `renderExportCanvas` MUST be written and passing before extraction begins. The stale-closure coupling between these two functions is undetectable by logic tests — only pixel-level regression tests can confirm the extraction didn't break the effects pipeline.

### Critical Constraints
1. `applyEffects` and `renderExportCanvas` MUST remain co-located inside the hook (not split across files) — they share canvas state that would create a stale closure if separated.
2. `canvasRef` (the scratch canvas used for print) must be **explicitly returned** from the hook to the component — it cannot be an internal implementation detail or the print path loses its DOM reference.
3. The hook must not import from `barcodeImageGenerator.ts` — that module is consumed by BatchGenerator and ValidationService and must remain headless.

**Why:** See `project_architecture_decisions.md` for the full rationale on all three constraints.
