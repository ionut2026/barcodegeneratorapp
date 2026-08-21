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
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  rmSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
} from 'node:fs';

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
 * electron-builder doesn't purge `dist_electron/` between builds, so stale
 * installers from previous build numbers (e.g. 1.0.0.262.exe sitting next to
 * a fresh 1.0.0.263.exe) accumulate and confuse users. Wipe the directory
 * CONTENTS up front so each build leaves exactly one set of artifacts.
 *
 * We delete children individually rather than the directory itself because
 * Windows frequently refuses to delete the parent directory with EPERM when
 * something (Explorer, VS Code, Defender) has a handle on it, even after all
 * children are gone. Keeping the dir alive sidesteps that entirely.
 *
 * EBUSY on Windows usually means the previously built `Barcode Generator.exe`
 * is still running, or Defender is scanning a freshly written file. Retry a
 * few times with backoff before giving up so transient locks (Defender
 * finishes scanning in <1s) don't fail the build.
 */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function cleanOutputDir(dir, attempts = 5) {
  if (!existsSync(dir)) return;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      lastErr = err;
      await sleep(500 * i);
      continue;
    }
    if (entries.length === 0) return;

    let remaining = 0;
    for (const name of entries) {
      const child = path.join(dir, name);
      try {
        rmSync(child, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch (err) {
        lastErr = err;
        remaining++;
      }
    }
    if (remaining === 0) return;
    if (i < attempts) {
      console.warn(`[build-electron] clean attempt ${i} left ${remaining} entries; retrying…`);
      await sleep(500 * i);
    }
  }

  console.error(
    `[build-electron] could not clean ${dir} after ${attempts} attempts.\n` +
    `  Reason: ${lastErr?.code || ''} ${lastErr?.message || lastErr}\n` +
    `  Most common cause on Windows: the previously built "Barcode Generator.exe"\n` +
    `  is still running (close it from the Taskbar / Task Manager) or Windows\n` +
    `  Defender real-time protection is scanning it. Try again in a moment, or\n` +
    `  add a Defender exclusion for ${dir} (PowerShell as admin:\n` +
    `    Add-MpPreference -ExclusionPath "${dir}").`,
  );
  throw lastErr;
}

const outputDir = path.join(projectRoot, 'dist_electron');
await cleanOutputDir(outputDir);
console.log(`[build-electron] cleaned   = ${outputDir}`);

/*
 * winCodeSign cache primer (Windows-only).
 *
 * electron-builder runs rcedit (via app-builder.exe) to embed our .ico + version
 * strings into the EXE. app-builder fetches the legacy `winCodeSign-2.6.0` bundle
 * to obtain rcedit-x64.exe. That bundle contains macOS symlinks
 * (darwin/10.12/lib/libssl.dylib, libcrypto.dylib) which 7-Zip tries to recreate
 * on extraction. On Windows without Administrator rights or Developer Mode, the
 * OS refuses symlink creation ("A required privilege is not held by the client"),
 * 7-Zip exits non-zero, and the whole build fails.
 *
 * app-builder's DownloadArtifact() short-circuits when its final cache directory
 * already exists (CheckCache only stats the dir). So we pre-populate that exact
 * directory ourselves, extracting with 7-Zip's `-snl-` switch which writes the
 * symlink entries as plain files instead of real symlinks — no privilege needed.
 * app-builder then finds a cache hit and never runs its own failing extraction.
 *
 * This is best-effort: any failure here just logs a warning and lets
 * electron-builder proceed normally (on machines where symlink creation works,
 * or where the bundle is already cached, nothing is harmed).
 *
 * Mirrors app-builder logic in pkg/download/{tool,artifactDownloader}.go.
 */
const WIN_CODE_SIGN_ID = 'winCodeSign-2.6.0';
// base64 sha512 of winCodeSign-2.6.0.7z (from app-builder pkg/download/tool.go)
const WIN_CODE_SIGN_SHA512 =
  '6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA==';

function resolveElectronBuilderCacheDir() {
  const env = (process.env.ELECTRON_BUILDER_CACHE || '').trim();
  if (env) return path.resolve(env);
  const localAppData = (process.env.LOCALAPPDATA || '').trim();
  const username = (process.env.USERNAME || '').trim().toLowerCase();
  const isSystemUser =
    localAppData.toLowerCase().includes('\\windows\\system32\\') || username === 'system';
  if (!localAppData || isSystemUser) {
    return path.join(os.tmpdir(), 'electron-builder-cache');
  }
  return path.join(localAppData, 'electron-builder', 'Cache');
}

function winCodeSignUrl() {
  const base =
    process.env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR ||
    process.env.npm_config_electron_builder_binaries_mirror ||
    process.env.npm_package_config_electron_builder_binaries_mirror ||
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    'https://github.com/electron-userland/electron-builder-binaries/releases/download/';
  const dir =
    process.env.NPM_CONFIG_ELECTRON_BUILDER_BINARIES_CUSTOM_DIR ||
    process.env.npm_config_electron_builder_binaries_custom_dir ||
    process.env.npm_package_config_electron_builder_binaries_custom_dir ||
    process.env.ELECTRON_BUILDER_BINARIES_CUSTOM_DIR ||
    WIN_CODE_SIGN_ID;
  return `${base}${dir}/${WIN_CODE_SIGN_ID}.7z`;
}

function sha512Base64(filePath) {
  return createHash('sha512').update(readFileSync(filePath)).digest('base64');
}

async function downloadTo(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function primeWinCodeSignCache() {
  if (process.platform !== 'win32') return;
  try {
    const cacheParent = path.join(resolveElectronBuilderCacheDir(), 'winCodeSign');
    const targetDir = path.join(cacheParent, WIN_CODE_SIGN_ID);
    // rcedit-x64.exe lives at the archive root; its presence means a complete cache.
    if (existsSync(path.join(targetDir, 'rcedit-x64.exe'))) {
      console.log('[build-electron] winCodeSign cache present — primer not needed');
      return;
    }

    console.log('[build-electron] priming winCodeSign cache (symlink-safe extraction)…');
    mkdirSync(cacheParent, { recursive: true });

    // Reuse a valid leftover archive if one exists (avoids a redundant download),
    // otherwise download a fresh copy and verify its checksum.
    let archive;
    for (const name of readdirSync(cacheParent)) {
      if (!name.toLowerCase().endsWith('.7z')) continue;
      const candidate = path.join(cacheParent, name);
      try {
        if (sha512Base64(candidate) === WIN_CODE_SIGN_SHA512) {
          archive = candidate;
          break;
        }
      } catch {
        /* ignore unreadable candidate */
      }
    }

    let downloaded = null;
    if (!archive) {
      downloaded = path.join(cacheParent, `wincodesign-primer-${process.pid}.7z`);
      await downloadTo(winCodeSignUrl(), downloaded);
      if (sha512Base64(downloaded) !== WIN_CODE_SIGN_SHA512) {
        throw new Error('checksum mismatch for downloaded winCodeSign archive');
      }
      archive = downloaded;
    }

    // Extract into a temp dir first, then atomically move into place so a partial
    // extraction can never masquerade as a valid cache entry.
    const stagingDir = path.join(cacheParent, `wincodesign-primer-${process.pid}`);
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });
    const path7za = require('7zip-bin').path7za;
    // `-snl-` = do NOT restore symbolic links (write them as plain files). This is
    // the whole point: it avoids the privileged symlink creation that fails.
    execFileSync(path7za, ['x', '-snl-', '-bd', '-y', archive, `-o${stagingDir}`], {
      stdio: 'ignore',
    });

    rmSync(targetDir, { recursive: true, force: true });
    renameSync(stagingDir, targetDir);
    if (downloaded) rmSync(downloaded, { force: true });
    console.log(`[build-electron] winCodeSign cache primed at ${targetDir}`);
  } catch (err) {
    console.warn(
      `[build-electron] winCodeSign primer skipped (${err?.message || err}); ` +
        'letting electron-builder handle it normally.',
    );
  }
}

await primeWinCodeSignCache();

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
