import { useState, useEffect, useCallback } from 'react';
import { Settings2, Plus, Trash2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { PrintFormat, PrintLayoutMode, buildPrintFormat } from '@/lib/printFormats';
import { UserPrintProfile, loadProfiles, upsertProfile, deleteProfile } from '@/lib/printStorage';

interface PrintConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrint: (format: PrintFormat) => void;
}

function generateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_PROFILE: Omit<UserPrintProfile, 'id'> = {
  label: 'New Custom Label',
  description: 'Custom label sheet',
  widthMm: 70,
  heightMm: 35,
  marginMm: 0,
  mode: 'a4-label-sheet',
  sheetCols: 3,
  sheetRows: 8,
  offsetTopMm: 0,
  offsetBottomMm: 0,
  offsetLeftMm: 0,
  offsetRightMm: 0,
  showGrid: false,
};

export function PrintConfigDialog({ open, onOpenChange, onPrint }: PrintConfigDialogProps) {
  const [profiles, setProfiles] = useState<UserPrintProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<UserPrintProfile, 'id'>>({ ...DEFAULT_PROFILE });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Per-field raw-string overrides so users can clear/retype numeric inputs
  // freely (a controlled <input type="number"> bound directly to numeric form
  // state snaps back when the user clears it, blocking re-entry).
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Load profiles from localStorage when dialog opens, and reset the form
  // to factory defaults so the user always sees the standard starting values
  // (Profile name "New Custom Label", 70×35 mm, 3×8 grid, etc.) on reopen.
  // The saved profile list still loads — the user can click a profile to
  // populate the form with that profile's values.
  useEffect(() => {
    if (open) {
      const loaded = loadProfiles();
      setProfiles(loaded);
      setSelectedId(null);
      setForm({ ...DEFAULT_PROFILE });
      setDrafts({});
    }
  }, [open]);

  // Sync form when selection changes
  useEffect(() => {
    if (selectedId) {
      const profile = profiles.find((p) => p.id === selectedId);
      if (profile) {
        setForm(profileToForm(profile));
        setDrafts({}); // clear any in-flight input strings from the previous profile
      }
    }
  }, [selectedId]);

  const profileToForm = (p: UserPrintProfile): Omit<UserPrintProfile, 'id'> => ({
    label: p.label,
    description: p.description,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    marginMm: p.marginMm,
    mode: p.mode,
    sheetCols: p.sheetCols,
    sheetRows: p.sheetRows,
    offsetTopMm: p.offsetTopMm ?? p.sheetTopMarginMm ?? 0,
    offsetBottomMm: p.offsetBottomMm ?? p.sheetBarcodeOffsetMm ?? 0,
    offsetLeftMm: p.offsetLeftMm ?? 0,
    offsetRightMm: p.offsetRightMm ?? p.sheetHorizontalOffsetMm ?? 0,
    showGrid: p.showGrid ?? false,
  });

  const handleAddNew = useCallback(() => {
    const newId = generateId();
    const newProfile: UserPrintProfile = { id: newId, ...DEFAULT_PROFILE };
    const updated = upsertProfile(newProfile);
    setProfiles(updated);
    setSelectedId(newId);
    setForm({ ...DEFAULT_PROFILE });
  }, []);

  const handleSave = useCallback(() => {
    if (!selectedId) return;
    const profile: UserPrintProfile = { id: selectedId, ...form };
    const updated = upsertProfile(profile);
    setProfiles(updated);
    toast.success('Profile saved');
  }, [selectedId, form]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    const updated = deleteProfile(selectedId);
    setProfiles(updated);
    if (updated.length > 0) {
      setSelectedId(updated[0].id);
      setForm(profileToForm(updated[0]));
    } else {
      setSelectedId(null);
      setForm({ ...DEFAULT_PROFILE });
    }
    toast.success('Profile deleted');
  }, [selectedId]);

  const handlePrint = useCallback(() => {
    const format = buildPrintFormat({
      id: selectedId ?? generateId(),
      label: form.label,
      description: form.description,
      widthMm: form.widthMm,
      heightMm: form.heightMm,
      marginMm: form.marginMm,
      mode: form.mode,
      sheetCols: form.sheetCols,
      sheetRows: form.sheetRows,
      offsetTopMm: form.offsetTopMm,
      offsetBottomMm: form.offsetBottomMm,
      offsetLeftMm: form.offsetLeftMm,
      offsetRightMm: form.offsetRightMm,
      showGrid: form.showGrid,
    });
    onPrint(format);
    onOpenChange(false);
  }, [selectedId, form, onPrint, onOpenChange]);

  const updateField = <K extends keyof Omit<UserPrintProfile, 'id'>>(
    key: K,
    value: Omit<UserPrintProfile, 'id'>[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const numField = (key: keyof Omit<UserPrintProfile, 'id'>, value: string) => {
    // Always remember the raw string so the input can show partial/empty
    // values (e.g. "", "-", "1.") without snapping back to the last numeric.
    setDrafts((prev) => ({ ...prev, [key as string]: value }));
    const num = parseFloat(value);
    if (!isNaN(num)) updateField(key, num as never);
  };

  // Resolve a numeric form field to the string a controlled input should show:
  // prefer the in-flight draft if present, otherwise the current numeric value.
  const numValue = (key: keyof Omit<UserPrintProfile, 'id'>): string => {
    const k = key as string;
    if (drafts[k] !== undefined) return drafts[k];
    const v = (form as Record<string, unknown>)[k];
    return v === undefined || v === null ? '' : String(v);
  };

  // Commit on blur: if the input is left empty or unparseable, fall back to 0
  // and clear the draft so the field shows a real numeric value again.
  const numBlur = (key: keyof Omit<UserPrintProfile, 'id'>) => {
    const k = key as string;
    if (drafts[k] === undefined) return;
    const num = parseFloat(drafts[k]);
    if (isNaN(num)) updateField(key, 0 as never);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const showSheetFields = form.mode === 'a4-label-sheet';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Custom Print Configuration
          </DialogTitle>
          <DialogDescription>
            Create and manage custom label profiles for printing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[200px_1fr] gap-4 mt-4">
          {/* Left: Profile list */}
          <div className="flex flex-col gap-2">
            <ScrollArea className="h-[340px] border rounded-md p-2">
              {profiles.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">
                  No custom profiles yet. Click "Add New" to create one.
                </p>
              ) : (
                profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm mb-1 transition-colors ${
                      selectedId === p.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div className="font-medium truncate">{p.label}</div>
                    <div className="text-xs opacity-70 truncate">
                      {p.widthMm}×{p.heightMm} mm
                    </div>
                  </button>
                ))
              )}
            </ScrollArea>
            <Button size="sm" variant="outline" onClick={handleAddNew} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              Add New
            </Button>
          </div>

          {/* Right: Edit fields */}
          <div className="space-y-4">
            {/* Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Profile Name</Label>
                <Input
                  value={form.label}
                  onChange={(e) => updateField('label', e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Layout Mode</Label>
                <Select
                  value={form.mode}
                  onValueChange={(v) => updateField('mode', v as PrintLayoutMode)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a4-label-sheet">Label Sheet (A4 grid)</SelectItem>
                    <SelectItem value="page-per-label">Page Per Label</SelectItem>
                    <SelectItem value="a4-grid">A4 Grid (stacked)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dimensions */}
            <Separator />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Width (mm)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="10"
                  value={numValue('widthMm')}
                  onChange={(e) => numField('widthMm', e.target.value)}
                  onBlur={() => numBlur('widthMm')}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Height (mm)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="5"
                  value={numValue('heightMm')}
                  onChange={(e) => numField('heightMm', e.target.value)}
                  onBlur={() => numBlur('heightMm')}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Cell Margin (mm)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  value={numValue('marginMm')}
                  onChange={(e) => numField('marginMm', e.target.value)}
                  onBlur={() => numBlur('marginMm')}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* Sheet grid (only for a4-label-sheet) */}
            {showSheetFields && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Columns</Label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={numValue('sheetCols')}
                    onChange={(e) => numField('sheetCols', e.target.value)}
                    onBlur={() => numBlur('sheetCols')}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Rows</Label>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    value={numValue('sheetRows')}
                    onChange={(e) => numField('sheetRows', e.target.value)}
                    onBlur={() => numBlur('sheetRows')}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            )}

            {/* Advanced offsets */}
            {showSheetFields && (
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <div className="flex items-center justify-between gap-3">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1 px-0">
                      <Settings2 className="h-3.5 w-3.5" />
                      {advancedOpen ? 'Hide' : 'Show'} Printer Offsets
                    </Button>
                  </CollapsibleTrigger>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={!!form.showGrid}
                      onCheckedChange={(checked) => updateField('showGrid', checked === true)}
                    />
                    Show Label Grid
                  </label>
                </div>
                <CollapsibleContent className="space-y-3 mt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Top Offset (mm)</Label>
                      <Input
                        type="number"
                        step="0.5"
                        value={numValue('offsetTopMm')}
                        onChange={(e) => numField('offsetTopMm', e.target.value)}
                        onBlur={() => numBlur('offsetTopMm')}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Bottom Offset (mm)</Label>
                      <Input
                        type="number"
                        step="0.5"
                        value={numValue('offsetBottomMm')}
                        onChange={(e) => numField('offsetBottomMm', e.target.value)}
                        onBlur={() => numBlur('offsetBottomMm')}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Left Offset (mm)</Label>
                      <Input
                        type="number"
                        step="0.5"
                        value={numValue('offsetLeftMm')}
                        onChange={(e) => numField('offsetLeftMm', e.target.value)}
                        onBlur={() => numBlur('offsetLeftMm')}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Right Offset (mm)</Label>
                      <Input
                        type="number"
                        step="0.5"
                        value={numValue('offsetRightMm')}
                        onChange={(e) => numField('offsetRightMm', e.target.value)}
                        onBlur={() => numBlur('offsetRightMm')}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Use negative top offset to shift the grid upward (compensates for printer hardware margin).
                    Left/Right offsets shift content horizontally.
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Actions */}
            <Separator />
            <div className="flex justify-between items-center">
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                disabled={!selectedId}
                className="gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleSave} disabled={!selectedId}>
                  Save
                </Button>
                <Button size="sm" onClick={handlePrint} className="gap-1">
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
