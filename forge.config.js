const path = require('path');
const fs = require('fs');

module.exports = {
  hooks: {
    postPackage: async (forgeConfig, options) => {
      // Remove unused locale files (keep only en-US)
      const localesDir = path.join(options.outputPaths[0], 'locales');
      if (fs.existsSync(localesDir)) {
        for (const file of fs.readdirSync(localesDir)) {
          if (file !== 'en-US.pak') {
            fs.unlinkSync(path.join(localesDir, file));
          }
        }
      }
    },
    postMake: async (forgeConfig, makeResults) => {
      // Rename AppImage artifacts to strip version and arch from filename
      for (const result of makeResults) {
        if (result.artifacts) {
          for (let i = 0; i < result.artifacts.length; i++) {
            const artifact = result.artifacts[i];
            if (artifact.endsWith('.AppImage')) {
              const dir = path.dirname(artifact);
              const newPath = path.join(dir, 'Gimodi.AppImage');
              fs.renameSync(artifact, newPath);
              result.artifacts[i] = newPath;
            }
          }
        }
      }
      return makeResults;
    },
  },
  packagerConfig: {
    name: 'Gimodi',
    executableName: 'gimodi',
    appBundleId: 'io.github.gimodi',
    appCategoryType: 'public.app-category.social-networking',
    // Point to assets/icon.{ico,icns,png} - add those files for full icon support.
    // electron-packager picks the right extension per platform automatically.
    icon: 'assets/icon',
    asar: true,
    electronLanguages: ['en-US'],
    ignore: [
      /^\/src\/renderer\/app\.js$/,  // source entry; dist/bundle.js is what's needed
      /^\/node_modules\/.bin/,
      /^\/out\//,
      // Dev/build tools not needed at runtime
      /^\/node_modules\/@electron-forge\//,
      /^\/node_modules\/@esbuild\//,
      /^\/node_modules\/esbuild\//,
      /^\/node_modules\/typescript\//,
      /^\/node_modules\/prettier\//,
      /^\/node_modules\/webpack\//,
      /^\/node_modules\/cmake-js\//,
      /^\/node_modules\/@inquirer\//,
      /^\/node_modules\/@listr2\//,
      /^\/node_modules\/@vscode\//,
      /^\/node_modules\/@jridgewell\//,
      /^\/node_modules\/@sindresorhus\//,
      /^\/node_modules\/@szmarczak\//,
      /^\/node_modules\/@types\//,
      /^\/node_modules\/@malept\//,
      /^\/node_modules\/@nodelib\//,
      /^\/node_modules\/@npmcli\//,
      /^\/node_modules\/postject\//,
      /^\/node_modules\/terser\//,
      /^\/node_modules\/ajv\//,
      /^\/node_modules\/caniuse-lite\//,
      /^\/node_modules\/lodash\//,
      /^\/node_modules\/@webassemblyjs\//,
      /^\/node_modules\/@xtuc\//,
      // Large files not needed from included packages
      /^\/node_modules\/openpgp\/dist\/openpgp\.min\.mjs$/,
      /^\/node_modules\/openpgp\/dist\/lightweight/,
      /^\/node_modules\/bootstrap-icons\/icons\//,
      /^\/node_modules\/bootstrap-icons\/bootstrap-icons\.svg$/,
      /^\/node_modules\/highlight\.js\/lib\/languages\//,  // esbuild bundle includes what's needed
      /^\/node_modules\/highlight\.js\/es\//,
    ],
  },

  makers: [
    // ── Windows: Squirrel ────────────────────────────────────────────────────
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'gimodi',
        authors: 'Gimodi',
        description: 'Gimodi client for Linux, macOS, and Windows',
        setupIcon: 'assets/icon.ico',
        loadingGif: 'assets/install-spinner.gif',
        /*...(process.env.SQUIRREL_CERT_PATH && {
          certificateFile: process.env.SQUIRREL_CERT_PATH,
          certificatePassword: process.env.SQUIRREL_CERT_PASSWORD,
        }),*/
      },
    },

    // ── Linux: .deb ──────────────────────────────────────────────────────────
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          maintainer: 'Gimodi',
          homepage: 'https://github.com/gimodi-app',
          icon: 'assets/icon.png',
          categories: ['Network', 'Chat'],
          mimeType: [],
        },
      },
    },

    // ── Linux: AppImage ──────────────────────────────────────────────────────
    {
      name: '@reforged/maker-appimage',
      platforms: ['linux'],
      config: {},
    },

    // ── All platforms: .zip ──────────────────────────────────────────────────
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'darwin', 'linux'],
    },
  ],
};
