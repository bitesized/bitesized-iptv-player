// Build the in-process libmpv embedding addon (native/mpv-embed) against the
// installed Electron's ABI. Runs on postinstall and via `npm run build:native`.
//
// The addon only does real work on macOS (it fixes the macOS mpv pop-out); on
// other platforms it compiles to a stub, and if the toolchain or libmpv is
// missing we warn and continue — the app falls back to the spawn+--wid path.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const addonDir = join(root, 'native', 'mpv-embed')

if (!existsSync(join(addonDir, 'binding.gyp'))) {
  console.log('[build-native] no addon sources; skipping')
  process.exit(0)
}

const electronVersion = require('electron/package.json').version
const nodeGyp = join(root, 'node_modules', '.bin', 'node-gyp')

function commandSucceeds(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// The mac target resolves libmpv through pkg-config at gyp time and compiles
// Objective-C++, so check both up front: without them node-gyp fails with a
// wall of `gyp ERR!` that reads like a broken `npm install` when in fact the
// install is fine and the app just falls back to the spawn player.
if (process.platform === 'darwin') {
  const missing = []
  if (!commandSucceeds('pkg-config', ['--exists', 'mpv'])) missing.push('libmpv (brew install mpv)')
  if (!commandSucceeds('xcode-select', ['-p']))
    missing.push('Xcode Command Line Tools (xcode-select --install)')
  if (missing.length > 0) {
    console.log(
      `[build-native] skipping mpv-embed addon — missing ${missing.join(' and ')}. ` +
        'This is not an install failure: the app falls back to the spawn player. ' +
        'Install the above and run `npm run build:native` to enable in-window video.'
    )
    process.exit(0)
  }
}

// node-gyp 9's bundled gyp needs distutils (removed in Python 3.12+); prefer a
// Python that still has it when the default one doesn't.
function pythonWithDistutils() {
  for (const py of [process.env.PYTHON, 'python3', '/usr/bin/python3', 'python3.11']) {
    if (!py) continue
    try {
      execFileSync(py, ['-c', 'import distutils'], { stdio: 'ignore' })
      return py
    } catch {
      // try next
    }
  }
  return undefined
}

const python = pythonWithDistutils()
const args = ['rebuild']
if (python) args.push(`--python=${python}`)

// Buffer node-gyp's output and only surface it when the build actually fails
// (BUILD_NATIVE_VERBOSE=1 streams it live) — a successful postinstall should
// not print hundreds of lines of compiler noise.
const verbose = process.env.BUILD_NATIVE_VERBOSE === '1'

try {
  execFileSync(nodeGyp, args, {
    cwd: addonDir,
    stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      npm_config_target: electronVersion,
      npm_config_runtime: 'electron',
      npm_config_disturl: 'https://electronjs.org/headers',
      npm_config_arch: process.arch,
      npm_config_target_arch: process.arch
    }
  })
  console.log(`[build-native] built mpv-embed for Electron ${electronVersion}`)
} catch (err) {
  console.warn(
    '[build-native] mpv-embed addon build failed; the app will fall back to the ' +
      'spawn player. `npm install` itself is fine — re-run `npm run build:native` ' +
      'after fixing the cause below (BUILD_NATIVE_VERBOSE=1 for full output).'
  )
  if (!verbose) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trimEnd()
    const tail = output.split('\n').slice(-20).join('\n')
    if (tail) console.warn(tail.replace(/^/gm, '  '))
  }
}
