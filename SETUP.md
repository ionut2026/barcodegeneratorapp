# Setup Guide

## Prerequisites

- **Node.js** v18+ (v20 LTS or v22 recommended)
- **npm** v9+

### Installing Node.js

**Debian/Ubuntu:**
```bash
# Option 1: System packages (may be outdated)
sudo apt update
sudo apt install nodejs npm

# Option 2: NodeSource (recommended — gets latest LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**Windows:**
- Download installer from https://nodejs.org (LTS version)
- Or use `winget install OpenJS.NodeJS.LTS`

Verify installation:
```bash
node --version   # should be v18+
npm --version    # should be v9+
```

## Install Dependencies

After cloning the repository, run:

```bash
npm install
```

This installs all packages from `package.json` into `node_modules/`.

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server at localhost:5173 |
| `npm run build` | Production build (outputs to `dist/`) |
| `npm run preview` | Preview production build locally |
| `npm run electron:build` | Build + package as Electron desktop app |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |

## Building for Windows (Electron)

The Electron build produces Windows installers (NSIS + portable):

```bash
npm run electron:build
```

Output goes to `dist_electron/`. This works from both Linux and Windows.

## Troubleshooting

### `vite: not found`
Dependencies are not installed. Run `npm install`.

### `ERESOLVE could not resolve` / peer dependency conflicts
Delete `node_modules` and `package-lock.json`, then reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

### Wrong Node.js version
Check with `node --version`. If below v18, upgrade using NodeSource (see above) or nvm:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
```
