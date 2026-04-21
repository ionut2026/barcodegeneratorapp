import "@testing-library/jest-dom";

// Vite's `define` substitutions are applied to source files but not reliably
// surfaced inside Vitest workers, so we polyfill the build-time constants
// here. Production builds still get the real values injected by Vite.
const g = globalThis as Record<string, unknown>;
if (typeof g.__APP_VERSION__ === "undefined") g.__APP_VERSION__ = "1.0.0";
if (typeof g.__APP_NAME__ === "undefined") g.__APP_NAME__ = "Barcode Generator";
if (typeof g.__APP_AUTHOR__ === "undefined") g.__APP_AUTHOR__ = "Ionut";
if (typeof g.__APP_BUILD__ === "undefined") g.__APP_BUILD__ = "0";
if (typeof g.__APP_COMMIT__ === "undefined") g.__APP_COMMIT__ = "";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
