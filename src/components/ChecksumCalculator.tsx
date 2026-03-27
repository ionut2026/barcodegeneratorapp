import { useState, useEffect, useMemo } from 'react';
import {
  calculateMod10,
  calculateMod11,
  calculateMod43Checksum,
  calculateMod16Checksum,
  calculateJapanNW7Checksum,
  calculateJRCChecksum,
  calculateLuhnChecksum,
  calculateMod11PZNChecksum,
  calculateMod11AChecksum,
  calculateMod10Weight2Checksum,
  calculateMod10Weight3Checksum,
  calculate7CheckDRChecksum,
  calculateMod16JapanChecksum,
  calculateEAN13Checksum,
  calculateUPCChecksum,
  calculateGS1Mod10,
} from '@/lib/barcodeUtils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calculator, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ChecksumResult {
  name: string;
  value: string;
  fullValue: string;
  applicable: boolean;
}

interface ChecksumCalculatorProps {
  onChecksumData?: (input: string, checksums: ChecksumResult[]) => void;
}

export function ChecksumCalculator({ onChecksumData }: ChecksumCalculatorProps) {
  const [input, setInput] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const getChecksums = (): ChecksumResult[] => {
    if (!input.trim()) return [];

    const isNumeric = /^\d+$/.test(input);
    const cleanInput = input.toUpperCase();

    const results: ChecksumResult[] = [
      {
        name: 'Luhn (Mod 10)',
        value: isNumeric ? calculateLuhnChecksum(input) : '-',
        fullValue: isNumeric ? input + calculateLuhnChecksum(input) : '-',
        applicable: isNumeric,
      },
      {
        name: 'ITF Mod 10 (GS1)',
        value: isNumeric ? String(calculateGS1Mod10(input)) : '-',
        fullValue: isNumeric ? input + calculateGS1Mod10(input) : '-',
        applicable: isNumeric,
      },
      {
        name: 'Mod 10 Weight 2',
        value: isNumeric ? calculateMod10Weight2Checksum(input) : '-',
        fullValue: isNumeric ? input + calculateMod10Weight2Checksum(input) : '-',
        applicable: isNumeric,
      },
      {
        name: 'Mod 10 Weight 3',
        value: isNumeric ? calculateMod10Weight3Checksum(input) : '-',
        fullValue: isNumeric ? input + calculateMod10Weight3Checksum(input) : '-',
        applicable: isNumeric,
      },
      {
        name: 'Mod 11',
        value: isNumeric ? String(calculateMod11(input) === 10 ? 'X' : calculateMod11(input)) : '-',
        fullValue: isNumeric ? input + (calculateMod11(input) === 10 ? 'X' : calculateMod11(input)) : '-',
        applicable: isNumeric,
      },
      {
        name: 'Mod 11-A',
        value: isNumeric ? calculateMod11AChecksum(input) : '-',
        fullValue: isNumeric ? input + calculateMod11AChecksum(input) : '-',
        applicable: isNumeric,
      },
      {
        name: 'Mod 11 PZN',
        value: isNumeric ? calculateMod11PZNChecksum(input) : '-',
        fullValue: isNumeric ? input + calculateMod11PZNChecksum(input) : '-',
        applicable: isNumeric,
      },
      {
        name: 'Modulo 43 (CODE 39)',
        value: calculateMod43Checksum(cleanInput),
        fullValue: cleanInput + calculateMod43Checksum(cleanInput),
        applicable: true,
      },
      {
        name: 'Modulo 16 (Codabar)',
        value: calculateMod16Checksum(input),
        fullValue: input + calculateMod16Checksum(input),
        applicable: true,
      },
      {
        name: 'Japan NW-7',
        value: calculateJapanNW7Checksum(input),
        fullValue: input + calculateJapanNW7Checksum(input),
        applicable: true,
      },
      {
        name: 'JRC',
        value: isNumeric ? calculateJRCChecksum(input) : '-',
        fullValue: isNumeric ? input + calculateJRCChecksum(input) : '-',
        applicable: isNumeric,
      },
      {
        name: '7 Check DR',
        value: isNumeric ? calculate7CheckDRChecksum(input) : '-',
        fullValue: isNumeric ? input + calculate7CheckDRChecksum(input) : '-',
        applicable: isNumeric,
      },
      {
        name: 'Mod 16 Japan',
        value: calculateMod16JapanChecksum(input),
        fullValue: input + calculateMod16JapanChecksum(input),
        applicable: true,
      },
      {
        name: 'EAN-13',
        value: input.length === 12 && isNumeric ? String(calculateEAN13Checksum(input)) : '-',
        fullValue: input.length === 12 && isNumeric ? input + calculateEAN13Checksum(input) : '-',
        applicable: input.length === 12 && isNumeric,
      },
      {
        name: 'UPC-A',
        value: input.length === 11 && isNumeric ? String(calculateUPCChecksum(input)) : '-',
        fullValue: input.length === 11 && isNumeric ? input + calculateUPCChecksum(input) : '-',
        applicable: input.length === 11 && isNumeric,
      },
    ];

    return results;
  };

  const checksums = useMemo(() => getChecksums(), [input]);

  // Notify parent of input/checksum changes
  useEffect(() => {
    onChecksumData?.(input, checksums);
  }, [input, checksums, onChecksumData]);

  const copyValue = (value: string, index: number) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedIndex(index);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedIndex(null), 2000);
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Calculator className="h-4 w-4 text-primary" />
        <span>Checksum Calculator</span>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Input Value</Label>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter value to calculate checksums..."
          className="font-mono"
        />
      </div>

      {checksums.length > 0 && (
        <div className="space-y-2">
          {checksums.map((checksum, index) => (
            <div
              key={checksum.name}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                checksum.applicable 
                  ? 'bg-card border-border' 
                  : 'bg-muted/50 border-transparent opacity-50'
              }`}
            >
              <div className="flex-1">
                <p className="text-sm font-medium">{checksum.name}</p>
                {checksum.applicable && (
                  <p className="text-xs text-muted-foreground font-mono mt-1">
                    Check: <span className="text-primary font-semibold">{checksum.value}</span>
                    {' → '}
                    <span className="text-foreground">{checksum.fullValue}</span>
                  </p>
                )}
              </div>
              {checksum.applicable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyValue(checksum.fullValue, index)}
                  className="ml-2"
                >
                  {copiedIndex === index ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!input.trim() && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Enter a value above to calculate checksums
        </p>
      )}
    </div>
  );
}
