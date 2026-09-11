import { runAgentLoop, type AgentEvent, type ToolDef, type Message } from './anthropic'
import { pyodideClient } from './pyodideClient'
import { getStatementCsv, getAnnouncementsCsv, getTechnicals, getFullOhlcHistory } from './ceyloncharts'

const TOOLS: ToolDef[] = [
  {
    name: 'get_income_statement',
    description: 'Full income statement line items, by quarter, for a CSE symbol.',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'get_balance_sheet',
    description: 'Full balance sheet line items, by quarter, for a CSE symbol.',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'get_cash_flow',
    description: 'Full cash flow statement line items, by quarter, for a CSE symbol.',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'get_shareholding_changes',
    description: 'Top-20 shareholder list and quarter-over-quarter changes for a CSE symbol. May not be available yet.',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'get_announcements',
    description: 'Recent CSE company announcements/disclosures for a symbol.',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'get_technicals',
    description: 'Precomputed technicals (moving averages, 52-week range, RS rating) plus recent daily price history.',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
  {
    name: 'generate_price_chart',
    description:
      'Renders a price chart with illustrative buy/sell zone markers, based on the technicals already fetched via get_technicals. Call get_technicals for this symbol first.',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
  },
]

const SYSTEM_PROMPT = `You are a CSE (Colombo Stock Exchange) equity research assistant. Given a stock symbol, investigate it using the tools available (income statement, balance sheet, cash flow, shareholding changes, announcements, technicals, and a price chart generator). You decide which tools to call and in what order — you don't need to call all of them if a domain isn't relevant, but for a "comprehensive analysis" request you should cover financials, shareholders, announcements, and technicals unless a tool comes back empty or unavailable.

Think out loud in plain text between tool calls so a reader can follow your reasoning live. Call generate_price_chart at least once if you called get_technicals.

When you are done, write a final narrative analysis, then end your final message with one fenced \`\`\`json block (last thing in the message) with EXACTLY this shape for the PDF report:
{
  "verdict": "one paragraph overall takeaway",
  "technical_summary": "2-3 bullet points as a single string, \\n separated",
  "income_summary": "2-3 bullet points",
  "balance_summary": "2-3 bullet points",
  "cashflow_summary": "2-3 bullet points",
  "shareholding_summary": "2-3 bullet points, or note if unavailable",
  "announcements_summary": "2-3 bullet points"
}
This is hypothetical/AI-generated analysis, not investment advice — do not phrase the verdict as a directive to buy/sell.`

export interface ReportJson {
  verdict: string
  technical_summary: string
  income_summary: string
  balance_summary: string
  cashflow_summary: string
  shareholding_summary: string
  announcements_summary: string
}

export type AnalysisEvent = AgentEvent | { type: 'chart'; symbol: string; png: string } | { type: 'report'; report: ReportJson }

function summarizeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const CHART_CODE = `
import pandas as pd, matplotlib
matplotlib.use('AGG')
import matplotlib.pyplot as plt
import io, base64, json

df = pd.read_csv("/data/chart_ohlc.csv", index_col="Date", parse_dates=True)
sma50 = df["Close"].rolling(50).mean()
sma200 = df["Close"].rolling(200).mean()
week52_high = df["Close"].rolling(252, min_periods=20).max()

buy_mask = (df["Close"] >= week52_high) & (df["Close"] > sma50)
sell_mask = (sma50 < sma200) & (sma50.shift(1) >= sma200.shift(1))

fig, ax = plt.subplots(figsize=(8, 4))
ax.plot(df.index, df["Close"], label="Close", color="#22e2c9", linewidth=1.2)
ax.plot(df.index, sma50, label="SMA50", color="#9d7bff", linewidth=0.8)
ax.plot(df.index, sma200, label="SMA200", color="#888", linewidth=0.8)
ax.scatter(df.index[buy_mask], df["Close"][buy_mask], color="#22e2c9", marker="^", s=40, label="Buy zone", zorder=5)
ax.scatter(df.index[sell_mask], df["Close"][sell_mask], color="#ff5d78", marker="v", s=40, label="Sell zone", zorder=5)
ax.legend(fontsize=7)
ax.set_facecolor("#0b0d14")
fig.patch.set_facecolor("#0b0d14")
ax.tick_params(colors="#a2a8bd", labelsize=7)
for spine in ax.spines.values():
    spine.set_color("#20232f")

buf = io.BytesIO()
fig.savefig(buf, format="png", dpi=140, bbox_inches="tight")
png_b64 = base64.b64encode(buf.getvalue()).decode()
print(json.dumps({"png": png_b64}))
`

export async function* runAnalysis(opts: {
  apiKey: string
  workspaceId?: string
  symbol: string
}): AsyncGenerator<AnalysisEvent> {
  const symbol = opts.symbol
  const lastOhlcBySymbol: Record<string, Awaited<ReturnType<typeof getFullOhlcHistory>>> = {}
  const chartEvents: Array<{ symbol: string; png: string }> = []

  const toolHandlers = {
    get_income_statement: async () => {
      try {
        return await getStatementCsv(symbol, 'income')
      } catch (e) {
        return summarizeError(e)
      }
    },
    get_balance_sheet: async () => {
      try {
        return await getStatementCsv(symbol, 'balance')
      } catch (e) {
        return summarizeError(e)
      }
    },
    get_cash_flow: async () => {
      try {
        return await getStatementCsv(symbol, 'cashflow')
      } catch (e) {
        return summarizeError(e)
      }
    },
    get_shareholding_changes: async () => {
      return 'Not available yet — ceyloncharts-mcp does not expose a shareholdings tool. Note this plainly in your summary rather than guessing shareholder data.'
    },
    get_announcements: async () => {
      try {
        return await getAnnouncementsCsv(symbol)
      } catch (e) {
        return summarizeError(e)
      }
    },
    get_technicals: async () => {
      try {
        const [tech, ohlc] = await Promise.all([
          getTechnicals(symbol, { limit: 5 }),
          getFullOhlcHistory(symbol, { maxPages: 2 }),
        ])
        lastOhlcBySymbol[symbol] = ohlc
        return JSON.stringify({ technicals: tech, recent_days: ohlc.length })
      } catch (e) {
        return summarizeError(e)
      }
    },
    generate_price_chart: async () => {
      const ohlc = lastOhlcBySymbol[symbol]
      if (!ohlc || ohlc.length < 30) return 'Call get_technicals first to fetch price history.'
      const csv = ['Date,Open,High,Low,Close,Volume', ...ohlc.map((r) => `${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`)].join('\n')
      const res = await pyodideClient.run(CHART_CODE, { '/data/chart_ohlc.csv': csv })
      if (res.error) return `Chart generation failed: ${res.error}`
      try {
        const parsed = JSON.parse(res.stdout.trim().split('\n').pop() ?? '{}')
        chartEvents.push({ symbol, png: parsed.png })
        return 'Chart rendered successfully and will be shown to the user.'
      } catch {
        return 'Chart generation produced no parseable output.'
      }
    },
  }

  const initialMessages: Message[] = [
    { role: 'user', content: `Give me a comprehensive analysis of ${symbol}.` },
  ]

  let fullFinalText = ''

  for await (const evt of runAgentLoop({
    apiKey: opts.apiKey,
    workspaceId: opts.workspaceId,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    toolHandlers,
    initialMessages,
    maxTurns: 12,
  })) {
    if (evt.type === 'text') fullFinalText += evt.text
    yield evt
    while (chartEvents.length > 0) {
      const chart = chartEvents.shift()!
      yield { type: 'chart', symbol: chart.symbol, png: chart.png }
    }
  }

  const jsonMatch = fullFinalText.match(/```json\s*([\s\S]*?)```/)
  if (jsonMatch) {
    try {
      const report = JSON.parse(jsonMatch[1]) as ReportJson
      yield { type: 'report', report }
    } catch {
      // model didn't produce valid JSON — PDF export will just be unavailable this run
    }
  }
}
