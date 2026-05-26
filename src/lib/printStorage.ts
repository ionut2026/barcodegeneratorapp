// localStorage persistence for user-defined print profiles.
// Custom profiles are stored alongside (not replacing) the built-in
// PRINT_FORMAT_REGISTRY presets.

import type { PrintLayoutMode } from '@/lib/printFormats';

const STORAGE_KEY = 'barcode-print-profiles';

export interface UserPrintProfile {
  id: string;
  label: string;
  description: string;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  mode: PrintLayoutMode;
  sheetCols?: number;
  sheetRows?: number;
  /** Page-level top offset in mm (shifts entire grid down if positive, up if negative). */
  offsetTopMm?: number;
  /** Page-level bottom offset in mm (reserved for future row-spacing adjustment). */
  offsetBottomMm?: number;
  /** Per-barcode leftward shift in mm (positive = shift left). */
  offsetLeftMm?: number;
  /** Per-barcode rightward shift in mm (positive = shift right). */
  offsetRightMm?: number;
  /** When true, draw a thin border around each label cell on the printed sheet (a4-label-sheet only). */
  showGrid?: boolean;
  // Legacy fields (kept for backward-compat with previously saved profiles)
  sheetTopMarginMm?: number;
  sheetBarcodeOffsetMm?: number;
  sheetHorizontalOffsetMm?: number;
}

/** Load all saved custom profiles. Returns [] on corruption or empty state. */
export function loadProfiles(): UserPrintProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Basic shape validation — reject entries missing required fields
    return parsed.filter(
      (p: unknown): p is UserPrintProfile =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as UserPrintProfile).id === 'string' &&
        typeof (p as UserPrintProfile).label === 'string' &&
        typeof (p as UserPrintProfile).widthMm === 'number' &&
        typeof (p as UserPrintProfile).heightMm === 'number' &&
        typeof (p as UserPrintProfile).mode === 'string',
    );
  } catch {
    return [];
  }
}

/** Save the full set of custom profiles (replaces previous state). */
export function saveProfiles(profiles: UserPrintProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

/** Add or update a single profile. */
export function upsertProfile(profile: UserPrintProfile): UserPrintProfile[] {
  const existing = loadProfiles();
  const idx = existing.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    existing[idx] = profile;
  } else {
    existing.push(profile);
  }
  saveProfiles(existing);
  return existing;
}

/** Delete a profile by ID. Returns the updated list. */
export function deleteProfile(id: string): UserPrintProfile[] {
  const existing = loadProfiles().filter((p) => p.id !== id);
  saveProfiles(existing);
  return existing;
}
