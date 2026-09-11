export interface RunResult {
  result?: unknown
  error?: string
  stdout: string
}

type PendingHandler = (msg: any) => void

class PyodideClient {
  private worker: Worker | null = null
  private pending = new Map<string, PendingHandler>()
  private nextId = 0
  private readyPromise: Promise<void> | null = null

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/pyodide.worker.ts', import.meta.url))
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, ...rest } = e.data
        this.pending.get(id)?.(rest)
      }
    }
    return this.worker
  }

  private send(type: string, payload: Record<string, unknown> = {}): Promise<any> {
    const worker = this.ensureWorker()
    const id = String(this.nextId++)
    return new Promise((resolve) => {
      this.pending.set(id, (msg) => {
        this.pending.delete(id)
        resolve(msg)
      })
      worker.postMessage({ id, type, ...payload })
    })
  }

  /** Loads Pyodide + pandas/numpy/matplotlib/backtesting.py. Idempotent, safe to call repeatedly. */
  async init(): Promise<void> {
    this.readyPromise ??= this.send('init').then(() => undefined)
    return this.readyPromise
  }

  async run(code: string, files?: Record<string, string>): Promise<RunResult> {
    await this.init()
    return this.send('run', { code, files })
  }
}

export const pyodideClient = new PyodideClient()
