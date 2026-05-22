import { describe, it, expect, beforeEach } from 'vitest';
import { loadProfiles, saveProfiles, upsertProfile, deleteProfile, UserPrintProfile } from './printStorage';

const makeProfile = (id = 'test-1', label = 'Test Label'): UserPrintProfile => ({
  id,
  label,
  description: 'A test profile',
  widthMm: 70,
  heightMm: 35,
  marginMm: 2,
  mode: 'a4-label-sheet',
  sheetCols: 3,
  sheetRows: 8,
});

describe('printStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('loadProfiles', () => {
    it('returns empty array when nothing stored', () => {
      expect(loadProfiles()).toEqual([]);
    });

    it('returns empty array on corrupted JSON', () => {
      localStorage.setItem('barcode-print-profiles', 'not valid json{{{');
      expect(loadProfiles()).toEqual([]);
    });

    it('returns empty array if stored value is not an array', () => {
      localStorage.setItem('barcode-print-profiles', JSON.stringify({ id: 'x' }));
      expect(loadProfiles()).toEqual([]);
    });

    it('filters out entries missing required fields', () => {
      const data = [
        makeProfile('good', 'Good'),
        { id: 'bad', label: 'Missing widthMm', heightMm: 10, mode: 'page-per-label' },
        { id: 'bad2' }, // missing almost everything
      ];
      localStorage.setItem('barcode-print-profiles', JSON.stringify(data));
      const result = loadProfiles();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('good');
    });

    it('loads valid profiles correctly', () => {
      const profiles = [makeProfile('a', 'Alpha'), makeProfile('b', 'Beta')];
      localStorage.setItem('barcode-print-profiles', JSON.stringify(profiles));
      expect(loadProfiles()).toEqual(profiles);
    });
  });

  describe('saveProfiles', () => {
    it('persists profiles to localStorage', () => {
      const profiles = [makeProfile()];
      saveProfiles(profiles);
      expect(JSON.parse(localStorage.getItem('barcode-print-profiles')!)).toEqual(profiles);
    });
  });

  describe('upsertProfile', () => {
    it('adds a new profile', () => {
      const p = makeProfile('new-1', 'New');
      const result = upsertProfile(p);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(p);
    });

    it('updates an existing profile by id', () => {
      saveProfiles([makeProfile('x', 'Original')]);
      const updated = makeProfile('x', 'Updated');
      updated.widthMm = 99;
      const result = upsertProfile(updated);
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Updated');
      expect(result[0].widthMm).toBe(99);
    });
  });

  describe('deleteProfile', () => {
    it('removes a profile by id', () => {
      saveProfiles([makeProfile('a', 'A'), makeProfile('b', 'B')]);
      const result = deleteProfile('a');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('b');
    });

    it('returns empty array if deleting the only profile', () => {
      saveProfiles([makeProfile('only')]);
      expect(deleteProfile('only')).toEqual([]);
    });

    it('does nothing if id not found', () => {
      saveProfiles([makeProfile('x')]);
      const result = deleteProfile('nonexistent');
      expect(result).toHaveLength(1);
    });
  });
});
