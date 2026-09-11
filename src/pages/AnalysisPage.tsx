import { useState } from 'react'
import type { Settings } from '../lib/settings'
import { runAnalysis, type ReportJson } from '../lib/analysisAgent'
import { generatePdfReport } from '../lib/pdfReport'

interface Props {
  settings: Settings
  ready: boolean
}

type Entry =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; name: string; input: unknown }
  | { kind: 'tool_result'; name: string; result: string }
  | { kind: 'chart'; png: string }
  | { kind: 'error'; message: string }

export default function AnalysisPage({ settings, ready }: Props) {
  const [symbol, setSymbol] = useState('JKH.N0000')
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [report, setReport] = useState<ReportJson | null>(null)
  const [chartPng, setChartPng] = useState<string | null>(null)

  const analyze = async () => {
    if (!ready || running) return
    setRunning(true)
    setEntries([])
    setReport(null)
    setChartPng(null)

    for await (const evt of runAnalysis({
      apiKey: settings.anthropicApiKey,
      workspaceId: settings.anthropicWorkspaceId || undefined,
      symbol,
    })) {
      setEntries((prev) => {
        if (evt.type === 'text') {
          const text = evt.text ?? ''
          const last = prev[prev.length - 1]
          if (last?.kind === 'text') {
            const copy = prev.slice(0, -1)
            return [...copy, { kind: 'text', text: last.text + text }]
          }
          return [...prev, { kind: 'text', text }]
        }
        if (evt.type === 'tool_call') return [...prev, { kind: 'tool_call', name: evt.toolName!, input: evt.toolInput }]
        if (evt.type === 'tool_result') return [...prev, { kind: 'tool_result', name: evt.toolName!, result: evt.toolResult! }]
        if (evt.type === 'chart') return [...prev, { kind: 'chart', png: evt.png }]
        if (evt.type === 'error') return [...prev, { kind: 'error', message: evt.error ?? 'Unknown error' }]
        return prev
      })
      if (evt.type === 'chart') setChartPng(evt.png)
      if (evt.type === 'report') setReport(evt.report)
    }
    setRunning(false)
  }

  const downloadPdf = async () => {
    if (!report) return
    const doc = await generatePdfReport({ symbol, report, chartPng: chartPng ?? undefined })
    doc.save(`${symbol}-cse-sage-report.pdf`)
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <div className="glass-panel space-y-4 rounded-2xl p-5">
        <div>
          <label className="mb-1 block text-sm font-medium">Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
        <button
          onClick={analyze}
          disabled={!ready || running}
          className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {running ? 'Analyzing…' : 'Run comprehensive analysis'}
        </button>
        <p className="text-xs text-[var(--text-dim)]">
          One coordinator agent pulls income statement, balance sheet, cash flow, shareholding changes,
          announcements, and technicals, then reasons over all of it live.
        </p>
        {report && (
          <button
            onClick={downloadPdf}
            className="w-full rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent)]"
          >
            Download 2-page PDF report
          </button>
        )}
      </div>

      <div className="glass-panel min-h-[300px] space-y-3 rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm uppercase tracking-wide text-[var(--text-dim)]">Live agent trace</h3>
          {entries.length > 0 && (
            <button
              onClick={() => navigator.clipboard.writeText(entries.map(serializeEntry).join('\n'))}
              className="text-xs underline text-[var(--text-dim)]"
            >
              Copy trace
            </button>
          )}
        </div>
        {entries.length === 0 && !running && (
          <p className="text-sm text-[var(--text-dim)]">Run an analysis to see the agent's reasoning here, live.</p>
        )}
        <div className="space-y-2">
          {entries.map((e, i) => <EntryView key={i} entry={e} />)}
        </div>
        {running && <span className="text-xs text-[var(--accent-2)] pulse-glow">● thinking…</span>}
      </div>
    </div>
  )
}

function serializeEntry(entry: Entry): string {
  if (entry.kind === 'text') return entry.text
  if (entry.kind === 'tool_call') return `→ calling ${entry.name}(${JSON.stringify(entry.input)})`
  if (entry.kind === 'tool_result') return `← ${entry.name} result:\n${entry.result}`
  if (entry.kind === 'chart') return '[chart image]'
  if (entry.kind === 'error') return `[error: ${entry.message}]`
  return ''
}

function EntryView({ entry }: { entry: Entry }) {
  if (entry.kind === 'text') {
    return <p className="whitespace-pre-wrap text-sm">{entry.text}</p>
  }
  if (entry.kind === 'tool_call') {
    return (
      <div className="rounded-lg border border-[var(--accent-2)]/30 bg-[var(--accent-2)]/5 px-3 py-2 text-xs font-mono text-[var(--accent-2)]">
        → calling {entry.name}({JSON.stringify(entry.input)})
      </div>
    )
  }
  if (entry.kind === 'tool_result') {
    return (
      <details className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
        <summary className="cursor-pointer font-mono text-[var(--text-dim)]">← {entry.name} result</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{entry.result.slice(0, 4000)}</pre>
      </details>
    )
  }
  if (entry.kind === 'chart') {
    return <img src={`data:image/png;base64,${entry.png}`} alt="Price chart" className="w-full rounded-lg" />
  }
  if (entry.kind === 'error') {
    return (
      <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
        {entry.message}
      </div>
    )
  }
  return null
}
