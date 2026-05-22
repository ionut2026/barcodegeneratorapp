import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import bwipjs from 'bwip-js';
import { BarcodeConfig, is2DBarcode, normalizeForRendering, applyChecksum, QUALITY_LEVELS } from '@/lib/barcodeUtils';
import { ImageEffectsConfig } from '@/components/ImageEffects';

export interface UseBarcodeRendererResult {
  svgRef: React.RefObject<SVGSVGElement>;
  barcodeCanvasRef: React.RefObject<HTMLCanvasElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  barcodeDataUrl: string | null;
  renderError: string | null;
  is2D: boolean;
  barcodeText: string;
  effectiveWidth: number;
  modulePixels: number;
  qualityBlur: number;
  renderExportCanvas: () => Promise<HTMLCanvasElement | null>;
}

/**
 * Snap all bar rect coordinates and group translate values to integer pixels,
 * and set shape-rendering="crispEdges" so the SVG renderer doesn't anti-alias
 * bar edges. Applied to the live preview SVG and to fresh SVGs before export.
 */
export function snapSvgToPixels(svg: SVGSVGElement): void {
  svg.querySelectorAll('rect').forEach(rect => {
    rect.setAttribute('shape-rendering', 'crispEdges');
    ['x', 'y', 'width', 'height'].forEach(attr => {
      const val = rect.getAttribute(attr);
      if (val !== null) rect.setAttribute(attr, String(Math.round(parseFloat(val))));
    });
  });

  svg.querySelectorAll('g[transform]').forEach(g => {
    if (g.querySelector('text')) return;
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

export function useBarcodeRenderer(
  config: BarcodeConfig,
  effects: ImageEffectsConfig,
  isValid: boolean,
  _errorMessage: string,
): UseBarcodeRendererResult {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);

  const is2D = useMemo(() => is2DBarcode(config.format), [config.format]);

  const barcodeText = useMemo(() => {
    return applyChecksum(config.text, config.format, config.checksumType);
  }, [config.text, config.format, config.checksumType]);

  const qualityBlur = useMemo(() => {
    return QUALITY_LEVELS.find(q => q.value === config.quality)?.blur || 0;
  }, [config.quality]);

  const effectiveWidth = useMemo(() => {
    const pixelWidth = config.widthMils * config.dpi / 1000;
    const raw = effects.enableEffects ? pixelWidth * effects.lineThickness : pixelWidth;
    return Math.max(1, Math.round(raw));
  }, [config.widthMils, config.dpi, effects.enableEffects, effects.lineThickness]);

  const modulePixels = useMemo(() => {
    return Math.max(1, Math.round(config.widthMils * config.dpi / 1000));
  }, [config.widthMils, config.dpi]);

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
        width: Math.max(1, Math.round(effectiveWidth * config.scale)),
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
        bcid: config.format,
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

  // CRITICAL: applyEffects and renderExportCanvas share a closure over `effects`
  // and `config.background`. They must stay in the same hook to avoid stale-closure
  // bugs in PNG exports when effects change between renders.
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
        data[i]     = Math.min(255, Math.max(0, ((data[i]     - 128) * effects.contrast) + 128 + effects.brightness));
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
        data[i]     = Math.min(255, Math.max(0, data[i]     + noise));
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

  /**
   * Apply the quality-level blur (A=0, B=0.5, C=1.2 px) to the canvas in place.
   * Mirrors the preview's CSS `filter: blur(...)` so download / copy / print
   * PNGs actually reflect the user's quality choice — previously only the
   * preview was affected.
   */
  const applyQualityBlurInPlace = useCallback((canvas: HTMLCanvasElement) => {
    if (qualityBlur <= 0 || canvas.width === 0 || canvas.height === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Render the canvas onto itself through a blur filter. Use a tmp canvas to
    // avoid the source/destination overlap restriction on canvas.drawImage.
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.drawImage(canvas, 0, 0);
    ctx.save();
    ctx.filter = `blur(${qualityBlur}px)`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    ctx.filter = 'none';
    tmp.width = 0;
    tmp.height = 0;
  }, [qualityBlur]);

  /**
   * Render a fresh barcode at base DPI resolution for export (download / copy).
   *
   * CRITICAL: No config.scale is applied here.  Each pixel maps 1:1 to a print
   * dot at config.dpi, so the exported PNG has exactly the right pixel count for
   * the target DPI — no double-scaling, no viewer-dependent reinterpretation.
   *
   *   modulePixels = round(widthMils × dpi / 1000)   e.g. 7.5 mil @ 300 DPI → 2 px
   *   physical size = pixels × 25.4 / dpi             e.g. 2 px @ 300 DPI → 0.17 mm (6.7 mil)
   */
  const renderExportCanvas = async (): Promise<HTMLCanvasElement | null> => {
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) return null;

    if (is2D) {
      try {
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
          padding: config.margin,
        };
        if (config.format === 'pdf417') {
          bwipOptions.height = Math.floor(config.height / 10);
          bwipOptions.width = Math.floor(config.height / 3);
        }
        bwipjs.toCanvas(tempCanvas, bwipOptions as unknown as Parameters<typeof bwipjs.toCanvas>[1]);

        if (effects.enableEffects) {
          const img = new Image();
          await new Promise<void>((resolve) => {
            img.onload = () => { applyEffects(exportCtx, exportCanvas, img); resolve(); };
            img.src = tempCanvas.toDataURL('image/png');
          });
        } else {
          exportCanvas.width = tempCanvas.width;
          exportCanvas.height = tempCanvas.height;
          exportCtx.drawImage(tempCanvas, 0, 0);
        }
        tempCanvas.width = 0;
        tempCanvas.height = 0;
        applyQualityBlurInPlace(exportCanvas);
        return exportCanvas;
      } catch (e) {
        console.error('Export render error (2D):', e);
        return null;
      }
    }

    // 1D barcode — render with displayValue using a system font (Courier)
    // that is always available in isolated SVG contexts (serialized SVG blobs
    // cannot access page CSS / Google Fonts). crispEdges is applied only to
    // rect elements by snapSvgToPixels so text retains anti-aliasing.
    const renderText = normalizeForRendering(barcodeText, config.format);
    try {
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
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

      const svgData = new XMLSerializer().serializeToString(tempSvg);
      const img = new Image();
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          if (effects.enableEffects) {
            applyEffects(exportCtx, exportCanvas, img);
          } else {
            exportCanvas.width = img.width;
            exportCanvas.height = img.height;
            exportCtx.imageSmoothingEnabled = false;
            exportCtx.drawImage(img, 0, 0);
          }
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
        img.src = url;
      });
      applyQualityBlurInPlace(exportCanvas);
      return exportCanvas;
    } catch (e) {
      console.error('Export render error (1D):', e);
      return null;
    }
  };

  return {
    svgRef,
    barcodeCanvasRef,
    canvasRef,
    barcodeDataUrl,
    renderError,
    is2D,
    barcodeText,
    effectiveWidth,
    modulePixels,
    qualityBlur,
    renderExportCanvas,
  };
}
