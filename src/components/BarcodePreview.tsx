import { useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import bwipjs from 'bwip-js';
import { BarcodeConfig, normalizeForRendering, snapToPixelGrid } from '@/lib/barcodeUtils';
import { injectPngDpi } from '@/lib/barcodeImageGenerator';
import { ImageEffectsConfig, getDefaultEffectsConfig } from '@/components/ImageEffects';
import { AlertCircle, ShieldCheck, FileJson, Loader2 } from 'lucide-react';
import { useCertification } from '@/hooks/useCertification';
import { useBarcodeRenderer, snapSvgToPixels } from '@/hooks/useBarcodeRenderer';
import { BarcodeExportActions } from '@/components/BarcodeExportActions';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { PrintFormatId, PRINT_FORMAT_REGISTRY, checkBarcodeFit, generatePrintPdf } from '@/lib/printFormats';

interface BarcodePreviewProps {
  config: BarcodeConfig;
  effects?: ImageEffectsConfig;
  isValid: boolean;
  errorMessage: string;
}

const defaultEffects = getDefaultEffectsConfig();

export function BarcodePreview({ config, effects = defaultEffects, isValid, errorMessage }: BarcodePreviewProps) {
  const {
    svgRef,
    barcodeCanvasRef,
    canvasRef,
    barcodeDataUrl,
    renderError,
    is2D,
    barcodeText,
    modulePixels,
    qualityBlur,
    renderExportCanvas,
  } = useBarcodeRenderer(config, effects, isValid, errorMessage);

  const { certificate, isCertifying, certEnabled, setCertEnabled, downloadCertificate } = useCertification(config, isValid);

  // Calculate pixel snapping for bar width
  const snap = useMemo(() => snapToPixelGrid(config.widthMils, config.dpi), [config.widthMils, config.dpi]);

  const downloadBarcode = async () => {
    // Always export as PNG. For 1D barcodes the source render goes through
    // a pixel-snapped SVG inside renderExportCanvas() so the PNG remains
    // crisp at the configured DPI; for 2D and effects-enabled flows the
    // canvas is already a raster.
    const exportCanvas = await renderExportCanvas();
    if (!exportCanvas) { toast.error('Failed to render barcode for download'); return; }

    // When effects are enabled, effects.scale changes pixel count — compensate DPI
    // so physical size stays correct: more pixels at higher DPI = same mm.
    const effectiveDpi = effects.enableEffects
      ? Math.round(config.dpi * effects.scale)
      : config.dpi;
    const rawUrl = exportCanvas.toDataURL('image/png');
    const dpiUrl = injectPngDpi(rawUrl, effectiveDpi);

    const actualMils = ((modulePixels * 1000) / config.dpi).toFixed(1);
    const wMm = (exportCanvas.width * 25.4 / effectiveDpi).toFixed(1);
    const hMm = (exportCanvas.height * 25.4 / effectiveDpi).toFixed(1);

    const link = document.createElement('a');
    link.download = `barcode-${config.format}-${barcodeText}.png`;
    link.href = dpiUrl;
    link.click();

    toast.success(`Downloaded: ${wMm} × ${hMm} mm @ ${config.dpi} DPI · ${actualMils} mil module (${modulePixels} px)`);
    exportCanvas.width = 0;
    exportCanvas.height = 0;
  };

  const copyToClipboard = async () => {
    try {
      const exportCanvas = await renderExportCanvas();
      if (!exportCanvas) { toast.error('Failed to render barcode for copy'); return; }

      // When effects scale pixels, adjust DPI to preserve physical size
      const effectiveDpi = effects.enableEffects
        ? Math.round(config.dpi * effects.scale)
        : config.dpi;
      const dpiUrl = injectPngDpi(exportCanvas.toDataURL('image/png'), effectiveDpi);
      const base64 = dpiUrl.substring(dpiUrl.indexOf(',') + 1);
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const dpiBlob = new Blob([bytes], { type: 'image/png' });

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': dpiBlob })
      ]);
      toast.success('Barcode copied to clipboard');

      exportCanvas.width = 0;
      exportCanvas.height = 0;
    } catch (error) {
      console.error('Copy failed:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  // Print barcode — generates a PDF via jsPDF with exact physical dimensions.
  // The barcode is rendered at base DPI (no scale, no effects, margin:0) and
  // placed in the PDF at its exact mm size — never scaled or rotated.
  // pixels = round(widthMils × dpi / 1000) per module → mm = pixels × 25.4 / dpi
  const printBarcode = async (formatId: PrintFormatId) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const printFormat = PRINT_FORMAT_REGISTRY[formatId];

    // Helper: rasterize SVG to a PNG data URL via canvas
    const svgToDataUrl = (svgEl: SVGSVGElement): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> => {
      return new Promise((resolve, reject) => {
        const svgData = new XMLSerializer().serializeToString(svgEl);
        const img = new Image();
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve({ dataUrl: canvas.toDataURL('image/png'), widthPx: canvas.width, heightPx: canvas.height });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG rasterization failed')); };
        img.src = url;
      });
    };

    try {
      let dataUrl: string;
      let widthPx: number;
      let heightPx: number;

      if (is2D) {
        // 2D barcode: render via bwip-js to canvas
        const tempCanvas = document.createElement('canvas');
        const bwipOptions: Record<string, unknown> = {
          bcid: config.format,
          text: barcodeText,
          scale: modulePixels,
          includetext: config.displayValue,
          textsize: config.fontSize,
          textxalign: 'center',
          backgroundcolor: config.background.replace('#', ''),
          barcolor: config.lineColor.replace('#', ''),
          padding: 0,
        };
        if (config.format === 'pdf417') {
          bwipOptions.height = Math.floor(config.height / 10);
          bwipOptions.width = Math.floor(config.height / 3);
        }
        bwipjs.toCanvas(tempCanvas, bwipOptions as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
        dataUrl = tempCanvas.toDataURL('image/png');
        widthPx = tempCanvas.width;
        heightPx = tempCanvas.height;
        tempCanvas.width = 0;
        tempCanvas.height = 0;
      } else {
        // 1D barcode: render via JsBarcode to SVG, then rasterize to PNG
        const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const renderText = normalizeForRendering(barcodeText, config.format);
        JsBarcode(tempSvg, renderText, {
          format: config.format,
          width: modulePixels,
          height: config.height,
          displayValue: config.displayValue,
          fontSize: config.fontSize,
          lineColor: config.lineColor,
          background: config.background,
          margin: 0,
          font: 'Courier',
          textMargin: 2,
        });
        snapSvgToPixels(tempSvg);
        const result = await svgToDataUrl(tempSvg);
        dataUrl = result.dataUrl;
        widthPx = result.widthPx;
        heightPx = result.heightPx;
      }

      // Overflow check — never scale, block if too large. Scaling shrinks
      // bar widths below the configured X-dimension and breaks scannability,
      // so we refuse the print and tell the user the largest X-dimension
      // (mils) and bar height that would actually fit.
      const fit = checkBarcodeFit(widthPx, heightPx, config.dpi, printFormat);
      if (!fit.fits) {
        const widthRatio = fit.printableWidthMm / fit.barcodeWidthMm;
        const heightRatio = fit.printableHeightMm / fit.barcodeHeightMm;
        const limitingRatio = Math.min(widthRatio, heightRatio);
        // Largest mils and height that would fit — round down so the user's
        // first retry actually fits rather than landing exactly on the edge.
        const suggestedMils = Math.max(1, Math.floor(config.widthMils * widthRatio * 10) / 10);
        const suggestedHeight = Math.max(10, Math.floor(config.height * heightRatio));
        const action: string[] = [];
        if (widthRatio < 1) action.push(`X-dim \u2264 ${suggestedMils} mils`);
        if (heightRatio < 1) action.push(`bar height \u2264 ${suggestedHeight} px`);
        toast.warning(
          `Barcode (${fit.barcodeWidthMm.toFixed(1)} \u00d7 ${fit.barcodeHeightMm.toFixed(1)} mm) is too big for ${printFormat.label} (${fit.printableWidthMm.toFixed(1)} \u00d7 ${fit.printableHeightMm.toFixed(1)} mm printable). Set ${action.join(' and ')} to fit.`,
          { duration: 8000 }
        );
        void limitingRatio;
        return;
      }

      // Generate PDF and open in new tab for printing
      await generatePrintPdf(
        [{ dataUrl, widthPx, heightPx, dpi: config.dpi, label: barcodeText }],
        printFormat,
      );
    } catch (error) {
      console.error('Print barcode error:', error);
      toast.error('Failed to generate print PDF');
    }
  };

  const getPreviewStyles = () => {
    const baseBlur = qualityBlur;
    const effectsBlur = effects.enableEffects ? effects.blur : 0;
    const totalBlur = baseBlur + effectsBlur;
    
    if (!effects.enableEffects) {
      return {
        filter: totalBlur > 0 ? `blur(${totalBlur}px)` : undefined,
      };
    }
    
    return {
      transform: `
        scale(${effects.scale}) 
        scaleX(${effects.lineSpacing})
        rotate(${effects.rotation}deg)
        perspective(1000px) 
        rotateY(${effects.perspective * 0.5}deg)
      `,
      filter: `
        contrast(${effects.contrast})
        brightness(${1 + effects.brightness / 100})
        blur(${totalBlur}px)
      `,
    };
  };

  const checksumInfo = config.checksumType !== 'none' && config.text !== barcodeText 
    ? `Value with checksum: ${barcodeText}`
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header with buttons */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-medium text-muted-foreground">Preview</h2>
        <BarcodeExportActions
          disabled={!isValid || !!renderError}
          onDownload={downloadBarcode}
          onCopy={copyToClipboard}
          onPrint={printBarcode}
        />
      </div>

      {/* Elevated Stage */}
      <div className="flex-1 flex items-center justify-center elevated-stage rounded-2xl border border-border/30 p-8 min-h-[350px] relative overflow-hidden">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-20 grid-pattern pointer-events-none" />
        

        {!config.text.trim() ? (
          <div className="text-center text-muted-foreground relative z-10">
            <div className="h-16 w-16 rounded-2xl bg-secondary/80 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <p className="font-semibold text-lg">Enter a value to generate barcode</p>
            <p className="text-sm mt-1 text-muted-foreground/70">Your barcode will appear here</p>
          </div>
        ) : !isValid ? (
          <div className="text-center text-destructive flex flex-col items-center gap-3 relative z-10">
            <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-8 w-8" />
            </div>
            <p className="font-semibold text-lg">{errorMessage}</p>
          </div>
        ) : renderError ? (
          <div className="text-center text-destructive flex flex-col items-center gap-3 relative z-10">
            <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-8 w-8" />
            </div>
            <p className="font-semibold">Render Error</p>
            <p className="text-sm">{renderError}</p>
          </div>
        ) : (
          <div 
            className="barcode-platform p-6 rounded-2xl transition-all duration-300 relative z-10"
            style={getPreviewStyles()}
          >
            {is2D ? (
              barcodeDataUrl ? (
                <img src={barcodeDataUrl} alt="2D Barcode" className="max-w-full" />
              ) : (
                <div className="text-muted-foreground">Loading...</div>
              )
            ) : (
              <svg ref={svgRef} />
            )}
          </div>
        )}
      </div>

      {/* Barcode Dimensions Info */}
      {isValid && config.text.trim() && !renderError && (
        <div className="mt-4 p-4 rounded-xl border border-border/50 bg-card/50">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground block text-xs font-semibold mb-1">Bar Width (X-dim)</span>
              <span className="font-mono text-primary">
                {snap.requestedMils.toFixed(2) !== snap.actualMils.toFixed(2)
                  ? `${snap.requestedMils.toFixed(2)} → ${snap.actualMils.toFixed(2)} mil`
                  : `${snap.actualMils.toFixed(2)} mil`
                }
              </span>
              <span className="text-muted-foreground text-xs block mt-0.5">
                ({snap.modulePixels} px @ {config.dpi} DPI)
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-xs font-semibold mb-1">Physical Size</span>
              <span className="font-mono text-primary">
                {(snap.modulePixels * 25.4 / config.dpi).toFixed(2)} mm
              </span>
              <span className="text-muted-foreground text-xs block mt-0.5">
                ({(snap.modulePixels * 25.4 / config.dpi / 25.4).toFixed(3)} in)
              </span>
            </div>
          </div>
          {snap.requestedMils.toFixed(2) !== snap.actualMils.toFixed(2) && (
            <div className="mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-400/90">
                ⚠ Requested {snap.requestedMils.toFixed(2)} mil was adjusted to {snap.actualMils.toFixed(2)} mil due to pixel snapping at {config.dpi} DPI
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Switch
          id="cert-toggle"
          checked={certEnabled}
          onCheckedChange={setCertEnabled}
        />
        <Label htmlFor="cert-toggle" className="text-sm text-muted-foreground cursor-pointer select-none">
          Validation Certificate
        </Label>
      </div>

      {certEnabled && isCertifying && isValid && config.text.trim() && (
        <div className="mt-3 p-4 rounded-xl border border-border/50 bg-card/50 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Certifying barcode…
        </div>
      )}

      {certEnabled && certificate && !isCertifying && (() => {
        const gradeColor: Record<string, string> = {
          A: 'bg-green-500/20 text-green-400 border-green-500/30',
          B: 'bg-green-500/20 text-green-400 border-green-500/30',
          C: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
          D: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
          F: 'bg-red-500/20 text-red-400 border-red-500/30',
        };
        const g = certificate.isoGrade;
        return (
          <div className="mt-3 p-4 rounded-xl border border-border/50 bg-card/50 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                Validation Certificate
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold px-3 py-0.5 rounded-lg border ${gradeColor[g]}`}>
                  ISO Grade {g}
                </span>
                <button
                  onClick={downloadCertificate}
                  className="flex items-center gap-1.5 text-sm font-bold px-3 py-0.5 rounded-lg border bg-secondary/20 text-muted-foreground border-border/50 hover:text-foreground hover:border-border transition-colors"
                >
                  <FileJson className="h-3.5 w-3.5" />
                  JSON
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
              <span className="text-muted-foreground">Symbology</span>
              <span>{certificate.symbologyDetected}</span>
              <span className="text-muted-foreground">Validation</span>
              {certificate.scanVerification === 'not_supported' ? (
                <span className="text-amber-400" title={certificate.scanVerificationNote ?? ''}>
                  Not supported ⓘ
                </span>
              ) : (
                <span className={certificate.scanVerification === 'pass' ? 'text-green-400' : 'text-red-400'}>
                  {certificate.scanVerification === 'pass' ? 'Pass' : 'Fail'}
                </span>
              )}
              <span className="text-muted-foreground">Checksum</span>
              <span>{certificate.checksumCalculationStatus.status}</span>
              <span className="text-muted-foreground">X-Dimension</span>
              <span className={certificate.xDimensionCompliant ? 'text-green-400' : 'text-amber-400'}>
                {certificate.xDimensionMils} mils {certificate.xDimensionCompliant ? '≥ 7.5 ✓' : '< 7.5 ⚠'}
              </span>
              <span className="text-muted-foreground">Timestamp</span>
              <span className="text-muted-foreground">{new Date(certificate.timestamp).toLocaleTimeString()}</span>
            </div>
            {certificate.scanVerification === 'not_supported' && certificate.scanVerificationNote && (
              <div className="text-xs text-amber-400/80 border-t border-border/50 pt-2 leading-relaxed">
                ⓘ {certificate.scanVerificationNote}
              </div>
            )}
            {certificate.errors.length > 0 && (
              <div className="text-xs text-red-400 font-mono border-t border-border/50 pt-2">
                {certificate.errors.join(' · ')}
              </div>
            )}
          </div>
        );
      })()}

      {checksumInfo && (
        <div className="mt-4 p-4 bg-primary/10 rounded-xl border border-primary/20">
          <p className="text-sm font-mono text-primary">{checksumInfo}</p>
        </div>
      )}

      {effects.enableEffects && (
        <div className="mt-4 p-4 bg-muted rounded-xl border border-border/50">
          <p className="text-xs font-mono text-muted-foreground">
            Effects: scale={effects.scale.toFixed(2)}x | contrast={effects.contrast.toFixed(2)} | 
            blur={effects.blur}px | noise={effects.noise}% | rotation={effects.rotation}° | 
            thickness={effects.lineThickness.toFixed(2)}x | spacing={effects.lineSpacing.toFixed(2)}x
          </p>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={barcodeCanvasRef} className="hidden" />
    </div>
  );
}
