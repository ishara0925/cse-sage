/// <reference lib="webworker" />
// Runs AI-generated Python entirely client-side (no server, no sandbox to run —
// the browser's own worker isolation is the boundary). Keeps the visitor's pasted
// API keys (which live in the main thread's localStorage) out of this worker's
// reach, and no network access is wired in here on purpose.

declare function importScripts(...urls: string[]): void
declare const loadPyodide: (config: { indexURL: string }) => Promise<any>

const PYODIDE_VERSION = '0.28.0'
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

let pyodide: any = null
let readyPromise: Promise<void> | null = null

async function init(): Promise<void> {
  importScripts(`${PYODIDE_CDN}pyodide.js`)
  pyodide = await loadPyodide({ indexURL: PYODIDE_CDN })
  await pyodide.loadPackage(['pandas', 'numpy', 'matplotlib', 'micropip'])
  await pyodide.runPythonAsync(`
# backtesting.py unconditionally imports multiprocessing.resource_tracker (for its
# optimize() parallel-process path), which pulls in _multiprocessing/_posixshmem —
# native modules Pyodide doesn't ship. We never use optimize() here, so stub them
# out before installing; this must happen before the first "import backtesting".
import sys, types

def _noop(*_a, **_kw):
    pass

if '_multiprocessing' not in sys.modules:
    _m = types.ModuleType('_multiprocessing')
    _m.sem_unlink = _noop
    sys.modules['_multiprocessing'] = _m

if '_posixshmem' not in sys.modules:
    _m = types.ModuleType('_posixshmem')
    _m.shm_unlink = _noop
    _m.shm_open = _noop
    sys.modules['_posixshmem'] = _m

import micropip
await micropip.install('backtesting')
import matplotlib
matplotlib.use('AGG')
`)
}

function ensureReady(): Promise<void> {
  readyPromise ??= init()
  return readyPromise
}

/** Emscripten FS errors (e.g. ENOENT from a missing parent dir) have no `.message` and
 * stringify to "[object Object]" — pull out whatever's actually informative instead. */
function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object') {
    const e = err as { name?: string; errno?: number; message?: unknown }
    if (typeof e.message === 'string' && e.message) return e.message
    if (e.name || e.errno !== undefined) return `${e.name ?? 'Error'} (errno ${e.errno ?? '?'})`
    try {
      return JSON.stringify(err)
    } catch {
      // fall through
    }
  }
  return String(err)
}

function writeFileEnsuringDir(path: string, content: string) {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (dir) pyodide.FS.mkdirTree(dir)
  pyodide.FS.writeFile(path, content)
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, code, files } = e.data as {
    id: string
    type: 'init' | 'run'
    code?: string
    files?: Record<string, string>
  }

  try {
    if (type === 'init') {
      await ensureReady()
      ;(self as unknown as Worker).postMessage({ id, type: 'ready' })
      return
    }

    if (type === 'run') {
      await ensureReady()

      if (files) {
        for (const [path, content] of Object.entries(files)) {
          writeFileEnsuringDir(path, content)
        }
      }

      let stdout = ''
      pyodide.setStdout({
        batched: (s: string) => {
          stdout += s + '\n'
        },
      })
      pyodide.setStderr({
        batched: (s: string) => {
          stdout += s + '\n'
        },
      })

      try {
        const resultPy = await pyodide.runPythonAsync(code)
        const result = resultPy?.toJs ? resultPy.toJs({ dict_converter: Object.fromEntries }) : resultPy
        ;(self as unknown as Worker).postMessage({ id, type: 'result', result, stdout })
      } catch (err) {
        ;(self as unknown as Worker).postMessage({
          id,
          type: 'result',
          error: describeError(err),
          stdout,
        })
      }
      return
    }
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, type: 'error', error: describeError(err) })
  }
}
