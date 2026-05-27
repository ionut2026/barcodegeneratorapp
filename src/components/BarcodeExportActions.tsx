import { useState } from 'react';
import { Download, Copy, Check, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PrintFormat } from '@/lib/printFormats';
import { PrintConfigDialog } from '@/components/PrintConfigDialog';

interface BarcodeExportActionsProps {
  disabled: boolean;
  onDownload: () => Promise<void>;
  onCopy: () => Promise<void>;
  onCustomPrint?: (format: PrintFormat) => void;
}

export function BarcodeExportActions({
  disabled,
  onDownload,
  onCopy,
  onCustomPrint,
}: BarcodeExportActionsProps) {
  const [copied, setCopied] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  const handleCopy = async () => {
    try {
      await onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Error toast is handled by the onCopy handler in BarcodePreview
    }
  };

  const handleCustomPrint = (format: PrintFormat) => {
    if (onCustomPrint) {
      onCustomPrint(format);
    }
  };

  return (
    <div className="flex gap-3">
      <Button
        size="sm"
        onClick={handleCopy}
        disabled={disabled}
        className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button
        size="sm"
        onClick={onDownload}
        disabled={disabled}
        className="gap-2 rounded-xl h-10 px-5 download-btn text-white font-medium"
      >
        <Download className="h-4 w-4" />
        Download PNG
      </Button>
      <Button
        size="sm"
        onClick={() => setCustomDialogOpen(true)}
        disabled={disabled}
        className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
      >
        <Printer className="h-4 w-4" />
        Print
      </Button>

      <PrintConfigDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onPrint={handleCustomPrint}
      />
    </div>
  );
}
