---
name: project_remaining_debt
description: Technical debt items that remain after Phase 3 of the 2026-03-27 session. Three items deferred by deliberate architectural decision, not oversight.
type: project
---

# Remaining Technical Debt — Post Phase 3 State

All items below were evaluated during the 2026-03-27 audit. They were NOT addressed in Phase 3 by deliberate decision. Each has a documented reason for deferral.

---

## 1. Print Path Decomposition

**What:** `printBarcode()` in `BarcodePreview.tsx` contains nested closures `openPrintWindow` and `dispatchPrint`. The IPC call `window.electronAPI.openPrintWindow()` lives inside `dispatchPrint`.

**Why deferred:** Moving an IPC call into a more-reusable hook (`usePrintBarcode.ts`) before the preload bridge is formally audited would compound security debt. The type declaration in `src/types/electron.d.ts` was created in Phase 1 (DEBT-9), but the IPC call itself has not been traced through `electron/preload.js` to confirm the handler sanitizes the payload on the main-process side.

**Prerequisite to extraction:**
1. Audit `electron/preload.js` — confirm `openPrintWindow` IPC handler sanitizes all arguments before passing to `BrowserWindow`.
2. Confirm no raw HTML or user data flows from renderer to main process through this channel.
3. Only then extract to `src/hooks/usePrintBarcode.ts`.

**Risk if ignored:** An IPC channel that accepts unsanitized renderer-side data is an escalation path in Electron's threat model. The XSS fix from the 2026-03-24 audit (CR-2 in that session's blockers) addressed `electron/main.js`'s print preview template — the preload bridge on the renderer side is the remaining exposure.

---

## 2. PixelEffectsProcessor Unification

**What:** Two modules contain duplicated canvas render logic:
- `renderExportCanvas` in `BarcodePreview.tsx` (or `useBarcodeRenderer.ts` after Phase 3)
- `generateBarcodeImage` in `barcodeImageGenerator.ts`

The duplication covers: 1D render path (SVG → Canvas), 2D render path (bwip-js direct), effects application, and output encoding (base64 in the generator, Blob URL in the preview).

**Why deferred:** `barcodeImageGenerator.ts` is consumed by both `BatchGenerator.tsx` and the validation pipeline (`ValidationService`). Merging the effects pipeline into it would:
- Couple a headless renderer to the UI effects system (`ImageEffects.tsx`)
- Force `BatchGenerator` and `ValidationService` to carry the effects dependency even when not generating visual output
- Violate the headless/UI separation that makes batch processing efficient

**The correct approach (future sprint):** Introduce a `RenderPipeline` abstraction that both `barcodeImageGenerator` and `useBarcodeRenderer` delegate to for the raw canvas operations, while keeping effects as an optional post-processing stage that `barcodeImageGenerator` never touches.

**Risk if ignored:** The two render paths will continue to drift. Any fix applied to one (e.g., a JsBarcode options change) must be manually applied to the other. This has already happened at least once.

---

## 3. BarcodePreview JSX Componentization

**What:** After Phase 3, `BarcodePreview.tsx` will still contain JSX-level responsibilities that could be further componentized:
- `getPreviewStyles()` inline style computation
- Checksum info panel
- Dimensions display panel
- Certification result panel
- Effects debug bar

**Why deferred:** These are UI-only concerns with no logic to test. They carry no architectural risk. Decomposing them before the render pipeline extraction (Phase 3) is complete would create merge conflicts and make the Phase 3 diff harder to review.

**Priority:** Low. Address after Phase 3 is merged and the line count delta is confirmed stable.

---

## Tracking Note

Items 1 and 2 are load-bearing deferral decisions. Do not collapse them into the next sprint without re-reading the rationale. Item 3 is cosmetic and can be done opportunistically.

See `project_architecture_decisions.md` for the formal decision records behind items 1 and 2.
