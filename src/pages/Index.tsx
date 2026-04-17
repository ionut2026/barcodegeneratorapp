import { useState, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { BarcodePreview } from '@/components/BarcodePreview';
import { BarcodeControls } from '@/components/BarcodeControls';
import { ChecksumCalculator } from '@/components/ChecksumCalculator';
import { ChecksumPreview } from '@/components/ChecksumPreview';
import { ImageEffects, ImageEffectsConfig, getDefaultEffectsConfig } from '@/components/ImageEffects';
import { BatchGenerator, BatchActions } from '@/components/BatchGenerator';
import { BatchPreview } from '@/components/BatchPreview';
import { BarcodeConfig, getDefaultConfig, validateInput, applyChecksum } from '@/lib/barcodeUtils';
import { BarcodeImageResult } from '@/lib/barcodeImageGenerator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings2, Calculator, Sparkles, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { PrintFormatId, PRINT_FORMAT_REGISTRY, checkBarcodeFit, generatePrintPdf } from '@/lib/printFormats';

const Index = () => {
  const [config, setConfig] = useState<BarcodeConfig>(getDefaultConfig());
  const [effects, setEffects] = useState<ImageEffectsConfig>(getDefaultEffectsConfig());
  const [activeTab, setActiveTab] = useState('generator');
  const [batchImages, setBatchImages] = useState<BarcodeImageResult[]>([]);
  const [checksumInput, setChecksumInput] = useState('');
  const [checksumVariants, setChecksumVariants] = useState<{ name: string; fullValue: string; applicable: boolean }[]>([]);
  const batchActionsRef = useRef<BatchActions | null>(null);
  // Validate the raw input with checksum context first, then confirm the
  // post-checksum result is also valid (catches checksum-induced issues like
  // MSI + mod11 producing an 'X' character).
  const barcodeText = applyChecksum(config.text, config.format, config.checksumType);
  const validation = (() => {
    if (!config.text.trim()) return { valid: false, message: 'Please enter a value' };
    const rawResult = validateInput(config.text, config.format, config.checksumType);
    if (!rawResult.valid) return rawResult;
    const postResult = validateInput(barcodeText, config.format);
    if (!postResult.valid) {
      return { valid: false, message: 'Selected checksum produces an invalid character for this format' };
    }
    return postResult;
  })();

  const handleChecksumData = useCallback((input: string, checksums: { name: string; fullValue: string; applicable: boolean }[]) => {
    setChecksumInput(input);
    setChecksumVariants(checksums);
  }, []);

  const handleBatchPrint = useCallback(async (formatId: PrintFormatId) => {
    if (batchImages.length === 0) return;

    const printFormat = PRINT_FORMAT_REGISTRY[formatId];

    // Overflow check for label formats
    if (formatId !== 'a4-page' && batchImages[0]?.widthMm > 0) {
      const firstImg = batchImages[0];
      const fit = checkBarcodeFit(firstImg.width, firstImg.height, config.dpi, printFormat);
      if (!fit.fits) {
        toast.warning(
          `Barcode (${fit.barcodeWidthMm.toFixed(1)} \u00d7 ${fit.barcodeHeightMm.toFixed(1)} mm) exceeds ${printFormat.label} printable area (${fit.printableWidthMm.toFixed(1)} \u00d7 ${fit.printableHeightMm.toFixed(1)} mm). Reduce bar width or bar height to fit.`
        );
        return;
      }
    }

    try {
      await generatePrintPdf(
        batchImages.map(img => ({
          dataUrl: img.dataUrl,
          widthPx: img.width,
          heightPx: img.height,
          dpi: config.dpi,
          label: img.value,
        })),
        printFormat,
      );
    } catch (error) {
      console.error('Batch print error:', error);
      toast.error('Failed to generate print PDF');
    }
  }, [batchImages, config.dpi]);

  return (
    <div className="min-h-screen bg-background grid-pattern">
      <Header />
      
      <main className="container mx-auto px-4 py-10">
        <div className="grid lg:grid-cols-[460px_1fr] gap-8">
          {/* Controls Panel - Frosted Glass */}
          <aside className="space-y-6">
            <Tabs defaultValue="generator" value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-4 p-1.5 bg-secondary/80 backdrop-blur-sm rounded-2xl h-auto gap-1">
                <TabsTrigger 
                  value="generator" 
                  className="gap-2 py-3 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all duration-200 tab-glow"
                >
                  <Settings2 className="h-4 w-4" />
                  <span className="hidden sm:inline font-medium">Generate</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="effects" 
                  className="gap-2 py-3 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all duration-200 tab-glow"
                >
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:inline font-medium">Effects</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="batch" 
                  className="gap-2 py-3 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all duration-200 tab-glow"
                >
                  <Layers className="h-4 w-4" />
                  <span className="hidden sm:inline font-medium">Batch</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="checksum" 
                  className="gap-2 py-3 rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all duration-200 tab-glow"
                >
                  <Calculator className="h-4 w-4" />
                  <span className="hidden sm:inline font-medium">Checksum</span>
                </TabsTrigger>
              </TabsList>
              
              <div className="mt-6 p-6 glass-panel rounded-2xl shadow-xl max-h-[calc(100vh-280px)] overflow-y-auto">
                <TabsContent value="generator" className="mt-0">
                  <BarcodeControls
                    config={config}
                    onChange={setConfig}
                    isValid={validation.valid}
                    errorMessage={validation.message}
                  />
                </TabsContent>
                
                <TabsContent value="effects" className="mt-0">
                  <ImageEffects
                    config={effects}
                    onChange={setEffects}
                  />
                </TabsContent>

                <TabsContent value="batch" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <BatchGenerator
                    onImagesGenerated={setBatchImages}
                    onActionsReady={(actions) => { batchActionsRef.current = actions; }}
                  />
                </TabsContent>
                
                <TabsContent value="checksum" className="mt-0">
                  <ChecksumCalculator onChecksumData={handleChecksumData} />
                </TabsContent>
              </div>
            </Tabs>
          </aside>

          {/* Preview Panel - Elevated Stage */}
          <section className="glass-panel rounded-2xl shadow-xl p-8">
            {activeTab === 'batch' ? (
              <BatchPreview
                images={batchImages}
                onPrint={handleBatchPrint}
                onDownloadZip={() => batchActionsRef.current?.downloadAsZip()}
                onExportPDF={() => batchActionsRef.current?.exportAsPDF()}
                isGenerating={batchActionsRef.current?.isGenerating ?? false}
                actionsDisabled={batchActionsRef.current?.isDisabled ?? true}
                dpi={config.dpi}
              />
            ) : activeTab === 'checksum' ? (
              <ChecksumPreview
                variants={checksumVariants}
                inputValue={checksumInput}
                widthMils={config.widthMils}
                dpi={config.dpi}
              />
            ) : (
              <BarcodePreview
                config={config}
                effects={effects}
                isValid={validation.valid}
                errorMessage={validation.message}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default Index;
