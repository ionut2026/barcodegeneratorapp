import { useState, useRef, useEffect, useCallback } from 'react';
import { BarcodeConfig } from '@/lib/barcodeUtils';
import { ValidationService, ValidationCertificate } from '@/lib/validationService';
import { toast } from 'sonner';

export interface UseCertificationResult {
  certificate: ValidationCertificate | null;
  isCertifying: boolean;
  certEnabled: boolean;
  setCertEnabled: (v: boolean) => void;
  downloadCertificate: () => void;
}

export function useCertification(
  config: BarcodeConfig,
  isValid: boolean,
): UseCertificationResult {
  const [certificate, setCertificate] = useState<ValidationCertificate | null>(null);
  const [isCertifying, setIsCertifying] = useState(false);
  const [certEnabled, setCertEnabled] = useState(false);
  const certifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const certifyGenerationRef = useRef(0);

  // Only the fields that materially affect the decoded image / ISO grade should
  // re-trigger certification. Cosmetic config changes (lineColor, fontSize,
  // background, displayValue, margin, quality, ...) must NOT kick off another
  // 600 ms debounce + ZXing decode round-trip — that wastes CPU/battery and
  // creates user-visible flicker on every cosmetic edit.
  const { format, text, checksumType, widthMils, dpi } = config;
  useEffect(() => {
    if (!certEnabled || !isValid || !text.trim()) {
      setCertificate(null);
      setIsCertifying(false);
      if (certifyTimerRef.current) clearTimeout(certifyTimerRef.current);
      return;
    }
    if (certifyTimerRef.current) clearTimeout(certifyTimerRef.current);
    const generation = ++certifyGenerationRef.current;
    setIsCertifying(true);
    certifyTimerRef.current = setTimeout(async () => {
      const svc = new ValidationService();
      const cert = await svc.certify(config);
      if (certifyGenerationRef.current === generation) {
        setCertificate(cert);
        setIsCertifying(false);
      }
    }, 600);
    return () => {
      if (certifyTimerRef.current) clearTimeout(certifyTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, text, checksumType, widthMils, dpi, isValid, certEnabled]);

  const downloadCertificate = useCallback(() => {
    if (!certificate) return;
    const json = JSON.stringify(certificate, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `cert-${config.format}-${Date.now()}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Certificate downloaded');
  }, [certificate, config.format]);

  return { certificate, isCertifying, certEnabled, setCertEnabled, downloadCertificate };
}
