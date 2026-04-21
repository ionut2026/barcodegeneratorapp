import { defineConfig } from "vite"; // Use vite instead of vitest
import react from "@vitejs/plugin-react-swc";
import path from "path";
import pkg from "./package.json";

export default defineConfig({
  plugins: [react()],
  // Inject build-time constants. __APP_VERSION__ is read from package.json so
  // the About dialog never ships a hardcoded version.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_NAME__: JSON.stringify(pkg.build?.productName ?? pkg.name),
    __APP_AUTHOR__: JSON.stringify(pkg.author ?? ""),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    },
  },
  // CRITICAL: This ensures all file paths in index.html are relative (./)
  // so Electron can load them from the local folder.
  base: './', 
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
