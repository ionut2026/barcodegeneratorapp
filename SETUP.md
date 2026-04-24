# Quick Setup Guide

After cloning the repository, run this command once to install all dependencies:

```bash
npm install
```

Or use the convenience script:

```bash
npm run setup
```

This will install all required dependencies for development and building (including Vite, Electron, and all application dependencies).

## What this does

- Installs all npm packages listed in `package.json`
- Creates `node_modules/` directory
- Sets up Vite for development and building
- Configures Electron for desktop application packaging

After setup, you can run:

- `npm run dev` — Start dev server
- `npm run build` — Build web version
- `npm run electron:build` — Build Electron desktop app
- `npm test` — Run tests
