import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../lib/settings'
import { getFullOhlcHistory, type OhlcRow } from '../lib/ceyloncharts'
import { runBacktest, type BacktestResult } from '../lib/backtestAgent'

interface Props {
  settings: Settings
  ready: boolean
}

type Phase = 'idle' | 'fetching' | 'running' | 'done' | 'error'

export default function BacktesterPage({ settings, ready }: Props) {
  const [symbol, setSymbol] = useState('JKH.N0000')
  const [rule, setRule] = useState('Buy whenever the stock makes a new 52-week high. Sell after 20 trading days.')
  const [phase, setPhase] = useState<Phase>('idle')
  const [log, setLog] = useState('')
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [script, setScript] = useState('')
  const [error, setError] = useState('')
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])
  const [showScript, setShowScript] = useState(false)

  const run = async () => {
    if (!ready) return
    setPhase('fetching')
    setLog('')
    setResult(null)
    setError('')

    let ohlc: OhlcRow[]
    try {
      ohlc = await getFullOhlcHistory(symbol)
    } catch (e: any) {
      setError(e.message ?? String(e))
      setPhase('error')
      return
    }

    if (ohlc.length === 0) {
      setError(`No OHLC data returned for "${symbol}" — check the symbol.`)
      setPhase('error')
      return
    }

    setPhase('running')
    for await (const evt of runBacktest({
      apiKey: settings.anthropicApiKey,
      workspaceId: settings.anthropicWorkspaceId || undefined,
      rule,
      symbol,
      ohlc,
    })) {
      if (evt.type === 'text') setLog((l) => l + evt.text)
      else if (evt.type === 'attempt' && evt.attempt > 1) setLog((l) => l + `\n\n--- retry attempt ${evt.attempt} ---\n\n`)
      else if (evt.type === 'sanity_fail') setLog((l) => l + `\n\n[sanity check failed: ${evt.reason}]\n\n`)
      else if (evt.type === 'error_detail') setLog((l) => l + `\n\n[error: ${evt.message}]\n\n`)
      else if (evt.type === 'done') {
        setResult(evt.result)
        setScript(evt.script)
        setPhase('done')
      } else if (evt.type === 'failed') {
        setError(evt.error)
        setPhase('error')
      }
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
      <div className="glass-panel space-y-4 rounded-2xl p-5">
        <div>
          <label className="mb-1 block text-sm font-medium">Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Rule (plain English)</label>
          <textarea
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
        <button
          onClick={run}
          disabled={!ready || phase === 'fetching' || phase === 'running'}
          className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {phase === 'fetching' ? 'Fetching price history…' : phase === 'running' ? 'Backtesting…' : 'Run backtest'}
        </button>
        <p className="text-xs text-[var(--text-dim)]">
          MVP scope: one symbol at a time. Runs Claude + a Python backtest entirely in this browser tab.
        </p>
      </div>

      <div className="space-y-4">
        {(phase === 'running' || log) && (
          <div className="glass-panel rounded-2xl p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm uppercase tracking-wide text-[var(--text-dim)]">Agent reasoning</h3>
              {log && (
                <button
                  onClick={() => navigator.clipboard.writeText(log)}
                  className="text-xs underline text-[var(--text-dim)]"
                >
                  Copy log
                </button>
              )}
            </div>
            <pre
              ref={logRef}
              className="max-h-96 overflow-auto whitespace-pre-wrap text-sm text-[var(--text)]"
            >
              {log || '…'}
            </pre>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-4 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        {result && (
          <div className="glass-panel space-y-4 rounded-2xl p-5">
            <h3 className="text-sm uppercase tracking-wide text-[var(--text-dim)]">Result</h3>
            {result.rule_restatement && (
              <p className="rounded-lg bg-black/10 p-3 text-sm text-[var(--text)]">{result.rule_restatement}</p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Return" value={`${result.metrics.return_pct?.toFixed(1)}%`} />
              <Metric label="vs. Buy&Hold" value={`${result.benchmark_return_pct?.toFixed(1)}%`} />
              <Metric label="Sharpe" value={result.metrics.sharpe?.toFixed(2) ?? '—'} />
              <Metric label="Max DD" value={`${result.metrics.max_drawdown_pct?.toFixed(1)}%`} />
              <Metric label="Win rate" value={`${result.metrics.win_rate_pct?.toFixed(0)}%`} />
              <Metric label="Trades" value={String(result.metrics.trades)} />
              <Metric label="Avg hold" value={`${result.metrics.avg_holding_days?.toFixed(0) ?? '—'}d`} />
              <Metric label="CAGR" value={`${result.metrics.cagr_pct?.toFixed(1) ?? '—'}%`} />
            </div>
            {result.chart_png && (
              <img src={`data:image/png;base64,${result.chart_png}`} alt="Equity curve" className="w-full rounded-lg" />
            )}
            {result.trades?.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-lg border border-[var(--border)]">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[var(--bg-elevated)] text-[var(--text-dim)]">
                    <tr>
                      <th className="px-2 py-1">Entry</th>
                      <th className="px-2 py-1">Exit</th>
                      <th className="px-2 py-1">Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} className="border-t border-[var(--border)]">
                        <td className="px-2 py-1">{t.entry_date}</td>
                        <td className="px-2 py-1">{t.exit_date}</td>
                        <td className={`px-2 py-1 ${t.return_pct >= 0 ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>
                          {t.return_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button onClick={() => setShowScript((s) => !s)} className="text-xs underline text-[var(--text-dim)]">
              {showScript ? 'Hide' : 'View'} generated script
            </button>
            {showScript && (
              <pre className="max-h-72 overflow-auto rounded-lg bg-black/20 p-3 text-xs">{script}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/10 p-3">
      <div className="text-xs text-[var(--text-dim)]">{label}</div>
      <div className="font-mono text-lg text-[var(--text-h)]">{value}</div>
    </div>
  )
}
