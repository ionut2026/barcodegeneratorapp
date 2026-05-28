/*
 * Build-number resolver. Shared by vite.config.ts (web bundle constants) and
 * scripts/build-electron.mjs (installer/portable filenames + EXE metadata) so
 * both pipelines pick the same number for a given commit. Keeping this in a
 * single file removes the risk of the two pipelines drifting.
 *
 * Priority (first match wins):
 *   1. package.json "buildNumber" field (manual pin — set to a numeric string)
 *   2. APP_BUILD environment variable (manual pin via env)
 *   3. `git rev-list --count HEAD` (auto-increment per commit, local + CI)
 *   4. CI run-number env vars (last-resort fallback when no git history)
 *
 * Exported as CommonJS so it can be required from both ESM (.mjs) scripts and
 * vite.config.ts (which uses `import` but runs through esbuild and accepts
 * createRequire for interop).
 */
const { execSync } = require('node:child_process');

function runGit(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

function isNumericString(value) {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function readBuildNumber(pkg) {
  const manual = pkg && pkg.buildNumber;
  if (isNumericString(manual)) return manual;
  if (isNumericString(process.env.APP_BUILD)) return process.env.APP_BUILD;
  try {
    return runGit('git rev-list --count HEAD');
  } catch {
    return (
      process.env.GITHUB_RUN_NUMBER ||
      process.env.BUILD_BUILDNUMBER ||
      process.env.BUILD_NUMBER ||
      process.env.CI_PIPELINE_IID ||
      '0'
    );
  }
}

function readCommit() {
  try {
    return runGit('git rev-parse --short HEAD');
  } catch {
    return '';
  }
}

module.exports = { readBuildNumber, readCommit, isNumericString };
