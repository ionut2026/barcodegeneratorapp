import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AboutDialog } from './AboutDialog';

// Radix Dialog relies on ResizeObserver/portal — jsdom handles portals fine,
// but we stub the observer so ScrollArea does not spam warnings.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window !== 'undefined' && !(window as any).ResizeObserver) {
  (window as any).ResizeObserver = ResizeObserverStub;
}

const THIRDPARTY_FIXTURE = '1. React — MIT\n2. Vite — MIT\n';
const LICENSE_FIXTURE = 'Copyright (c) 2026 Ionut.\nAll rights reserved.';

function renderDialog(open = true) {
  const onOpenChange = vi.fn();
  const loadThirdParty = vi.fn().mockResolvedValue(THIRDPARTY_FIXTURE);
  const loadLicense = vi.fn().mockResolvedValue(LICENSE_FIXTURE);
  const utils = render(
    <AboutDialog
      open={open}
      onOpenChange={onOpenChange}
      loadThirdParty={loadThirdParty}
      loadLicense={loadLicense}
    />,
  );
  return { ...utils, onOpenChange, loadThirdParty, loadLicense };
}

describe('AboutDialog', () => {
  it('renders the injected app version', () => {
    renderDialog();
    expect(screen.getByText(/Version/)).toBeInTheDocument();
    // __APP_VERSION__ is replaced at build time by Vite; the value comes from
    // package.json. Asserting a SemVer-ish shape rather than a literal keeps
    // the test green across version bumps.
    expect(screen.getByText(/Version \d+\.\d+\.\d+/)).toBeInTheDocument();
  });

  it('renders licensee and license type rows', () => {
    renderDialog();
    expect(screen.getByText('Licensed to:')).toBeInTheDocument();
    expect(screen.getByText('License type:')).toBeInTheDocument();
  });

  it('renders the website link with an external href', () => {
    renderDialog();
    const link = screen.getByRole('link', { name: /github\.com/i });
    expect(link).toHaveAttribute('href', expect.stringMatching(/^https?:\/\//));
  });

  it('loads and renders THIRDPARTY content on open', async () => {
    renderDialog();
    await waitFor(() =>
      expect(screen.getByText(/React — MIT/)).toBeInTheDocument(),
    );
  });

  it('invokes onOpenChange(false) when OK is clicked', () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('switches to license view and loads LICENSE content', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /License/i }));
    await waitFor(() =>
      expect(screen.getByText(/All rights reserved/i)).toBeInTheDocument(),
    );
    // Back button returns to the About view.
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(screen.getByText('Licensed to:')).toBeInTheDocument();
  });

  it('surfaces a readable error if THIRDPARTY.txt fails to load', async () => {
    const onOpenChange = vi.fn();
    render(
      <AboutDialog
        open={true}
        onOpenChange={onOpenChange}
        loadThirdParty={() => Promise.reject(new Error('404 not found'))}
        loadLicense={() => Promise.resolve(LICENSE_FIXTURE)}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Could not load THIRDPARTY\.txt/)).toBeInTheDocument(),
    );
  });

  it('does not fetch resources when closed', () => {
    const loadThirdParty = vi.fn().mockResolvedValue('');
    const loadLicense = vi.fn().mockResolvedValue('');
    render(
      <AboutDialog
        open={false}
        onOpenChange={() => {}}
        loadThirdParty={loadThirdParty}
        loadLicense={loadLicense}
      />,
    );
    expect(loadThirdParty).not.toHaveBeenCalled();
    expect(loadLicense).not.toHaveBeenCalled();
  });
});
