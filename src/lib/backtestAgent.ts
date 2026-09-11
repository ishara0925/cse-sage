import { streamOneTurn, type Message } from './anthropic'
import { pyodideClient } from './pyodideClient'
import type { OhlcRow } from './ceyloncharts'

export interface BacktestResult {
  metrics: {
    return_pct: number
    cagr_pct?: number
    sharpe?: number
    max_drawdown_pct?: number
    win_rate_pct?: number
    trades: number
    avg_holding_days?: number
  }
  trades: Array<{ entry_date: string; exit_date: string; entry_price: number; exit_price: number; return_pct: number }>
  benchmark_return_pct?: number
  chart_png?: string // base64 PNG, equity curve vs buy-and-hold
  rule_restatement?: string
}

export type BacktestEvent =
  | { type: 'text'; text: string }
  | { type: 'attempt'; attempt: number }
  | { type: 'sanity_fail'; reason: string }
  | { type: 'error_detail'; message: string }
  | { type: 'done'; result: BacktestResult; script: string }
  | { type: 'failed'; error: string }

function ohlcToCsv(rows: OhlcRow[]): string {
  const header = 'Date,Open,High,Low,Close,Volume'
  const lines = rows.map((r) => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`)
  return [header, ...lines].join('\n')
}

const SYSTEM_PROMPT = `You write Python backtests for Colombo Stock Exchange (CSE) rule-based trading strategies.

Rules:
- First, restate the user's rule as precise, unambiguous entry/exit logic (resolve "high" vs "close", "trading days" vs "calendar days", etc) in 2-4 sentences — don't pad this out.
- Then write ONE self-contained Python code block (\`\`\`python ... \`\`\`). Keep it as short as correctness allows: minimal comments, no section-banner comments, no docstrings, no restating the rule again in comments — every line of output costs response budget. It must:
  - Read OHLC data with: df = pd.read_csv("/data/ohlc.csv", index_col="Date", parse_dates=True)
  - Use backtesting.py's Backtest/Strategy classes (from backtesting import Backtest, Strategy) — do not hand-roll the trade loop.
  - Compute indicators with a plain top-level function and pass it (plus its array args) to self.I(), e.g.:
    def sma(close, n): return pd.Series(close).rolling(int(n)).mean().values
    # inside Strategy.init(): self.sma20 = self.I(sma, self.data.Close, 20)
    Never pass a lambda that ignores its arguments, and never pass a pre-computed Series/array directly as the sole argument to self.I() without a function wrapping it — self.I() calls the function itself to (re)compute and cache the indicator.
  - Never use future bars for a signal on the current bar (no look-ahead bias).
  - Also compute a buy-and-hold benchmark return over the same data for comparison.
  - Render one matplotlib chart (equity curve vs. buy-and-hold, AGG backend, figsize (8,4)), save to a base64 PNG string.
  - As the VERY LAST line, print exactly one JSON object via print(json.dumps({...})) with this shape (no other prints):
    {"metrics": {"return_pct": float, "cagr_pct": float, "sharpe": float, "max_drawdown_pct": float, "win_rate_pct": float, "trades": int, "avg_holding_days": float}, "trades": [{"entry_date": str, "exit_date": str, "entry_price": float, "exit_price": float, "return_pct": float}], "benchmark_return_pct": float, "chart_png": "<base64>"}
  - Use only pandas, numpy, backtesting, matplotlib, json, base64, io — no network access (none is available anyway).
- If told the previous attempt errored, produced invalid results, or was cut off for length, fix only the specific issue named and resend the complete script — don't restart the explanation/restatement, and don't add more comments than the previous attempt had.`

function extractCode(text: string): string | null {
  const m = text.match(/```python\s*([\s\S]*?)```/)
  return m ? m[1] : null
}

function extractRestatement(text: string): string {
  const idx = text.indexOf('```')
  return (idx === -1 ? text : text.slice(0, idx)).trim()
}

function sanityCheck(result: BacktestResult): string | null {
  if (!result.metrics || typeof result.metrics.return_pct !== 'number') return 'Missing or malformed metrics object.'
  if (result.metrics.trades === 0) return 'Strategy produced zero trades — check the entry condition can actually trigger.'
  if (Number.isNaN(result.metrics.sharpe)) return 'Sharpe ratio is NaN.'
  for (const t of result.trades ?? []) {
    if (new Date(t.exit_date) < new Date(t.entry_date)) return `Trade has exit_date before entry_date (${t.entry_date} -> ${t.exit_date}) — look-ahead bug.`
  }
  return null
}

export async function* runBacktest(opts: {
  apiKey: string
  workspaceId?: string
  rule: string
  symbol: string
  ohlc: OhlcRow[]
  maxRetries?: number
}): AsyncGenerator<BacktestEvent> {
  const maxRetries = opts.maxRetries ?? 4
  const csv = ohlcToCsv(opts.ohlc)
  const messages: Message[] = [
    {
      role: 'user',
      content: `Symbol: ${opts.symbol}\nRule: "${opts.rule}"\n\nThe CSV at /data/ohlc.csv has columns Date,Open,High,Low,Close,Volume covering ${opts.ohlc[0]?.date} to ${opts.ohlc[opts.ohlc.length - 1]?.date}.`,
    },
  ]

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    yield { type: 'attempt', attempt }

    let fullText = ''
    let stopReason: string | null = null
    const gen = streamOneTurn({
      apiKey: opts.apiKey,
      workspaceId: opts.workspaceId,
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: 8192,
    })
    while (true) {
      const { value, done } = await gen.next()
      if (done) {
        stopReason = value.stopReason
        break
      }
      fullText += value.text
      yield { type: 'text', text: value.text }
    }

    const truncated = stopReason === 'max_tokens'
    const code = extractCode(fullText)
    if (!code) {
      const reason = truncated
        ? 'The response was cut off (hit the length limit) before a complete ```python code block was produced.'
        : 'No ```python code block was found in the response.'
      yield { type: 'error_detail', message: reason }
      messages.push({ role: 'assistant', content: fullText })
      messages.push({
        role: 'user',
        content: `${reason} Resend the complete script in one \`\`\`python code block, more concisely${truncated ? ' — it was too long last time' : ''}.`,
      })
      continue
    }
    messages.push({ role: 'assistant', content: fullText })

    const runRes = await pyodideClient.run(code, { '/data/ohlc.csv': csv })

    if (runRes.error) {
      yield { type: 'error_detail', message: runRes.error }
      messages.push({
        role: 'user',
        content: `The script raised an error:\n${runRes.error}\n\nStdout so far:\n${runRes.stdout}\n\nFix it and resend the full script.`,
      })
      continue
    }

    let parsed: BacktestResult | null = null
    try {
      const lastLine = runRes.stdout.trim().split('\n').filter(Boolean).pop() ?? ''
      parsed = JSON.parse(lastLine)
    } catch {
      parsed = null
    }
    if (!parsed) {
      const reason = `The script's final printed line was not valid JSON. Stdout was:\n${runRes.stdout.slice(-2000)}`
      yield { type: 'error_detail', message: reason }
      messages.push({
        role: 'user',
        content: `${reason}\n\nFix it so the last line is exactly one JSON object as specified.`,
      })
      continue
    }

    const failReason = sanityCheck(parsed)
    if (failReason) {
      yield { type: 'sanity_fail', reason: failReason }
      messages.push({
        role: 'user',
        content: `The result failed a sanity check: ${failReason}\nFix the script and resend it.`,
      })
      continue
    }

    parsed.rule_restatement = extractRestatement(fullText)
    yield { type: 'done', result: parsed, script: code }
    return
  }

  yield { type: 'failed', error: `Could not produce a valid backtest after ${maxRetries} attempts.` }
}

export { ohlcToCsv }
