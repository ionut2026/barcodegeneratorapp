import { defineConfig } from "vite"; // Use vite instead of vitest
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import pkg from "./package.json";

// Resolve a monotonically increasing build number from git commit count and a
// short SHA for traceability. Falls back silently when git isn't available
// (e.g., CI shallow-clone edge cases, tarball installs) so `npm run build`
// never fails because of a missing repository.
function readGitInfo() {
  const run = (cmd: string) =>
    execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    // Prefer CI-provided build number if set (GitHub Actions, Azure DevOps,
    // etc.). This keeps build numbers aligned with CI run identifiers when
    // building in a pipeline.
    const ciBuild =
      process.env.GITHUB_RUN_NUMBER ||
      process.env.BUILD_BUILDNUMBER ||
      process.env.BUILD_NUMBER ||
      process.env.CI_PIPELINE_IID;
    const build = ciBuild && /^\d+$/.test(ciBuild)
      ? ciBuild
      : run("git rev-list --count HEAD");
    const commit = run("git rev-parse --short HEAD");
    return { build, commit };
  } catch {
    return { build: "0", commit: "" };
  }
}

const git = readGitInfo();

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
