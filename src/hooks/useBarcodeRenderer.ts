import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import JsBarcode from 'jsbarcode';
import bwipjs from 'bwip-js';
import { BarcodeConfig, is2DBarcode, normalizeForRendering, applyChecksum, QUALITY_LEVELS, physicalPxScale, clampBwipTextsize } from '@/lib/barcodeUtils';
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

/**
 * Supersample factor used when rasterising a rotated SVG. Inflating
 * width/height (but not viewBox) makes the SVG renderer draw vector content
 * into a denser bitmap, so a 2 px-wide bar rotated to a steep angle gets
 * ~8 source pixels for anti-aliasing along its diagonal edge instead of ~2.
 * The denser bitmap is then downsampled to the target canvas size with
 * high-quality smoothing, yielding clean rotated bars at any angle.
 */
export const SVG_ROTATION_SUPERSAMPLE = 4;

/**
 * Bake a rotation into the SVG itself as a vector transform.
 *
 * Wraps the SVG's children in a `<g transform="translate(dx,dy) rotate(θ,cx,cy)">`
 * and expands the SVG's width / height / viewBox to fit the rotated bounding
 * box. The SVG renderer then rasterises the bars and text *vector-sharp at the
 * rotated angle*, eliminating the bitmap-rotation aliasing that supersampled
 * canvas rotation can only partially mask.
 *
 * Additionally, when `supersample` > 1, the SVG's `width`/`height` attributes
 * are inflated by that factor while `viewBox` stays at the natural rotated
 * bbox. The browser then rasterises vector content at `supersample`× the
 * intrinsic pixel density (more pixels per bar module → clean diagonal AA).
 *
 * Bars also have `shape-rendering` switched to `geometricPrecision` so the
 * rotated edges anti-alias correctly (crispEdges would defeat the point).
 *
 * Returns true if rotation was applied, false on a no-op (angle ≈ 0 or no
 * usable SVG dimensions).
 */
export function bakeSvgRotation(
  svg: SVGSVGElement,
  rotationDeg: number,
  supersample = 1,
): boolean {
  if (!rotationDeg || Math.abs(rotationDeg) < 0.001) return false;

  const widthAttr = parseFloat(svg.getAttribute('width') || '0');
  const heightAttr = parseFloat(svg.getAttribute('height') || '0');
  let w = widthAttr;
  let h = heightAttr;
  if ((!w || !h) && svg.getAttribute('viewBox')) {
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
    if (vb.length === 4) { w = vb[2]; h = vb[3]; }
  }
  if (!w || !h) return false;

  const theta = (rotationDeg * Math.PI) / 180;
  const cosT = Math.abs(Math.cos(theta));
  const sinT = Math.abs(Math.sin(theta));
  const newW = Math.ceil(w * cosT + h * sinT);
  const newH = Math.ceil(w * sinT + h * cosT);
  const dx = (newW - w) / 2;
  const dy = (newH - h) / 2;

  const NS = 'http://www.w3.org/2000/svg';
  const wrapper = document.createElementNS(NS, 'g');
  // translate moves the original (un-rotated) content to the centre of the
  // expanded viewBox; rotate then pivots around that centre.
  wrapper.setAttribute(
    'transform',
    `translate(${dx}, ${dy}) rotate(${rotationDeg}, ${w / 2}, ${h / 2})`,
  );

  while (svg.firstChild) {
    wrapper.appendChild(svg.firstChild);
  }
  svg.appendChild(wrapper);

  const ss = Math.max(1, supersample);
  // viewBox stays at the natural rotated bbox; only the rasterisation size
  // (width / height) is inflated, so the SVG renderer draws at higher pixel
  // density without changing any layout coordinates.
  svg.setAttribute('width', String(newW * ss));
  svg.setAttribute('height', String(newH * ss));
  svg.setAttribute('viewBox', `0 0 ${newW} ${newH}`);

  // Anti-alias rotated edges (crispEdges would re-introduce stair-stepping).
  svg.querySelectorAll('rect').forEach(rect => {
    rect.setAttribute('shape-rendering', 'geometricPrecision');
  });

  return true;
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

  const modulePixels = useMemo(() => {
    return Math.max(1, Math.round(config.widthMils * config.dpi / 1000));
  }, [config.widthMils, config.dpi]);

  // qualityBlur is effective blur in pixels: blur-fraction-of-module × module
  // width in px. Scales naturally with DPI / X-dim so A vs B vs C remain
  // perceptually distinct at any resolution. Computed AFTER modulePixels.
  const qualityBlur = useMemo(() => {
    const fraction = QUALITY_LEVELS.find(q => q.value === config.quality)?.blur ?? 0;
    return fraction * modulePixels;
  }, [config.quality, modulePixels]);

  const effectiveWidth = useMemo(() => {
    const pixelWidth = config.widthMils * config.dpi / 1000;
    const raw = effects.enableEffects ? pixelWidth * effects.lineThickness : pixelWidth;
    return Math.max(1, Math.round(raw));
  }, [config.widthMils, config.dpi, effects.enableEffects, effects.lineThickness]);

  // Render 1D barcodes with JsBarcode
  useEffect(() => {
    if (is2D || !svgRef.current || !isValid || !config.text.trim()) {
      setRenderError(null);
      return;
    }

    try {
      const renderText = normalizeForRendering(barcodeText, config.format);
      // DPI-stable physical size: height/margin/fontSize are "logical pixels at
      // BASE_DPI". Multiply by dpi/BASE_DPI so higher DPI yields more pixels for
      // the same physical mm (sharper print, identical size).
      const dpiScale = physicalPxScale(config.dpi);
      JsBarcode(svgRef.current, renderText, {
        format: config.format,
        width: Math.max(1, Math.round(effectiveWidth * config.scale)),
        height: config.height * config.scale * dpiScale,
        displayValue: config.displayValue,
        fontSize: config.fontSize * config.scale * dpiScale,
        lineColor: config.lineColor,
        background: config.background,
        margin: config.margin * config.scale * dpiScale,
        font: 'JetBrains Mono',
      });
      snapSvgToPixels(svgRef.current);
      // When the preview is rotated (or perspective-skewed) via CSS, crispEdges
      // produces severe stair-stepping on the no-longer-axis-aligned bars.
      // Switch to geometricPrecision so the browser anti-aliases the rotated
      // raster. Axis-aligned (rotation=0, perspective=0) keeps crispEdges for
      // pixel-perfect bars.
      const previewRotated = effects.enableEffects && (effects.rotation !== 0 || effects.perspective > 0);
      if (previewRotated) {
        svgRef.current.querySelectorAll('rect').forEach(rect => {
          rect.setAttribute('shape-rendering', 'geometricPrecision');
        });
      }
      setRenderError(null);
    } catch (error) {
      console.error('Barcode render error:', error);
      setRenderError(error instanceof Error ? error.message : 'Failed to render barcode');
    }
  }, [config, isValid, barcodeText, effectiveWidth, is2D, config.scale, effects.enableEffects, effects.rotation, effects.perspective]);

  // Render 2D barcodes with bwip-js
  useEffect(() => {
    if (!is2D || !barcodeCanvasRef.current || !isValid || !config.text.trim()) {
      setBarcodeDataUrl(null);
      return;
    }

    try {
      const dpiScale = physicalPxScale(config.dpi);
      const bwipOptions: Record<string, unknown> = {
        bcid: config.format,
        text: barcodeText,
        scale: Math.max(1, Math.round(effectiveWidth * config.scale)),
        includetext: config.displayValue,
        textsize: clampBwipTextsize(config.fontSize * config.scale * dpiScale),
        textxalign: 'center',
        backgroundcolor: config.background.replace('#', ''),
        barcolor: config.lineColor.replace('#', ''),
        padding: Math.round(config.margin * config.scale * dpiScale),
      };

      if (config.format === 'pdf417') {
        bwipOptions.height = Math.floor((config.height * config.scale * dpiScale) / 10);
        bwipOptions.width = Math.floor((config.height * config.scale * dpiScale) / 3);
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
  //
  // `fxOverride` lets callers run the effects pipeline with a different effects
  // object than the current state. Used to skip the canvas rotation step when
  // rotation has already been baked into the source SVG as a vector transform
  // (gives perfect bar quality at any angle, no bitmap aliasing).
  const applyEffects = useCallback((
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    img: HTMLImageElement,
    fxOverride?: ImageEffectsConfig,
  ) => {
    const fx = fxOverride ?? effects;
    const scaledWidth = Math.round(img.width * fx.scale);
    const scaledHeight = Math.round(img.height * fx.scale);

    // Expand the destination canvas to fit the rotated/skewed content so
    // corners are not clipped. For rotation θ the bounding box is
    // w·|cosθ| + h·|sinθ|  ×  w·|sinθ| + h·|cosθ|. Perspective skew adds a
    // small horizontal extent on each side. When no rotation/perspective is
    // active we keep the original axis-aligned dimensions (pixel-perfect).
    const theta = (fx.rotation * Math.PI) / 180;
    const cosT = Math.abs(Math.cos(theta));
    const sinT = Math.abs(Math.sin(theta));
    const skewAmount = fx.perspective > 0 ? fx.perspective * 0.01 : 0;
    const perspectivePad = Math.ceil(scaledHeight * Math.abs(skewAmount * 0.3));
    const targetWidth = Math.max(
      1,
      Math.round(scaledWidth * cosT + scaledHeight * sinT) + perspectivePad * 2,
    );
    const targetHeight = Math.max(
      1,
      Math.round(scaledWidth * sinT + scaledHeight * cosT)
        + Math.ceil(scaledWidth * Math.abs(skewAmount * 0.5)),
    );

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    // When rotation or perspective is applied, drawing the source bitmap once
    // at the final size produces severe aliasing on the (now diagonal) bar
    // edges — the "wavy bars" the user sees. Render into a 3× supersample
    // buffer with high-quality smoothing, then downscale; the two-step
    // resample gives clean anti-aliased rotated bars without changing the
    // exported canvas dimensions or DPI.
    const needsSupersample = fx.rotation !== 0 || fx.perspective > 0;
    const ss = needsSupersample ? 3 : 1;

    const work: HTMLCanvasElement = needsSupersample ? document.createElement('canvas') : canvas;
    const workCtx: CanvasRenderingContext2D = needsSupersample
      ? (work.getContext('2d') as CanvasRenderingContext2D)
      : ctx;
    if (needsSupersample) {
      work.width = targetWidth * ss;
      work.height = targetHeight * ss;
    }

    workCtx.save();
    workCtx.imageSmoothingEnabled = true;
    workCtx.imageSmoothingQuality = 'high';
    workCtx.fillStyle = config.background;
    workCtx.fillRect(0, 0, work.width, work.height);

    // Centre the (un-rotated) bitmap inside the expanded canvas, then rotate
    // around the canvas centre so the rotation pivots about the bar centre.
    const drawW = scaledWidth * ss;
    const drawH = scaledHeight * ss;
    const baseOffsetX = (work.width - drawW) / 2;
    const baseOffsetY = (work.height - drawH) / 2;

    if (fx.rotation !== 0) {
      workCtx.translate(work.width / 2, work.height / 2);
      workCtx.rotate((fx.rotation * Math.PI) / 180);
      workCtx.translate(-work.width / 2, -work.height / 2);
    }

    if (fx.perspective > 0) {
      workCtx.transform(1, skewAmount * 0.5, -skewAmount * 0.3, 1, 0, 0);
    }

    const spacingMultiplier = fx.lineSpacing;
    const finalDrawW = drawW * spacingMultiplier;
    const offsetX = baseOffsetX + (drawW - finalDrawW) / 2;

    workCtx.drawImage(img, offsetX, baseOffsetY, finalDrawW, drawH);
    workCtx.restore();

    if (needsSupersample) {
      ctx.save();
      ctx.fillStyle = config.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(work, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      work.width = 0;
      work.height = 0;
    }

    if (fx.contrast !== 1 || fx.brightness !== 0) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        data[i]     = Math.min(255, Math.max(0, ((data[i]     - 128) * fx.contrast) + 128 + fx.brightness));
        data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1] - 128) * fx.contrast) + 128 + fx.brightness));
        data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2] - 128) * fx.contrast) + 128 + fx.brightness));
      }

      ctx.putImageData(imageData, 0, 0);
    }

    if (fx.noise > 0) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const noiseAmount = fx.noise * 2.55;

      for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * noiseAmount;
        data[i]     = Math.min(255, Math.max(0, data[i]     + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
      }

      ctx.putImageData(imageData, 0, 0);
    }

    if (fx.blur > 0) {
      ctx.filter = `blur(${fx.blur}px)`;
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
        const dpiScale = physicalPxScale(config.dpi);
        const tempCanvas = document.createElement('canvas');
        const bwipOptions: Record<string, unknown> = {
          bcid: config.format,
          text: barcodeText,
          scale: modulePixels,
          includetext: config.displayValue,
          textsize: clampBwipTextsize(config.fontSize * dpiScale),
          textxalign: 'center',
          backgroundcolor: config.background.replace('#', ''),
          barcolor: config.lineColor.replace('#', ''),
          padding: Math.round(config.margin * dpiScale),
        };
        if (config.format === 'pdf417') {
          bwipOptions.height = Math.floor((config.height * dpiScale) / 10);
          bwipOptions.width = Math.floor((config.height * dpiScale) / 3);
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
      const dpiScale = physicalPxScale(config.dpi);
      const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(tempSvg, renderText, {
        format: config.format,
        width: modulePixels,
        height: config.height * dpiScale,
        displayValue: config.displayValue,
        fontSize: config.fontSize * dpiScale,
        lineColor: config.lineColor,
        background: config.background,
        margin: config.margin * dpiScale,
        font: 'Courier',
        textMargin: 2,
      });
      snapSvgToPixels(tempSvg);
      // Bake rotation as a vector transform inside the SVG. This makes the
      // SVG renderer draw bars and text vector-sharp at the rotated angle —
      // no bitmap aliasing, no waviness, no matter the angle. The canvas
      // stage below then skips its own rotation step (rotation: 0 override).
      //
      // A supersample factor inflates the SVG's rasterisation size (but not
      // its viewBox), so steep angles still get plenty of source pixels for
      // clean anti-aliased diagonal edges. The canvas-side scale override
      // divides by the same factor to keep final output dimensions unchanged.
      const svgRotated = effects.enableEffects && effects.rotation !== 0
        ? bakeSvgRotation(tempSvg, effects.rotation, SVG_ROTATION_SUPERSAMPLE)
        : false;
      // Perspective (skew) still has to happen on canvas — there's no clean
      // SVG vector equivalent. Force geometricPrecision in that case too so
      // the canvas supersampler doesn't smooth pre-aliased input.
      if (effects.enableEffects && effects.perspective > 0 && !svgRotated) {
        tempSvg.querySelectorAll('rect').forEach(rect => {
          rect.setAttribute('shape-rendering', 'geometricPrecision');
        });
      }

      const svgData = new XMLSerializer().serializeToString(tempSvg);
      const img = new Image();
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          if (effects.enableEffects) {
            // When rotation has been baked into the SVG vector layer, tell
            // applyEffects to skip its own canvas rotation step (otherwise
            // we'd double-rotate). The img is now SVG_ROTATION_SUPERSAMPLE×
            // larger than the target, so divide scale by the same factor to
            // keep final dimensions identical — drawImage downsamples with
            // high-quality smoothing, giving clean rotated bars.
            const fxOverride = svgRotated
              ? { ...effects, rotation: 0, scale: effects.scale / SVG_ROTATION_SUPERSAMPLE }
              : undefined;
            applyEffects(exportCtx, exportCanvas, img, fxOverride);
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
