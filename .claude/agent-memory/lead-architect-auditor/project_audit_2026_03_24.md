---
name: Full Architectural Audit 2026-03-24
description: Comprehensive audit findings — 4 blockers, 9 debt items, 3 test gaps identified across entire barcode generator codebase
type: project
---

Full architectural audit completed 2026-03-24. STATUS: REJECTED (4 blockers).

**Blockers:**
1. Switch-statement format routing in barcodeUtils.ts (4 switches: getApplicableChecksums, applyChecksum, normalizeForRendering, validateInput) — violates registry mandate
2. XSS injection in electron/main.js print preview — imageDataUrl interpolated directly into HTML template via template literal; startsWith('data:image/') validation is bypassable with attribute-breaking payloads
3. Race condition in BarcodePreview.tsx auto-certify — no cancellation token for async certify() call; stale closure can display certificate for wrong config
4. Canvas memory leak in barcodeImageGenerator.ts generateBarcodeBlob() — creates 2 canvas elements per call, never releases; batch mode (1000 items) exhausts canvas memory

**Debt Items (9):**
1. barcodeAnalyzer.ts uses switch statements and duplicates checksum logic from validationEngine.ts
2. Missing codabar validation in validateInput() — falls through to default, accepts any input
3. MSI1010 and MSI1110 missing from BARCODE_FORMATS metadata array — exist in type but not selectable in UI
4. Dual toaster (Radix + Sonner) mounted in App.tsx — Radix is dead code, only Sonner is used
5. BarcodePreview.tsx is a 755-line God Object handling 7 concerns
6. Unsafe null dereference: getContext('2d')! used throughout without null checks
7. Magic number 7.5 in BarcodePreview.tsx certificate display instead of HEALTHCARE_X_DIM_MILS constant
8. Theme initialization contradiction between main.tsx (adds 'light') and Header.tsx (defaults isDark=true)
9. BatchGenerator.tsx useEffect for onActionsReady has incomplete dependency array — exposes stale function references

**Test Gaps (3):**
- barcodeImageScanner.ts — zero coverage
- validationService.ts certify()/roundTrip() — zero direct unit tests (only normaliseForComparison and computeISOGrade tested via validationEngine.test.ts)
- barcodeImageGenerator.ts — zero coverage

**Observation:** 322 tests pass. Test coverage is strong for pure functions in barcodeUtils.ts, validationEngine.ts, barcodeAnalyzer.ts, and effectiveWidth.test.ts. Gaps are concentrated in DOM-dependent modules.

**Why:** These findings represent the baseline state after the validation pipeline was added. Future audits should verify whether these were addressed.

**How to apply:** Reference this when reviewing PRs that touch any of these files. Blockers must be resolved before any new feature work merges.
