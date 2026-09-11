// ceyloncharts-mcp tool responses are CSV, sometimes preceded by a natural-language
// resolution note and a blank line (see ceyloncharts-mcp-docs/docs/mcp-tools.md).
// This strips that note and parses the trailing CSV block, RFC4180-ish (quoted
// fields, embedded commas/quotes).

export class AmbiguousSymbolError extends Error {
  candidates: Array<{ symbol: string; name: string }>
  constructor(candidates: Array<{ symbol: string; name: string }>) {
    super(`Ambiguous symbol — candidates: ${candidates.map((c) => c.symbol).join(', ')}`)
    this.candidates = candidates
  }
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

export function parseToolResponse(text: string): Record<string, string>[] {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed)
      if (json.candidates) throw new AmbiguousSymbolError(json.candidates)
    } catch (e) {
      if (e instanceof AmbiguousSymbolError) throw e
      // not JSON after all — fall through to CSV parsing
    }
  }

  const blocks = trimmed.split(/\n\s*\n/)
  const csvBlock = blocks[blocks.length - 1]
  const lines = csvBlock.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return []

  const headers = splitCsvLine(lines[0]).map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })
}
