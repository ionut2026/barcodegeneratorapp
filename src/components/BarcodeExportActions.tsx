import { useState } from 'react';
import { Download, Copy, Check, Printer, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PRINT_FORMATS, PrintFormatId } from '@/lib/printFormats';

interface BarcodeExportActionsProps {
  disabled: boolean;
  onDownload: () => Promise<void>;
  onCopy: () => Promise<void>;
  onPrint: (format: PrintFormatId) => void;
}

export function BarcodeExportActions({
  disabled,
  onDownload,
  onCopy,
  onPrint,
}: BarcodeExportActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Error toast is handled by the onCopy handler in BarcodePreview
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            disabled={disabled}
            className="gap-2 rounded-xl h-10 px-4 download-btn text-white font-medium"
          >
            <Printer className="h-4 w-4" />
            Print
            <ChevronDown className="h-3 w-3 ml-0.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {PRINT_FORMATS.map((f) => (
            <DropdownMenuItem key={f.id} onClick={() => onPrint(f.id)}>
              <div className="flex flex-col">
                <span className="font-medium">{f.label}</span>
                <span className="text-xs text-muted-foreground">{f.description}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
