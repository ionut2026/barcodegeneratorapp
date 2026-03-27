---
name: project_architecture_decisions
description: Formal architectural decisions made during the 2026-03-27 session with rationale. These are binding constraints for future audits.
type: project
---

# Architectural Decisions — 2026-03-27

These decisions were made during the full codebase audit and decomposition sprint. They are binding. Future PRs that contradict these decisions require explicit re-audit and justification.

---

## AD-1: `computeISOGrade` Contracted to `'A'|'B'|'F'`

**Decision:** Removed `'C'` and `'D'` from the return type of `computeISOGrade` in `validationEngine.ts`. `warnings` in `ValidationSuiteResult` now counts grade B results (below the `HEALTHCARE_X_DIM_MILS = 7.5` threshold but not a failure).

**Rationale:** C and D grades were structurally unreachable — the branching logic could never produce them. Keeping them in the return type was a false promise to callers and a source of dead conditional code in consumers. Contracting the type eliminates the dead paths and makes the grade semantics honest.

**Impact:**
- `BarcodePreview.tsx` — any `grade === 'C'` or `grade === 'D'` rendering logic must be removed
- `ChecksumCalculator.tsx` — same
- Any component that switches or maps over `ISOGrade` must be updated to the 3-value union

**Date:** 2026-03-27

---

## AD-2: `useBarcodeRenderer` Extraction Gated on Snapshot Tests

**Decision:** The extraction of the render pipeline from `BarcodePreview.tsx` into `src/hooks/useBarcodeRenderer.ts` may not proceed until pixel-output snapshot tests for `applyEffects` and `renderExportCanvas` are written and passing.

**Rationale:** `applyEffects` reads from and writes to the same canvas that `renderExportCanvas` produces. They share a closure reference to the canvas state. A refactor that moves them to different files — even if logically correct — can introduce a stale-closure bug that is invisible to unit tests (which test logic, not pixel state). Only snapshot tests that compare actual canvas output before and after extraction can provide the required confidence.

**Constraint from this decision:** The two functions MUST remain co-located inside `useBarcodeRenderer.ts`. They must not be split into separate files even if the hook grows large.

**Date:** 2026-03-27

---

## AD-3: Print Path NOT Extracted in Phase 3

**Decision:** `printBarcode()` with its nested `openPrintWindow`/`dispatchPrint` closures was deliberately left in `BarcodePreview.tsx` (or the future `useBarcodeRenderer.ts`) and not extracted to a standalone `usePrintBarcode.ts` hook.

**Rationale:** `dispatchPrint` contains the call to `window.electronAPI.openPrintWindow()`. The preload bridge (`electron/preload.js`) for this channel has not been audited for payload sanitization on the main-process side. Moving an unaudited IPC call into a more-reusable hook increases its attack surface. The XSS fix in the 2026-03-24 audit addressed the main process HTML template injection — the renderer-side IPC argument sanitization is the remaining exposure.

**Prerequisites before extraction:**
1. Full audit of `electron/preload.js` confirming the `openPrintWindow` handler.
2. Confirmation that no user-controlled string reaches the main process without sanitization.

**Date:** 2026-03-27

---

## AD-4: `barcodeImageGenerator.ts` Must Not Be Coupled to Effects System

**Decision:** The `applyEffects` function and the effects pipeline (driven by `ImageEffects.tsx`) must NOT be added to `barcodeImageGenerator.ts` as an optional parameter or imported dependency.

**Rationale:** `barcodeImageGenerator.ts` is a headless renderer consumed by `BatchGenerator.tsx` and the `ValidationService`. It currently has no dependency on UI systems. Adding `applyEffects` — even optionally — would:
1. Force `BatchGenerator` to carry the `ImageEffects` dependency even for plain batch exports.
2. Force `ValidationService` to carry it, introducing a UI module into a pure validation pipeline.
3. Create a circular or layered dependency violation (`lib` → `components/effects`).

The correct long-term solution is a `RenderPipeline` abstraction (see `project_remaining_debt.md` item 2) that provides raw canvas operations to both modules without coupling them.

**Date:** 2026-03-27

---

## AD-5: `MSI1010`/`MSI1110` Added to `BARCODE_FORMATS`

**Decision:** `MSI1010` and `MSI1110` were added to the `BARCODE_FORMATS` metadata array in `barcodeUtils.ts` with display labels "MSI Double Mod 10" and "MSI Mod 11 + Mod 10".

**Rationale:** Both formats existed in the `BarcodeFormat` enum, `CHECKSUM_APPLIER_REGISTRY`, and all validation registries, but were absent from `BARCODE_FORMATS`. This made them phantom formats — registered but unreachable in the UI. The registry mandate requires that any `BarcodeFormat` enum value have a corresponding entry in ALL relevant registries including the metadata array.

**Impact:** Both formats are now selectable in the UI barcode format picker and covered by `barcodeAnalyzer.ts` batch analysis.

**Date:** 2026-03-27

---

## AD-6: `src/types/electron.d.ts` as the Single IPC Type Authority

**Decision:** All typed access to `window.electronAPI` must go through `src/types/electron.d.ts`. The `(window as any).electronAPI` pattern is permanently banned.

**Rationale:** `(window as any)` casts defeat the TypeScript type system entirely at the IPC boundary — the highest-risk interface in any Electron app. The declaration file extends `Window` with a typed `ElectronAPI` interface so all callers get compile-time checking on method names and argument types.

**Enforcement:** Any new IPC method added to the preload bridge must have a corresponding entry in `ElectronAPI` in `src/types/electron.d.ts` before the renderer-side call is written. IPC additions without type declarations are a [BLOCKER].

**Date:** 2026-03-27
