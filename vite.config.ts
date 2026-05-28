import { defineConfig } from "vite"; // Use vite instead of vitest
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createRequire } from "module";
import pkg from "./package.json";

// Single source of truth for build-number resolution — shared with
// scripts/build-electron.mjs so the web bundle, installer filename, and EXE
// version metadata all agree for a given commit. See scripts/build-number.cjs
// for the priority order (package.json buildNumber → APP_BUILD env → git
// commit count → CI run number fallback).
const requireCjs = createRequire(import.meta.url);
const { readBuildNumber, readCommit } = requireCjs("./scripts/build-number.cjs");

const git = { build: readBuildNumber(pkg), commit: readCommit() };

export default defineConfig({
  plugins: [react()],
  // Inject build-time constants. __APP_VERSION__ is read from package.json so
  // the About dialog never ships a hardcoded version. __APP_BUILD__ is the git
  // commit count (or CI run number) — auto-increments on every build — and
  // __APP_COMMIT__ is the short SHA for crash reports / issue triage.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_NAME__: JSON.stringify(pkg.build?.productName ?? pkg.name),
    __APP_AUTHOR__: JSON.stringify(pkg.author ?? ""),
    __APP_BUILD__: JSON.stringify(git.build),
    __APP_COMMIT__: JSON.stringify(git.commit),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    },
  },
  // Base path resolution:
  //   - Electron (file://) and local previews need relative paths ('./') so
  //     that index.html can resolve /assets/* from the app folder.
  //   - GitHub Pages deploy serves the app from /barcodegeneratorapp/ and
  //     requires that prefix. The deploy workflow sets VITE_BASE accordingly.
  // Defaulting to './' keeps `npm run electron:build` working out-of-the-box.
  base: process.env.VITE_BASE ?? './',
  build: {
    outDir: 'dist',
    emptyOutDir: true, // Cleans the folder before building
  },
  // You can keep the test block if you are running tests
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
} as any); // 'as any' helps if TypeScript complains about the 'test' key in a Vite config
