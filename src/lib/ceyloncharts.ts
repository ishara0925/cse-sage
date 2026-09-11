// Thin client over ceyloncharts-mcp's MCP tools (see mcpClient.ts), authenticated
// via OAuth rather than a pasted API key — no per-call credentials needed here.
import { callTool } from './mcpClient'
import { parseToolResponse } from './csv'

export interface OhlcRow {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function toOhlcRows(rows: Record<string, string>[]): OhlcRow[] {
  return rows.map((r) => ({
    date: r.date,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }))
}

export async function getOhlc(
  symbol: string,
  opts: { from?: string; to?: string; limit?: number; offset?: number } = {}
): Promise<OhlcRow[]> {
  const text = await callTool('get_ohlc_data', {
    symbol,
    from: opts.from,
    to: opts.to,
    limit: opts.limit ?? 500,
    offset: opts.offset ?? 0,
  })
  return toOhlcRows(parseToolResponse(text))
}

/** Pages through get_ohlc_data (500-row cap per call) to assemble full history in range. */
export async function getFullOhlcHistory(
  symbol: string,
  opts: { from?: string; to?: string; maxPages?: number } = {}
): Promise<OhlcRow[]> {
  const maxPages = opts.maxPages ?? 40 // hard stop: 40 * 500 = 20,000 trading days
  const rows: OhlcRow[] = []
  let offset = 0
  for (let page = 0; page < maxPages; page++) {
    const page_rows = await getOhlc(symbol, { from: opts.from, to: opts.to, limit: 500, offset })
    if (page_rows.length === 0) break
    rows.unshift(...page_rows)
    if (page_rows.length < 500) break
    offset += 500
  }
  return rows
}

export type StatementType = 'income' | 'balance' | 'cashflow'

/** Full line-item detail for one financial statement, as CSV text (Claude reads this directly). */
export async function getStatementCsv(symbol: string, statement: StatementType): Promise<string> {
  return callTool('get_financial_statement', { symbol, statement })
}

export async function getAnnouncementsCsv(
  symbol: string,
  opts: { from?: string; to?: string } = {}
): Promise<string> {
  return callTool('get_announcements', { symbol, from: opts.from, to: opts.to })
}

export interface TechnicalsRow {
  date: string
  close: number
  sma10?: number
  ema21?: number
  ema50?: number
  ema200?: number
  high_52w?: number
  low_52w?: number
  is_52w_high?: boolean
  is_52w_low?: boolean
  rs_rating?: number
  [k: string]: unknown
}

export async function getTechnicals(symbol: string, opts: { limit?: number } = {}): Promise<TechnicalsRow[]> {
  const text = await callTool('get_technicals', { symbol, limit: opts.limit ?? 5 })
  return parseToolResponse(text).map((r) => ({
    ...r,
    date: r.date,
    close: Number(r.close),
    sma10: r.sma10 ? Number(r.sma10) : undefined,
    ema21: r.ema21 ? Number(r.ema21) : undefined,
    ema50: r.ema50 ? Number(r.ema50) : undefined,
    ema200: r.ema200 ? Number(r.ema200) : undefined,
    high_52w: r.high_52w ? Number(r.high_52w) : undefined,
    low_52w: r.low_52w ? Number(r.low_52w) : undefined,
    is_52w_high: r.is_52w_high === '1' || r.is_52w_high === 'true',
    is_52w_low: r.is_52w_low === '1' || r.is_52w_low === 'true',
    rs_rating: r.rs_rating ? Number(r.rs_rating) : undefined,
  }))
}

export async function getSymbolsCsv(query?: string): Promise<string> {
  return callTool('get_symbols', { query })
}
