import { BarcodeConfig, BarcodeFormat, BARCODE_FORMATS, ChecksumType, getApplicableChecksums, getDefaultConfig, QualityLevel } from '@/lib/barcodeUtils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Barcode, Palette, Ruler, Hash, Maximize2, RotateCcw } from 'lucide-react';
import { QualitySegmentedControl } from '@/components/QualitySegmentedControl';
import { InfoTooltip } from '@/components/InfoTooltip';

interface BarcodeControlsProps {
  config: BarcodeConfig;
  onChange: (config: BarcodeConfig) => void;
  isValid: boolean;
  errorMessage: string;
}

export function BarcodeControls({ config, onChange, isValid, errorMessage }: BarcodeControlsProps) {
  const selectedFormat = BARCODE_FORMATS.find(f => f.value === config.format);
  const applicableChecksums = getApplicableChecksums(config.format);

  const formats1D = BARCODE_FORMATS.filter(f => f.category === '1D');
  const formats2D = BARCODE_FORMATS.filter(f => f.category === '2D');

  const defaults = getDefaultConfig();

  const resetDimensions = () => {
    onChange({
      ...config,
      widthMils: defaults.widthMils,
      dpi: defaults.dpi,
      height: defaults.height,
      margin: defaults.margin,
      fontSize: defaults.fontSize,
      scale: defaults.scale,
    });
  };

  return (
    <div className="space-y-8">
      {/* Format Selection */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Barcode className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold">Barcode Format</span>
          </div>
{selectedFormat && (
            <InfoTooltip
              content={
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${selectedFormat.category === '2D' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {selectedFormat.category}
                    </span>
                    <span className="font-medium">{selectedFormat.label}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{selectedFormat.description}</p>
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-semibold text-foreground shrink-0">Accepted Symbols:</span>
                      <span className="text-xs font-mono text-muted-foreground">{selectedFormat.validChars}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-semibold text-foreground shrink-0">Length:</span>
                      <span className="text-xs font-mono text-primary">{selectedFormat.lengthHint}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-semibold text-foreground shrink-0">Validation:</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {selectedFormat.category === '2D' 
                          ? 'Any valid text input accepted' 
                          : selectedFormat.validChars.includes('0-9 only') 
                            ? 'Numeric input only, auto-validated'
                            : 'Alphanumeric, special chars validated'}
                      </span>
                    </div>
                  </div>
                </div>
              }
            />
          )}
        </div>
        <Select
          value={config.format}
          onValueChange={(value) => onChange({ ...config, format: value as BarcodeFormat, checksumType: 'none' })}
        >
          <SelectTrigger className="w-full h-12 rounded-xl bg-secondary/50 border-border/50 hover:bg-secondary/80 transition-colors">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[400px] bg-popover border-border/50 rounded-xl shadow-2xl">
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">1D Barcodes</div>
            {formats1D.map((format) => (
              <SelectItem key={format.value} value={format.value} className="rounded-lg mx-1">
                <span className="font-medium">{format.label}</span>
              </SelectItem>
            ))}
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 mt-2 pt-3">2D Barcodes</div>
            {formats2D.map((format) => (
              <SelectItem key={format.value} value={format.value} className="rounded-lg mx-1">
                <span className="font-medium">{format.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Value Input */}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Hash className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold">Value</span>
        </div>
        <div className="relative">
          <Input
            value={config.text}
            onChange={(e) => onChange({ ...config, text: e.target.value })}
            placeholder="Enter barcode value..."
            className={`font-mono h-14 rounded-xl bg-secondary/50 border-border/50 pr-20 text-lg glow-input transition-all duration-200 ${!isValid && config.text ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-mono text-muted-foreground bg-secondary/80 px-2 py-1 rounded-md">
            {config.text.length} <span className="text-xs">chars</span>
          </div>
        </div>
        {!isValid && config.text && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{errorMessage}</p>
        )}
      </div>

      {/* Quality Selection - Segmented Control */}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          </div>
          <span className="font-semibold">Quality</span>
        </div>
        <QualitySegmentedControl
          value={config.quality}
          onChange={(value) => onChange({ ...config, quality: value })}
        />
      </div>

      {/* Checksum */}
      {applicableChecksums.length > 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" />
              </svg>
            </div>
            <span className="font-semibold">Checksum</span>
          </div>
          <Select
            value={config.checksumType}
            onValueChange={(value) => onChange({ ...config, checksumType: value as ChecksumType })}
          >
            <SelectTrigger className="w-full h-12 rounded-xl bg-secondary/50 border-border/50 hover:bg-secondary/80 transition-colors">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border/50 rounded-xl shadow-2xl">
              {applicableChecksums.map((checksum) => (
                <SelectItem key={checksum.value} value={checksum.value} className="rounded-lg mx-1">
                  {checksum.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {config.checksumType !== 'none' 
              ? 'Checksum will be auto-appended to the barcode value'
              : 'No checksum will be added'}
          </p>
        </div>
      )}

      {/* Dimensions */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Ruler className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold">Dimensions</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetDimensions}
            className="gap-1.5 h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
        
        <div className="space-y-5 pl-1">
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <Label className="text-muted-foreground">Bar Width (X-dim)</Label>
              <span className="font-mono text-primary font-medium">{config.widthMils} mil</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-1">
              {[5, 7.5].map((mil) => (
                <button
                  key={mil}
                  type="button"
                  onClick={() => onChange({ ...config, widthMils: mil })}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    config.widthMils === mil
                      ? 'bg-primary text-primary-foreground shadow-lg'
                      : 'bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  {mil} mil
                </button>
              ))}
            </div>
            <Slider
              value={[config.widthMils]}
              onValueChange={([value]) => onChange({ ...config, widthMils: value })}
              min={4}
              max={40}
              step={0.5}
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <Label className="text-muted-foreground">Print DPI</Label>
              <span className="font-mono text-primary font-medium">
                → {Math.max(1, Math.round(config.widthMils * config.dpi / 1000))} px/bar
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([96, 300, 600] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChange({ ...config, dpi: d })}
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    config.dpi === d
                      ? 'bg-primary text-primary-foreground shadow-lg'
                      : 'bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">96 = screen • 300 = laser • 600 = hi-res</p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <Label className="text-muted-foreground">Height</Label>
              <span className="font-mono text-primary font-medium">{config.height}px</span>
            </div>
            <Slider
              value={[config.height]}
              onValueChange={([value]) => onChange({ ...config, height: value })}
              min={30}
              max={200}
              step={5}
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <Label className="text-muted-foreground">Margin</Label>
              <span className="font-mono text-primary font-medium">{config.margin}px</span>
            </div>
            <Slider
              value={[config.margin]}
              onValueChange={([value]) => onChange({ ...config, margin: value })}
              min={0}
              max={30}
              step={2}
              className="w-full"
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <Label className="text-muted-foreground">Font Size</Label>
              <span className="font-mono text-primary font-medium">{config.fontSize}px</span>
            </div>
            <Slider
              value={[config.fontSize]}
              onValueChange={([value]) => onChange({ ...config, fontSize: value })}
              min={10}
              max={28}
              step={1}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Output Scale - moved below Dimensions */}
      <div className="space-y-5">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Maximize2 className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold">Output Size</span>
        </div>
        
        <div className="grid grid-cols-3 gap-2 mb-4">
          <button
            type="button"
            onClick={() => onChange({ ...config, scale: 0.5 })}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              config.scale === 0.5
                ? 'bg-primary text-primary-foreground shadow-lg'
                : 'bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            Small
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...config, scale: 1 })}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              config.scale === 1
                ? 'bg-primary text-primary-foreground shadow-lg'
                : 'bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            Medium
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...config, scale: 2 })}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              config.scale === 2
                ? 'bg-primary text-primary-foreground shadow-lg'
                : 'bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            Large
          </button>
        </div>
        
        <div className="space-y-3 pl-1">
          <div className="flex justify-between text-sm">
            <Label className="text-muted-foreground">Custom Scale</Label>
            <span className="font-mono text-primary font-medium">{config.scale.toFixed(1)}x</span>
          </div>
          <Slider
            value={[config.scale]}
            onValueChange={([value]) => onChange({ ...config, scale: value })}
            min={0.25}
            max={4}
            step={0.25}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            0.25x = tiny labels • 1x = standard • 4x = large prints
          </p>
        </div>
      </div>

      {/* Colors */}
      <div className="space-y-5">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Palette className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold">Colors</span>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground">Line Color</Label>
            <div className="flex gap-2">
              <input
                type="color"
                value={config.lineColor}
                onChange={(e) => onChange({ ...config, lineColor: e.target.value })}
                className="w-12 h-12 rounded-xl border-2 border-border/50 cursor-pointer bg-transparent"
              />
              <Input
                value={config.lineColor}
                onChange={(e) => onChange({ ...config, lineColor: e.target.value })}
                className="font-mono text-xs h-12 rounded-xl bg-secondary/50 border-border/50"
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-sm text-muted-foreground">Background</Label>
            <div className="flex gap-2">
              <input
                type="color"
                value={config.background}
                onChange={(e) => onChange({ ...config, background: e.target.value })}
                className="w-12 h-12 rounded-xl border-2 border-border/50 cursor-pointer bg-transparent"
              />
              <Input
                value={config.background}
                onChange={(e) => onChange({ ...config, background: e.target.value })}
                className="font-mono text-xs h-12 rounded-xl bg-secondary/50 border-border/50"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Display Options */}
      <div className="flex items-center justify-between p-4 bg-secondary/50 rounded-xl border border-border/30">
        <Label htmlFor="display-value" className="text-sm font-medium cursor-pointer">
          Show Value Text
        </Label>
        <Switch
          id="display-value"
          checked={config.displayValue}
          onCheckedChange={(checked) => onChange({ ...config, displayValue: checked })}
        />
      </div>
    </div>
  );
}
