const fs = require('fs')
const path = require('path')

const pkg = require('./package.json')
const appName = pkg.productName ?? pkg.name

// Only runtime files go into the package; the renderer ships as its built dist/
const IGNORE = [
  /^\/renderer\/(src|public|index\.html|vite\.config\.mjs)/,
  /^\/test/,
  /^\/(scripts|cli)(\/|$)/,
  /^\/schema\.js$/,
  /^\/out/,
  /^\/\.git/,
  /^\/README(\.de)?\.md$/,
  /^\/CHANGELOG\.md$/,
  /^\/(design|docs|packaging|android|\.github)(\/|$)/,
  /^\/renderer\/(dist-web|web)(\/|$)/,
  /^\/\.gitlab-ci\.yml$/,
  /^\/-/ // stray files from mistyped shell commands
]

module.exports = {
  packagerConfig: {
    icon: 'build/icon',
    derefSymlinks: true,
    asar: false, // pear-runtime spawns workers from real files
    ignore: (file) => IGNORE.some((re) => re.test(file))
  },

  makers: [
    {
      name: 'pear-electron-forge-maker-appimage',
      platforms: ['linux'],
      config: {
        icons: [
          { file: 'build/icon/icon-16x16.png', size: 16 },
          { file: 'build/icon/icon-32x32.png', size: 32 },
          { file: 'build/icon/icon-64x64.png', size: 64 },
          { file: 'build/icon/icon-128x128.png', size: 128 },
          { file: 'build/icon/icon-256x256.png', size: 256 }
        ]
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'linux', 'darwin']
    }
  ],

  hooks: {
    // Unsigned macOS builds need at least an ad-hoc signature to launch on Apple Silicon
    postPackage: async (config, { platform, outputPaths }) => {
      if (platform !== 'darwin' || process.platform !== 'darwin') return
      const { execFileSync } = require('child_process')
      for (const dir of outputPaths) {
        const bundle = fs.readdirSync(dir).find((f) => f.endsWith('.app'))
        if (bundle) execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(dir, bundle)], { stdio: 'inherit' })
      }
    },
    packageAfterCopy: async (config, buildPath) => {
      if (!fs.existsSync(path.join(buildPath, 'renderer', 'dist', 'index.html'))) {
        throw new Error(`${appName}: renderer/dist missing – run "npm run build" first`)
      }
    }
  },

  plugins: [
    { name: 'electron-forge-plugin-universal-prebuilds', config: {} },
    { name: 'electron-forge-plugin-prune-prebuilds', config: {} }
  ]
}
