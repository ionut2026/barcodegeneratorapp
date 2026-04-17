import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BarcodeExportActions } from '@/components/BarcodeExportActions';

describe('BarcodeExportActions', () => {
  const onDownload = vi.fn().mockResolvedValue(undefined);
  const onCopy = vi.fn().mockResolvedValue(undefined);
  const onPrint = vi.fn();

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('renders Copy, Download PNG and Print buttons', () => {
    render(<BarcodeExportActions disabled={false} onDownload={onDownload} onCopy={onCopy} onPrint={onPrint} />);
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Download PNG')).toBeInTheDocument();
    expect(screen.getByText('Print')).toBeInTheDocument();
  });

  it('disables all buttons when disabled=true', () => {
    render(<BarcodeExportActions disabled={true} onDownload={onDownload} onCopy={onCopy} onPrint={onPrint} />);
    expect(screen.getByText('Copy').closest('button')).toBeDisabled();
    expect(screen.getByText('Download PNG').closest('button')).toBeDisabled();
    expect(screen.getByText('Print').closest('button')).toBeDisabled();
  });

  it('shows "Copied" after successful copy, reverts after 2000ms', async () => {
    render(<BarcodeExportActions disabled={false} onDownload={onDownload} onCopy={onCopy} onPrint={onPrint} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Copy').closest('button')!);
    });
    expect(screen.getByText('Copied')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1999); });
    expect(screen.getByText('Copied')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('does not show "Copied" if onCopy throws', async () => {
    const failingCopy = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    render(<BarcodeExportActions disabled={false} onDownload={onDownload} onCopy={failingCopy} onPrint={onPrint} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Copy').closest('button')!);
    });
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('calls onDownload when Download PNG is clicked', async () => {
    render(<BarcodeExportActions disabled={false} onDownload={onDownload} onCopy={onCopy} onPrint={onPrint} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Download PNG'));
    });
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('renders Print as a dropdown trigger button', () => {
    render(<BarcodeExportActions disabled={false} onDownload={onDownload} onCopy={onCopy} onPrint={onPrint} />);
    const printBtn = screen.getByText('Print').closest('button');
    expect(printBtn).toBeInTheDocument();
    expect(printBtn).not.toBeDisabled();
  });
});
