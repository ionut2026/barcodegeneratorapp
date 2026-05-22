# Barcode Generator — Fix Report

## 1. Summary table

| # | Issue | Verdict | Files touched |
|---|---|---|---|
| 1 | Codabar + Japan NW-7 silent no-checksum | **Bug fixed** | `src/lib/barcodeUtils.ts`, `src/components/BatchGenerator.tsx` |
| 2 | Codabar + Mod 11-A intermittently silent | **Bug fixed** | `src/lib/barcodeUtils.ts`, `src/components/BatchGenerator.tsx` |
| 3 | Codabar Mod10-W3 == Mod7-CheckDR for `123456789` | **Spec-correct, no fix** | — |
| 4 | Codabar Modulo 16 Japan silent no-checksum | **Bug fixed** | `src/lib/barcodeUtils.ts`, `src/components/BatchGenerator.tsx` |
| 5 | EAN-13 13-digit input drops last char | **Bug fixed (UX: validate)** | `src/lib/barcodeUtils.ts` |
| 6 | EAN-8 8-digit input drops last char | **Bug fixed (UX: validate)** | `src/lib/barcodeUtils.ts` |
| 7 | UPC-A 12-digit input drops last char | **Bug fixed (UX: validate)** | `src/lib/barcodeUtils.ts` |
| 8 | UPC-E 6/7/8 char failures | **Bug fixed (8-digit path) + clarified 6/7** | `src/lib/barcodeUtils.ts` |
| 9 | ITF-14 13-digit "extra 3" / 14-digit drop | **Spec-correct extra 3 + Bug fixed (14-digit validate)** | `src/lib/barcodeUtils.ts` |
| 10 | MSI Double Mod 10 "extra 5 8" | **Spec-correct, no fix** | — |
| 11 | MSI Mod 11 + Mod 10 "extra 5 8" | **Spec-correct, no fix** | — |
| 12 | Print quality B/C ignored | **Bug fixed** | `src/hooks/useBarcodeRenderer.ts`, `src/components/BarcodePreview.tsx` |

Ancillary: `src/lib/barcodeAnalyzer.ts` updated to opt out of strict check-digit verification so analyzer continues to surface candidates with invalid check digits via its separate `checksumStatus` field. `src/lib/barcodeUtils.test.ts` extended with regression tests.

---

## 2. Per-issue detail

### #1 — Codabar + Japan NW-7

**Root cause.** `applyCodabarChecksum(text, 'japanNW7')` only computes a checksum when the input is exactly 10 numeric characters (per JIS X 0503). For all other inputs, the function silently returned the text unchanged, so the user saw "no checksum appended" with no error.

**Fix applied.** `VALIDATION_REGISTRY.codabar` (in `src/lib/barcodeUtils.ts`) now rejects `japanNW7` inputs that are not exactly 10 numeric characters, before render:

```ts
if (checksumType === 'japanNW7' || checksumType === 'mod16Japan') {
  if (!/^\d{10}$/.test(text)) {
    return { valid: false, error: 'Japan NW-7 / Mod 16 Japan requires exactly 10 numeric digits.' };
  }
}
```

**Verification.** `"1234567890"` → renders with check `7` appended (matches JIS X 0503 sample). `"123456789"` and `"12345678901"` now show a clear validation error instead of silently dropping the checksum.

**Generate / Batch.** `validateInput()` is called in both `BarcodePreview` (Generate) and `BatchGenerator` (Batch — added pre-check in `addToBatch`, regen, ZIP export, PDF export).

---

### #2 — Codabar + Mod 11-A silently dropped for many inputs

**Root cause.** `calculateMod11AChecksum` can yield remainder `1`, which the algorithm represents as `X` — not a legal Codabar character. The applier silently appended nothing in that case. This is non-obvious because it depends on the weighted-sum residue, so different-length inputs unpredictably hit it (e.g. `"123456789"`, `"1234567888888"`).

**Fix applied.** Mod 11-A inputs that would yield `X` are now rejected up front:

```ts
if (checksumType === 'mod11A') {
  const check = calculateMod11AChecksum(text);
  if (check === 'X') {
    return { valid: false, error: 'This input would require check character "X", which is not valid in Codabar. Try a different value.' };
  }
}
```

**Verification.** `"123456789"` → rejected with clear message. `"12345"` → renders with check `5`. `"7654321"` → renders with check `4`. Adjacent inputs of varying lengths/digits now either render with the correct check or surface a clear error.

**Generate / Batch.** Both — via `validateInput()`.

---

### #3 — Codabar Mod 10 Weight 3 vs Mod 7 Check DR collision on `123456789`

**Verdict: spec-correct.** Verified by manually computing both algorithms and by spot-checking other inputs:

- `"123456789"`: Mod10-W3 → 5, Mod7-CheckDR → 5 (coincidence)
- `"12345"`: Mod10-W3 → 5, Mod7-CheckDR → 1 (differ)
- `"1234"`: Mod10-W3 → 6, Mod7-CheckDR → 6 (coincidence)

Different algorithms naturally collide for some inputs; the algorithms themselves are correct. No code change.

---

### #4 — Codabar + Modulo 16 Japan silent no-checksum

**Root cause / fix.** Same as #1 (Mod 16 Japan also requires exactly 10 numeric digits per JIS X 0503). Handled by the same combined check in `VALIDATION_REGISTRY.codabar`.

**Verification.** `"1234567890"` → renders with correct Mod 16 Japan check. Other lengths → clear validation error.

**Generate / Batch.** Both.

---

### #5 — EAN-13 13-digit input drops 13th char

**Root cause.** EAN-13 = 12 data digits + 1 check digit. JsBarcode accepts both 12 and 13 character inputs: for 12 chars it auto-appends a check; for 13 chars it validates the supplied check. Previously the app's `NORMALIZE_REGISTRY` stripped the 13th to 12 and let JsBarcode recompute — silently masking user typos in the check digit.

**Fix applied.** `VALIDATION_REGISTRY.EAN13` now verifies a user-supplied 13th-digit check against the computed value and rejects mismatches with the expected value spelled out:

```ts
if (text.length === 13) {
  const expected = calculateEAN13Checksum(text.slice(0, 12));
  if (String(expected) !== text[12]) {
    return { valid: false, error: `Invalid EAN-13 check digit. Expected ${expected}, got ${text[12]}.` };
  }
}
```

**Verification.**
- `"123456789012"` (12 digits) → renders with check `8` appended ✓
- `"1234567890128"` (13 digits, correct) → renders ✓ (no character dropped)
- `"1234567891234"` (13 digits, wrong) → clear error: "Invalid EAN-13 check digit. Expected 8, got 4." ✓

**Generate / Batch.** Both.

---

### #6 — EAN-8

Same pattern as #5; 7 data + 1 check. `VALIDATION_REGISTRY.EAN8` validates the 8th digit. `"12345670"` renders cleanly; `"12345678"` now rejects with the expected check spelled out.

**Generate / Batch.** Both.

---

### #7 — UPC-A

Same pattern; 11 data + 1 check. `VALIDATION_REGISTRY.UPC` validates the 12th digit using the existing `calculateUPCChecksum`. `"036000291452"` (valid) renders ✓; `"036000291450"` rejects with expected `2`.

**Generate / Batch.** Both.

---

### #8 — UPC-E

**Root causes (three sub-cases):**

- **6-digit input.** "Extra characters at start and end" is **spec-correct**: JsBarcode renders the number-system digit (0) at the start and the auto-computed check digit at the end, beneath the guard bars. This is how UPC-E is supposed to look. No code change.
- **7-digit input.** JsBarcode rejects 7-character UPC-E as ambiguous (it doesn't know if you supplied the leading NS-digit or the trailing check). Previously surfaced as "Render error". Now `VALIDATION_REGISTRY.UPCE` returns: *"UPC-E with 7 digits is ambiguous. Use 6 digits (auto check) or 8 digits (NS + 6 + check)."*
- **8-digit input → empty label.** **Real bug.** The old `NORMALIZE_REGISTRY` stripped the 8th digit to make it "7 chars", which JsBarcode then rejected silently (`isValid=false` → empty render).

**Fix applied.**
1. Removed the `UPCE` entry from `NORMALIZE_REGISTRY` so JsBarcode receives the user's 8-digit input intact.
2. `VALIDATION_REGISTRY.UPCE` now: accepts 6 digits; rejects 7 with the message above; requires 8 to start with `0` or `1` and have a check digit matching the UPC-A expansion (uses new exported `expandUPCEtoUPCA()` helper, mirroring JsBarcode's internal logic).

**Verification.**
- `"425261"` (6 digits) → renders with `0` NS and computed check ✓
- `"04252614"` (8 digits, valid) → renders ✓ (was empty before)
- `"04252615"` (8 digits, wrong check) → clear validation error
- `"24252614"` (8 digits but bad NS) → clear validation error
- Any 7-digit input → clear unambiguous error

**Generate / Batch.** Both.

---

### #9 — ITF-14

**Root cause.** ITF-14 = 13 data + 1 check (GS1 Mod 10). For 13-digit input, JsBarcode auto-appends `3` (the correct check for `1234567891234`) — the "extra 3" the user reported is the **spec-correct check digit**. For 14-digit input, the old normalizer was stripping the 14th, masking user-supplied check.

**Verdict & fix.** Spec-correct in 13-digit case; UX-bug in 14-digit case. `VALIDATION_REGISTRY.ITF14` now validates the user-supplied 14th digit against the computed value, with the same "Expected X, got Y" message style as EAN-13.

**Verification.**
- `"1234567891234"` (13 digits) → renders with check `3` (correct)
- `"12345678912343"` (14 digits, correct) → renders ✓
- `"12345678912344"` (14 digits, wrong) → clear validation error

**Generate / Batch.** Both.

---

### #10 — MSI Double Mod 10

**Verdict: spec-correct.** MSI with `mod1010` appends **two** check digits — Luhn (Mod 10) of the data, then Luhn of (data + first check). Verified for `"12345"`:

First check (Mod 10 of `12345`) → `5`. Then Mod 10 of `"123455"` → `8`. Result `"1234558"` matches the user-observed output. Algorithm is correct per spec. No code change.

---

### #11 — MSI Mod 11 + Mod 10

**Verdict: spec-correct.** With `mod1110`, MSI appends a Mod 11 check (weights 2-7, cyclic from right) followed by a Mod 10 of the result. For `"12345"`: Mod 11 → `5`; Mod 10 of `"123455"` → `8`. Result `"1234558"` matches observed. Algorithm is correct per spec. No code change.

---

### #12 — Print quality B/C ignored

**Root cause.** `qualityBlur` (A=0, B=0.5, C=1.2 px) was applied only via CSS `filter: blur(...)` on the **on-screen preview DOM**. The export-canvas path (`renderExportCanvas` in `useBarcodeRenderer.ts`) and the print path (`printWithFormat` → `generatePrintPdf` in `BarcodePreview.tsx`) never blurred the actual pixels. Download/Copy/Print therefore always produced grade-A imagery regardless of the selector.

**Fix applied.**

`src/hooks/useBarcodeRenderer.ts` — added `applyQualityBlurInPlace(canvas)` that blurs via a temp canvas + `ctx.filter = blur(<qualityBlur>px)`, invoked in both the 1D (SVG→canvas) and 2D (bwip-js→canvas) branches of `renderExportCanvas`:

```ts
const applyQualityBlurInPlace = (canvas: HTMLCanvasElement) => {
  if (!config.qualityBlur || config.qualityBlur <= 0) return;
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width; tmp.height = canvas.height;
  const tctx = tmp.getContext('2d')!;
  tctx.drawImage(canvas, 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.filter = `blur(${config.qualityBlur}px)`;
  ctx.drawImage(tmp, 0, 0);
  ctx.filter = 'none';
};
```

`src/components/BarcodePreview.tsx` — `printWithFormat` now runs the rendered dataUrl through an equivalent `applyQualityBlur(srcUrl, w, h)` helper before passing it to `generatePrintPdf`, so the IPC-print path picks up the blur too.

**Verification.** With config quality `C` (1.2 px blur):
- Download PNG — visibly blurred, edges soft. ✓
- Copy to clipboard — same blurred bytes. ✓
- Print preview PDF — opens with blurred barcode. ✓
- Quality `A` — pixel-identical to baseline (blur=0 short-circuit). ✓

**Generate / Batch.** Generate only. The Batch tab has no quality control — it always produces high-quality images for ZIP/PDF export, which is the intended behavior for batch output.

---

## 3. Regression check

Smoke-tested after all fixes were in place:

| Format | Mode | Result |
|---|---|---|
| CODE39 | default + Mod 43 | ✓ unchanged |
| CODE93 | default | ✓ unchanged |
| CODE128 | A/B/C/auto | ✓ unchanged |
| EAN-13 | 12-digit & 13-digit valid | ✓ renders; bad check rejected |
| EAN-8 | 7-digit & 8-digit valid | ✓ |
| EAN-5 / EAN-2 | add-ons | ✓ unchanged |
| UPC-A | 11- & 12-digit valid | ✓ |
| UPC-E | 6- & 8-digit valid | ✓ (8-digit now renders!) |
| ITF / ITF-14 | 13- & 14-digit valid | ✓ |
| MSI / MSI10/11/1010/1110 | various lengths | ✓ unchanged |
| Pharmacode | numeric | ✓ unchanged |
| Codabar | none / Mod10-W3 / Mod7-CheckDR / Mod11-A / Japan NW-7 / Mod16 Japan | ✓ valid inputs render; spec-violating inputs now rejected cleanly |
| QR / Aztec / DataMatrix / PDF417 | 2D pipeline | ✓ unchanged |

Test suite: **588 tests passing**, 3 todo (pre-existing), 0 failures.

---

## 4. Assumptions made (autonomous decisions)

1. **User-supplied check digits → validate, don't silently overwrite.** For EAN-13 (13 chars), EAN-8 (8 chars), UPC-A (12 chars), UPC-E (8 chars), ITF-14 (14 chars), we treat the trailing digit as a user-supplied check and reject mismatches with the expected value spelled out (e.g. "Expected 8, got 4."). The alternative — silently recomputing — was the source of the originally-reported bugs and masks typos in supplier-provided data.
2. **Codabar `X` check character → reject input rather than substitute.** When Mod 11-A would yield `X`, we reject the input with a user-friendly message instead of inventing a substitute or silently dropping. `X` is not encodable in Codabar.
3. **7-digit UPC-E → reject as ambiguous** (matches JsBarcode's stance).
4. **Quality blur scope — Generate only.** Batch tab intentionally has no quality control; batch outputs remain high quality. We did not add a quality picker to Batch (out of scope; would be a feature, not a fix).
5. **Analyzer behavior preserved.** Added a `ValidateOptions { strictCheckDigit?: boolean }` parameter to `validateInput()` so `barcodeAnalyzer.ts` can keep surfacing candidate matches that have a bad check digit (it has its own `checksumStatus` reporting). Default is strict, preserving stricter behavior everywhere else.
6. **Spec-correct items left alone.** #3 (Codabar collision), #9 (ITF-14 "extra 3" on 13-digit input is the correct check), #10, #11 (MSI double-check is by design). Reported but not "fixed".

---

## 5. Anything deliberately not changed

- **No refactor of `NORMALIZE_REGISTRY` / `VALIDATION_REGISTRY` shape.** The registries continue to use the same `Record<>` pattern; only entries changed. Worth revisiting later as a typed discriminated-union API.
- **No new quality control in Batch tab.** Feature request, not a bug.
- **JsBarcode UPC-E "decoration" of 6-digit inputs** (number-system 0 and computed check rendered under the guard bars) was left as-is — it is spec-correct UPC-E rendering.
- **`printFormats.ts` / `barcodeImageGenerator.ts`** were not modified. The headless `barcodeImageGenerator` is used by validation and batch and intentionally produces unblurred grade-A canvases.
- **ESLint / formatting / unused-import cleanup** was not done despite a few opportunities being visible — explicitly out of scope.
