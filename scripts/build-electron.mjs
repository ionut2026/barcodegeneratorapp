/*
 * Versioned Electron build wrapper.
 *
 * Why a custom wrapper instead of plain `electron-builder`?
 *   - We want filenames like "Barcode Generator Setup 1.0.0.262.exe" where
 *     `262` is the build number resolved at build time (git commit count by
 *     default, manually pinned via package.json "buildNumber" or APP_BUILD).
 *   - electron-builder's `${version}` macro expands to package.json `version`,
 *     which we keep at a valid semver "1.0.0". Passing the full 4-segment
 *     string via package.json would break npm semver validation.
 *   - We override `nsis.artifactName`, `portable.artifactName`, and the EXE's
 *     embedded `win.fileVersion` / `win.productVersion` per-build instead.
 *
 * Code-signing is NOT performed (no certificate configured). rcedit still runs
 * — that's what embeds the .ico into the EXE so Windows shows the custom icon
 * on the desktop shortcut instead of the default Electron logo.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { readBuildNumber } = require('./build-number.cjs');
const pkg = require('../package.json');
const builder = require('electron-builder');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const buildNumber = readBuildNumber(pkg);
const fullVersion = `${pkg.version}.${buildNumber}`;
const productName = (pkg.build && pkg.build.productName) || pkg.name;

console.log(`[build-electron] productName = "${productName}"`);
console.log(`[build-electron] semver      = ${pkg.version}`);
console.log(`[build-electron] buildNumber = ${buildNumber}`);
console.log(`[build-electron] fullVersion = ${fullVersion}`);

/*
 * The `\${ext}` sequences below produce the literal string `${ext}` in the
 * config we hand to electron-builder; electron-builder then interpolates it
 * with the right extension per target (.exe for nsis / portable). The other
 * macros — productName, version — we resolve here so the filename always
 * reflects the live build number.
 */
const nsisArtifact     = `${productName} Setup ${fullVersion}.\${ext}`;
const portableArtifact = `${productName} ${fullVersion}.\${ext}`;

const config = {
  /*
   * extraMetadata.version is merged into the package.json that electron-builder
   * uses internally (and bundles inside the asar). It also drives the
   * `${version}` macro that our artifactName templates reference below, so the
   * full "1.0.0.262" string lands in BOTH the installer filename and the EXE's
   * Win32 FileVersion / ProductVersion resource. package.json on disk stays at
   * a clean 3-segment semver so npm tooling keeps working.
   */
  extraMetadata: {
    version: fullVersion,
  },
  nsis: {
    artifactName: nsisArtifact,
  },
  portable: {
    artifactName: portableArtifact,
  },
};

try {
  const result = await builder.build({
    projectDir: projectRoot,
    config,
    publish: 'never',
  });
  console.log('[build-electron] artifacts:');
  for (const artifact of result) console.log('  -', artifact);
} catch (err) {
  console.error('[build-electron] build failed:', err);
  process.exit(1);
}
