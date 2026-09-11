import { useState } from 'react'
import { pyodideClient } from '../lib/pyodideClient'

type StepStatus = 'idle' | 'running' | 'ok' | 'fail'

interface Step {
  id: string
  label: string
  status: StepStatus
  detail?: string
  ms?: number
}

const SMOKE_TEST_CODE = `
import pandas as pd
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
from backtesting import Backtest, Strategy
from backtesting.lib import crossover
import io, base64, json

dates = pd.date_range("2024-01-01", periods=120, freq="D")
rng = np.random.default_rng(7)
price = 100 + np.cumsum(rng.normal(0, 1, len(dates)))
df = pd.DataFrame({
    "Open": price, "High": price + 1, "Low": price - 1, "Close": price,
    "Volume": rng.integers(1000, 5000, len(dates)),
}, index=dates)

class SmaCross(Strategy):
    def init(self):
        close = pd.Series(self.data.Close)
        self.sma1 = self.I(lambda: close.rolling(10).mean())
        self.sma2 = self.I(lambda: close.rolling(20).mean())
    def next(self):
        if crossover(self.sma1, self.sma2):
            self.buy()
        elif crossover(self.sma2, self.sma1):
            self.position.close()

bt = Backtest(df, SmaCross, cash=10_000, commission=0.002)
stats = bt.run()

fig, ax = plt.subplots(figsize=(4, 2))
ax.plot(df.index, df["Close"])
buf = io.BytesIO()
fig.savefig(buf, format="png")
png_b64 = base64.b64encode(buf.getvalue()).decode()

json.dumps({
    "return_pct": float(stats["Return [%]"]),
    "trades": int(stats["# Trades"]),
    "png_len": len(png_b64),
})
`

export default function SystemCheckPage() {
  const [steps, setSteps] = useState<Step[]>([
    { id: 'load', label: 'Load Pyodide runtime + pandas/numpy/matplotlib/backtesting.py', status: 'idle' },
    { id: 'run', label: 'Run smoke test (pandas + backtesting.py + matplotlib)', status: 'idle' },
  ])
  const [running, setRunning] = useState(false)

  const updateStep = (id: string, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const run = async () => {
    setRunning(true)
    setSteps((prev) => prev.map((s) => ({ ...s, status: 'idle', detail: undefined, ms: undefined })))

    updateStep('load', { status: 'running' })
    const t0 = performance.now()
    try {
      await pyodideClient.init()
      updateStep('load', { status: 'ok', ms: Math.round(performance.now() - t0) })
    } catch (e: any) {
      updateStep('load', { status: 'fail', detail: e.message ?? String(e) })
      setRunning(false)
      return
    }

    updateStep('run', { status: 'running' })
    const t1 = performance.now()
    const res = await pyodideClient.run(SMOKE_TEST_CODE)
    if (res.error) {
      updateStep('run', { status: 'fail', detail: res.error + (res.stdout ? `\n${res.stdout}` : '') })
    } else {
      updateStep('run', {
        status: 'ok',
        ms: Math.round(performance.now() - t1),
        detail: typeof res.result === 'string' ? res.result : JSON.stringify(res.result),
      })
    }
    setRunning(false)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-1 text-2xl">System check</h2>
      <p className="mb-6 text-sm text-[var(--text-dim)]">
        Validates the biggest open question in this project: that Pyodide can load <code>pandas</code>,{' '}
        <code>backtesting.py</code>, and <code>matplotlib</code> in this browser and actually run a backtest +
        render a chart. Loads ~tens of MB on first run — subsequent runs in this session are instant.
      </p>

      <button
        onClick={run}
        disabled={running}
        className="mb-6 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {running ? 'Running…' : 'Run system check'}
      </button>

      <div className="space-y-3">
        {steps.map((s) => (
          <div key={s.id} className="glass-panel rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{s.label}</span>
              <StatusBadge status={s.status} ms={s.ms} />
            </div>
            {s.detail && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/20 p-2 text-xs text-[var(--text-dim)]">
                {s.detail}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status, ms }: { status: StepStatus; ms?: number }) {
  const map: Record<StepStatus, { text: string; cls: string }> = {
    idle: { text: 'Idle', cls: 'text-[var(--text-dim)]' },
    running: { text: 'Running…', cls: 'text-[var(--accent-2)] pulse-glow' },
    ok: { text: ms ? `OK · ${ms}ms` : 'OK', cls: 'text-[var(--accent)]' },
    fail: { text: 'Failed', cls: 'text-[var(--danger)]' },
  }
  const s = map[status]
  return <span className={`text-xs font-mono ${s.cls}`}>{s.text}</span>
}
