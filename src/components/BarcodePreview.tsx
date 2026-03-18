import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import bwipjs from 'bwip-js';
import { BarcodeConfig, applyChecksum, is2DBarcode, QUALITY_LEVELS, normalizeForRendering } from '@/lib/barcodeUtils';
import { ImageEffectsConfig, getDefaultEffectsConfig } from '@/components/ImageEffects';
 import { Download, Copy, Check, AlertCircle, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface BarcodePreviewProps {
  config: BarcodeConfig;
  effects?: ImageEffectsConfig;
  isValid: boolean;
  errorMessage: string;
}

const defaultEffects = getDefaultEffectsConfig();

/**
 * Snap all bar rect coordinates and group translate values to integer pixels,
 * and set shape-rendering="crispEdges" so the SVG renderer doesn't anti-alias
 * bar edges. Applied to the live preview SVG and to fresh SVGs before export.
 */
function snapSvgToPixels(svg: SVGSVGElement): void {
  svg.setAttribute('shape-rendering', 'crispEdges');

  svg.querySelectorAll('rect').forEach(rect => {
    ['x', 'y', 'width', 'height'].forEach(attr => {
      const val = rect.getAttribute(attr);
      if (val !== null) rect.setAttribute(attr, String(Math.round(parseFloat(val))));
    });
  });

  svg.querySelectorAll('g[transform]').forEach(g => {
    const t = g.getAttribute('transform');
    if (t) {
      g.setAttribute(
        'transform',
        t.replace(/translate\(([^)]+)\)/g, (_, args) => {
          const nums = args.split(/[\s,]+/).map((n: string) => Math.round(parseFloat(n)));
          return `translate(${nums.join(', ')})`;
        }),
      );
    }
  });
}

// Map our format names to bwip-js format names
function getBwipFormat(format: string): string {
  const formatMap: Record<string, string> = {
    'qrcode': 'qrcode',
    'azteccode': 'azteccode',
    'datamatrix': 'datamatrix',
    'pdf417': 'pdf417',
  };
  return formatMap[format] || format;
}

export function BarcodePreview({ config, effects = defaultEffects, isValid, errorMessage }: BarcodePreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const noiseCanvasRef = useRef<HTMLCanvasElement>(null);
  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);

  const is2D = is2DBarcode(config.format);

  // Compute the barcode text with checksum applied
  const barcodeText = useMemo(() => {
    return applyChecksum(config.text, config.format, config.checksumType);
  }, [config.text, config.format, config.checksumType]);

  // Get quality blur level
  const qualityBlur = useMemo(() => {
    return QUALITY_LEVELS.find(q => q.value === config.quality)?.blur || 0;
  }, [config.quality]);

  // Compute effective bar width: convert mils → pixels using DPI, then apply line thickness
  const effectiveWidth = useMemo(() => {
    const pixelWidth = config.widthMils * config.dpi / 1000;
    if (effects.enableEffects) {
      return pixelWidth * effects.lineThickness;
    }
    return pixelWidth;
  }, [config.widthMils, config.dpi, effects.enableEffects, effects.lineThickness]);

  // Render 1D barcodes with JsBarcode
  useEffect(() => {
    if (is2D || !svgRef.current || !isValid || !config.text.trim()) {
      setRenderError(null);
      return;
    }

    try {
      const renderText = normalizeForRendering(barcodeText, config.format);
      JsBarcode(svgRef.current, renderText, {
        format: config.format,
         width: effectiveWidth * config.scale,
         height: config.height * config.scale,
        displayValue: config.displayValue,
         fontSize: config.fontSize * config.scale,
        lineColor: config.lineColor,
        background: config.background,
         margin: config.margin * config.scale,
        font: 'JetBrains Mono',
      });
      snapSvgToPixels(svgRef.current);
      setRenderError(null);
    } catch (error) {
      console.error('Barcode render error:', error);
      setRenderError(error instanceof Error ? error.message : 'Failed to render barcode');
    }
   }, [config, isValid, barcodeText, effectiveWidth, is2D, config.scale]);

  // Render 2D barcodes with bwip-js
  useEffect(() => {
    if (!is2D || !barcodeCanvasRef.current || !isValid || !config.text.trim()) {
      setBarcodeDataUrl(null);
      return;
    }

    try {
      const bwipOptions: Record<string, unknown> = {
        bcid: getBwipFormat(config.format),
        text: barcodeText,
         scale: Math.max(1, Math.round(effectiveWidth * config.scale)),
        includetext: config.displayValue,
         textsize: Math.round(config.fontSize * config.scale),
        textxalign: 'center',
        backgroundcolor: config.background.replace('#', ''),
        barcolor: config.lineColor.replace('#', ''),
         padding: Math.round(config.margin * config.scale),
      };

      if (config.format === 'pdf417') {
         bwipOptions.height = Math.floor((config.height * config.scale) / 10);
         bwipOptions.width = Math.floor((config.height * config.scale) / 3);
      }

      bwipjs.toCanvas(barcodeCanvasRef.current, bwipOptions as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
      setBarcodeDataUrl(barcodeCanvasRef.current.toDataURL('image/png'));
      setRenderError(null);
    } catch (error) {
      console.error('2D Barcode render error:', error);
      setRenderError(error instanceof Error ? error.message : 'Failed to render 2D barcode');
      setBarcodeDataUrl(null);
    }
   }, [config, isValid, barcodeText, effectiveWidth, is2D, config.scale]);

  const applyEffects = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, img: HTMLImageElement) => {
    const scaledWidth = Math.round(img.width * effects.scale);
    const scaledHeight = Math.round(img.height * effects.scale);
    
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
    
    ctx.save();
    ctx.fillStyle = config.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (effects.rotation !== 0) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((effects.rotation * Math.PI) / 180);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
    }
    
    if (effects.perspective > 0) {
      const skewAmount = effects.perspective * 0.01;
      ctx.transform(1, skewAmount * 0.5, -skewAmount * 0.3, 1, 0, 0);
    }
    
    const spacingMultiplier = effects.lineSpacing;
    const drawWidth = scaledWidth * spacingMultiplier;
    const offsetX = (scaledWidth - drawWidth) / 2;
    
    ctx.drawImage(img, offsetX, 0, drawWidth, scaledHeight);
    
    if (effects.contrast !== 1 || effects.brightness !== 0) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, Math.max(0, ((data[i] - 128) * effects.contrast) + 128 + effects.brightness));
        data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1] - 128) * effects.contrast) + 128 + effects.brightness));
        data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2] - 128) * effects.contrast) + 128 + effects.brightness));
      }
      
      ctx.putImageData(imageData, 0, 0);
    }
    
    if (effects.noise > 0) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const noiseAmount = effects.noise * 2.55;
      
      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * noiseAmount;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
      }
      
      ctx.putImageData(imageData, 0, 0);
    }
    
    ctx.restore();
    
    if (effects.blur > 0) {
      ctx.filter = `blur(${effects.blur}px)`;
      ctx.drawImage(canvas, 0, 0);
      ctx.filter = 'none';
    }
  }, [effects, config.background]);

  const downloadBarcode = async () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (is2D) {
      if (!barcodeCanvasRef.current) return;
      
      const sourceCanvas = barcodeCanvasRef.current;
      const img = new Image();
      img.onload = () => {
        if (effects.enableEffects) {
          applyEffects(ctx, canvas, img);
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
        }

        const link = document.createElement('a');
        link.download = `barcode-${config.format}-${barcodeText}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        toast.success('Barcode downloaded successfully');
      };
      img.src = sourceCanvas.toDataURL('image/png');
    } else {
      if (!svgRef.current) return;
      
      const svg = svgRef.current;
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const img = new Image();
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        if (effects.enableEffects) {
          applyEffects(ctx, canvas, img);
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0);
        }

        const link = document.createElement('a');
        link.download = `barcode-${config.format}-${barcodeText}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        toast.success('Barcode downloaded successfully');
        URL.revokeObjectURL(url);
      };

      img.src = url;
    }
  };

  const copyToClipboard = async () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    try {
      if (is2D) {
        if (!barcodeCanvasRef.current) return;
        
        const sourceCanvas = barcodeCanvasRef.current;
        const img = new Image();
        
        await new Promise<void>((resolve) => {
          img.onload = () => {
            if (effects.enableEffects) {
              applyEffects(ctx, canvas, img);
            } else {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.drawImage(img, 0, 0);
            }
            resolve();
          };
          img.src = sourceCanvas.toDataURL('image/png');
        });
      } else {
        if (!svgRef.current) return;
        
        const svg = svgRef.current;
        const svgData = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        await new Promise<void>((resolve) => {
          img.onload = () => {
            if (effects.enableEffects) {
              applyEffects(ctx, canvas, img);
            } else {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img, 0, 0);
            }
            URL.revokeObjectURL(url);
            resolve();
          };
          img.src = url;
        });
      }

      canvas.toBlob(async (blob) => {
        if (blob) {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          setCopied(true);
          toast.success('Barcode copied to clipboard');
          setTimeout(() => setCopied(false), 2000);
        }
      });
    } catch (error) {
      console.error('Copy failed:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  // Print barcode — always renders clean (no effects, no quiet zone/margin)
  const printBarcode = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const pixelWidth = config.widthMils * config.dpi / 1000;

    const openPrintWindow = (imageDataUrl: string) => {
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
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              body {
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                background: white;
              }
              img {
                max-width: 90%;
                height: auto;
                image-rendering: -webkit-optimize-contrast;
                image-rendering: crisp-edges;
                image-rendering: pixelated;
                -ms-interpolation-mode: nearest-neighbor;
              }
              @media print {
                body {
                  display: flex;
                  justify-content: center;
                  align-items: center;
                 -webkit-print-color-adjust: exact;
                 print-color-adjust: exact;
                }
                img {
                  max-width: 90%;
                  height: auto;
                 image-rendering: -webkit-optimize-contrast;
                 image-rendering: crisp-edges;
                 image-rendering: pixelated;
                 -ms-interpolation-mode: nearest-neighbor;
                }
              }
            </style>
          </head>
          <body>
            <img src="${imageDataUrl}" alt="Barcode" />
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

    const dispatchPrint = (dataUrl: string) => {
      if (typeof window !== 'undefined' && window.require) {
        try {
          const { ipcRenderer } = window.require('electron');
          ipcRenderer.send('print-barcode', dataUrl);
          return;
        } catch (error) {
          console.error('Electron print failed, falling back to browser print:', error);
        }
      }
      openPrintWindow(dataUrl);
    };

    if (is2D) {
      // Re-render 2D barcode with padding:0 — no quiet zone, no effects
      const tempCanvas = document.createElement('canvas');
      try {
        const bwipOptions: Record<string, unknown> = {
          bcid: getBwipFormat(config.format),
          text: barcodeText,
          scale: Math.max(1, Math.round(pixelWidth * config.scale)),
          includetext: config.displayValue,
          textsize: Math.round(config.fontSize * config.scale),
          textxalign: 'center',
          backgroundcolor: config.background.replace('#', ''),
          barcolor: config.lineColor.replace('#', ''),
          padding: 0,
        };
        if (config.format === 'pdf417') {
          bwipOptions.height = Math.floor((config.height * config.scale) / 10);
          bwipOptions.width = Math.floor((config.height * config.scale) / 3);
        }
        bwipjs.toCanvas(tempCanvas, bwipOptions as unknown as Parameters<typeof bwipjs.toCanvas>[1]);
        dispatchPrint(tempCanvas.toDataURL('image/png'));
      } catch (error) {
        console.error('Print 2D barcode error:', error);
      }
    } else {
      // Re-render 1D barcode with margin:0 — no quiet zone, no effects
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const renderText = normalizeForRendering(barcodeText, config.format);
      try {
        JsBarcode(tempSvg, renderText, {
          format: config.format,
          width: Math.round(pixelWidth * config.scale),
          height: config.height * config.scale,
          displayValue: config.displayValue,
          fontSize: config.fontSize * config.scale,
          lineColor: config.lineColor,
          background: config.background,
          margin: 0,
          font: 'JetBrains Mono',
        });
        snapSvgToPixels(tempSvg);
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
          dispatchPrint(canvas.toDataURL('image/png'));
        };
        img.src = url;
      } catch (error) {
        console.error('Print 1D barcode error:', error);
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
        <div className="flex gap-3">
          <Button
            size="sm"
            onClick={copyToClipboard}
            disabled={!isValid || !!renderError}
            className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            onClick={downloadBarcode}
            disabled={!isValid || !!renderError}
            className="gap-2 rounded-xl h-10 px-5 download-btn text-white font-medium"
          >
            <Download className="h-4 w-4" />
            Download PNG
          </Button>
          <Button
            size="sm"
            onClick={printBarcode}
            disabled={!isValid || !!renderError}
            className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
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
      <canvas ref={noiseCanvasRef} className="hidden" />
      <canvas ref={barcodeCanvasRef} className="hidden" />
    </div>
  );
}
