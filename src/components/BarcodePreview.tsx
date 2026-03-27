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
    // 1D barcode, no effects: download as SVG for perfect vector/physical dimensions.
    if (!is2D && !effects.enableEffects) {
      const renderText = normalizeForRendering(barcodeText, config.format);
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      try {
        JsBarcode(tempSvg, renderText, {
          format: config.format,
          width: modulePixels,
          height: config.height,
          displayValue: config.displayValue,
          fontSize: config.fontSize,
          lineColor: config.lineColor,
          background: config.background,
          margin: config.margin,
          font: 'Courier',
          textMargin: 2,
        });
        snapSvgToPixels(tempSvg);
        const svgWidthPx = parseFloat(tempSvg.getAttribute('width') || '0');
        const svgHeightPx = parseFloat(tempSvg.getAttribute('height') || '0');
        if (!svgWidthPx || !svgHeightPx) throw new Error('SVG rendered without dimensions');

        const wMm = +(svgWidthPx * 25.4 / config.dpi).toFixed(2);
        const hMm = +(svgHeightPx * 25.4 / config.dpi).toFixed(2);
        tempSvg.setAttribute('viewBox', `0 0 ${svgWidthPx} ${svgHeightPx}`);
        tempSvg.setAttribute('width', `${wMm}mm`);
        tempSvg.setAttribute('height', `${hMm}mm`);

        const svgData = new XMLSerializer().serializeToString(tempSvg);
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `barcode-${config.format}-${barcodeText}.svg`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);

        const actualMils = ((modulePixels * 1000) / config.dpi).toFixed(1);
        toast.success(`Downloaded: ${wMm} × ${hMm} mm · ${actualMils} mil module (SVG vector)`);
      } catch (e) {
        toast.error('Failed to generate SVG for download');
      }
      return;
    }

    // 2D barcode, or 1D with effects enabled: export as PNG with embedded DPI metadata.
    // Effects are raster operations that cannot be applied to SVG.
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

  // Print barcode — renders at base DPI resolution (no scale), no effects, margin:0.
  // 1D in browser: SVG is embedded inline so the printer receives vector data at the
  // correct physical mm size.  1D in Electron or 2D (any): canvas → PNG path.
  // pixels = round(widthMils × dpi / 1000) per module → mm = pixels × 25.4 / dpi
  const printBarcode = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const actualMils = ((modulePixels * 1000) / config.dpi).toFixed(1);
    const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;

    // Open a print window with an SVG barcode embedded inline.
    // The SVG's width/height attributes are already in mm, so the printer uses
    // physical dimensions directly — no DPI math required on the print side.
    const openSvgPrintWindow = (svgContent: string, widthMm: number, heightMm: number) => {
      const printWindow = window.open('', '', 'width=800,height=600');
      if (!printWindow) {
        toast.error('Failed to open print window. Please check your popup blocker.');
        return;
      }
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Print Barcode</title>
            <style>
              @page {
                size: auto;
                margin: 10mm;
              }
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              body {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: white;
              }
              .barcode-svg {
                display: block;
                width: ${widthMm}mm;
                height: ${heightMm}mm;
              }
              .barcode-svg svg {
                display: block;
                width: ${widthMm}mm;
                height: ${heightMm}mm;
              }
              .print-info {
                margin-top: 8mm;
                font-family: monospace;
                font-size: 9pt;
                color: #666;
                text-align: center;
                line-height: 1.6;
              }
              @media print {
                body {
                  min-height: auto;
                }
                .barcode-svg, .barcode-svg svg {
                  width: ${widthMm}mm;
                  height: ${heightMm}mm;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                .print-info {
                  display: none;
                }
              }
            </style>
          </head>
          <body>
            <div class="barcode-svg">${svgContent}</div>
            <div class="print-info">
              ${widthMm} &times; ${heightMm} mm &middot; ${actualMils} mil module (SVG vector)<br/>
              Print at 100% scale (no fit-to-page) for accurate physical dimensions
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();

      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.focus();
          printWindow.addEventListener('afterprint', () => printWindow.close());
          printWindow.print();
        }, 100);
      };
    };

    const openPrintWindow = (imageDataUrl: string, imgWidthPx: number, imgHeightPx: number) => {
      if (!imageDataUrl.startsWith('data:image/')) {
        console.error('openPrintWindow: invalid image data URL');
        return;
      }
      const printWindow = window.open('', '', 'width=800,height=600');
      if (!printWindow) {
        toast.error('Failed to open print window. Please check your popup blocker.');
        return;
      }

      // No scale in the denominator — image is at base DPI, pixels map 1:1 to dots.
      const imgWidthMm = (imgWidthPx * 25.4 / config.dpi).toFixed(2);
      const imgHeightMm = (imgHeightPx * 25.4 / config.dpi).toFixed(2);

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Print Barcode</title>
            <style>
              @page {
                size: auto;
                margin: 10mm;
              }
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              body {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: white;
              }
              img {
                width: ${imgWidthMm}mm;
                height: ${imgHeightMm}mm;
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
                image-rendering: pixelated;
                -ms-interpolation-mode: nearest-neighbor;
              }
              .print-info {
                margin-top: 8mm;
                font-family: monospace;
                font-size: 9pt;
                color: #666;
                text-align: center;
                line-height: 1.6;
              }
              @media print {
                body {
                  min-height: auto;
                }
                img {
                  width: ${imgWidthMm}mm;
                  height: ${imgHeightMm}mm;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
                .print-info {
                  display: none;
                }
              }
            </style>
          </head>
          <body>
            <img src="${imageDataUrl}" alt="Barcode" />
            <div class="print-info">
              ${imgWidthMm} &times; ${imgHeightMm} mm &middot; ${imgWidthPx} &times; ${imgHeightPx} px &middot; ${config.dpi} DPI &middot; ${actualMils} mil module<br/>
              Print at 100% scale (no fit-to-page) for accurate physical dimensions
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();

      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.focus();
          printWindow.addEventListener('afterprint', () => printWindow.close());
          printWindow.print();
        }, 100);
      };
    };

    const dispatchPrint = (rawDataUrl: string, widthPx: number, heightPx: number) => {
      const dataUrl = injectPngDpi(rawDataUrl, config.dpi);
      if (isElectron) {
        (window as any).electronAPI.printBarcode(dataUrl, {
          widthMm: +(widthPx * 25.4 / config.dpi).toFixed(2),
          heightMm: +(heightPx * 25.4 / config.dpi).toFixed(2),
          widthPx,
          heightPx,
          dpi: config.dpi,
          actualMils: +((modulePixels * 1000) / config.dpi).toFixed(1),
        });
        return;
      }
      openPrintWindow(dataUrl, widthPx, heightPx);
    };

    if (is2D) {
      const tempCanvas = document.createElement('canvas');
      try {
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
        dispatchPrint(tempCanvas.toDataURL('image/png'), tempCanvas.width, tempCanvas.height);
        tempCanvas.width = 0;
        tempCanvas.height = 0;
      } catch (error) {
        console.error('Print 2D barcode error:', error);
      }
    } else {
      // 1D barcode: browser → SVG inline (vector, physical mm); Electron → canvas PNG.
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const renderText = normalizeForRendering(barcodeText, config.format);
      try {
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

        if (!isElectron) {
          // Browser: embed SVG inline in the print window — vector quality, exact physical size.
          const svgWidthPx = parseFloat(tempSvg.getAttribute('width') || '0');
          const svgHeightPx = parseFloat(tempSvg.getAttribute('height') || '0');
          if (!svgWidthPx || !svgHeightPx) throw new Error('SVG rendered without dimensions');
          const wMm = +(svgWidthPx * 25.4 / config.dpi).toFixed(2);
          const hMm = +(svgHeightPx * 25.4 / config.dpi).toFixed(2);
          tempSvg.setAttribute('viewBox', `0 0 ${svgWidthPx} ${svgHeightPx}`);
          tempSvg.setAttribute('width', `${wMm}mm`);
          tempSvg.setAttribute('height', `${hMm}mm`);
          openSvgPrintWindow(new XMLSerializer().serializeToString(tempSvg), wMm, hMm);
        } else {
          // Electron: rasterize SVG → canvas → PNG (Electron print handler expects PNG data URL).
          const svgData = new XMLSerializer().serializeToString(tempSvg);
          const img = new Image();
          const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            dispatchPrint(canvas.toDataURL('image/png'), canvas.width, canvas.height);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            toast.error('Failed to render barcode for printing');
          };
          img.src = url;
        }
      } catch (error) {
        console.error('Print 1D barcode error:', error);
        toast.error('Failed to render barcode for printing');
      }
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
