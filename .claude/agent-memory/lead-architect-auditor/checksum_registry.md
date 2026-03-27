---
name: checksum_registry
description: Verified checksum algorithm implementations, test vectors, and routing decisions
type: project
---

# Checksum Algorithm Registry — Verified State

All algorithms verified by manual trace in the 2025 full audit. All 370 tests pass.

## Core Algorithms (barcodeUtils.ts)

| Function | Algorithm | Key Test Vector | Result | Notes |
|----------|-----------|----------------|--------|-------|
| `calculateMod10` | Luhn — doubles rightmost digit | `'7992739871'` → `3` | ✓ | Used for MSI Mod10. NOT same as `calculateLuhnChecksum` |
| `calculateLuhnChecksum` | Luhn — doubles second-from-right | `'7992739871'` → `'4'` | ✓ | Returns string. Different from calculateMod10 despite both being "Luhn" |
| `calculateGS1Mod10` | GS1 weights 3,1 from right | `'123456'` → `5`, `'0001234560001'` → `2` | ✓ | Used for ITF, ITF14 |
| `calculateEAN13Checksum` | Weight 1,3 from left (i%2===0 → 1) | `'590123412345'` → `7` | ✓ | Returns number |
| `calculateUPCChecksum` | Odd positions ×3, even ×1 | `'03600029145'` → `2` | ✓ | Returns number |
| `calculateMod43Checksum` | Sum mod 43 | `'HELLO'` → `'B'` | ✓ | 43-char CODE39 alphabet |
| `calculateMod16Checksum` | Sum mod 16 (Codabar) | `'123'` → `'-'` | ✓ | 16-char Codabar alphabet |
| `calculateJapanNW7Checksum` | Sum mod 16, 20-char charset | result ∈ charset | ✓ | ABCD never returned as check char (indices 16-19 unreachable) |
| `calculateJRCChecksum` | Weights 1,2 from left | `'1234'` → `'4'` | ✓ | |
| `calculateMod11PZNChecksum` | Positional weights 1..n, mod 11 | `'123456'` → `'3'`, `'39'` → `'!'` | ✓ | `!` means invalid PZN |
| `calculateMod11AChecksum` | Reversed, weights 2,3,4..., mod 11 | returns digit or `'X'` | ✓ | |
| `calculateMod10Weight2Checksum` | Alt weights 1,2 from left | `'12345'` → `'9'` | ✓ | |
| `calculateMod10Weight3Checksum` | Alt weights 1,3 from left | `'12345'` → `'3'` | ✓ | |
| `calculate7CheckDRChecksum` | Digital root mod 7 | `'123'` → `'1'` | ✓ | |
| `calculateMod16JapanChecksum` | Sum mod 16, 24-char charset | result ∈ first 16 chars | ✓ | Chars at indices 16-23 unreachable |
| `calculateMod11` | Weights 2-7 cycling | returns 0..10 | ✓ | 10 → represented as 'X' in callers |

## Critical Equivalence Note

`computeITF14Check` (private in validationEngine.ts, weights `i%2===0 ? 3:1`) and `calculateGS1Mod10` (public, weights `posFromRight%2===0 ? 3:1`) are **equivalent for odd-length inputs** (like the 13-digit ITF-14 body) but produce different results for even-length inputs. This is safe because `computeITF14Check` is only applied to the 13-digit (odd) ITF-14 body.

## Orphaned ChecksumTypes

`ean13` and `upc` exist in `ChecksumType` union and `CHECKSUM_APPLIER_REGISTRY` but are absent from `OPTIONAL_REGISTRY` in validationEngine.ts. If used as `checksumType`, `applyChecksum` works but `BarcodeValidator.validate()` returns `status: 'skipped'`. This is a silent validation bypass. Flagged as DEBT in 2025 full audit.
