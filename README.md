<p align="center">
  <img src="public/cse-sage-logo.png" alt="CSE-Sage — Ask · Analyze · Invest" width="360">
</p>

# CSE Sage

AI-powered strategy backtesting and comprehensive stock analysis for the Colombo Stock
Exchange (CSE), built as a **fully static site with no backend**. There is no server,
no database, and no API keys of ours in the request path — every visitor brings their
own credentials, stored only in their browser.

See the full architecture writeup: `the-tradingview-has-a-effervescent-charm.md` plan
(feasibility plan this project was scaffolded from).

## How it works

- **Hosting**: static build, deployed to GitHub Pages via `.github/workflows/deploy.yml`.
- **ceyloncharts data**: calls [`ceyloncharts-mcp`](https://mcp.ceyloncharts.com)'s MCP
  server (`/mcp/`, JSON-RPC `tools/call`) directly from the browser, authenticated via
  **OAuth 2.1 + PKCE + Dynamic Client Registration** — the same flow Claude.ai or any
  other browser-based MCP client uses (see `src/lib/oauth.ts`). The visitor clicks
  "Connect your ceyloncharts account," logs in on ceyloncharts.com, and the token comes
  back to this site. No pasted API key, no site-specific allowlisting needed.
- **AI**: calls the Anthropic Messages API directly from the browser using the
  visitor's own API key (BYOK, via the `anthropic-dangerous-direct-browser-access` header).
- **Python execution**: AI-generated backtests and chart rendering run in-browser via
  [Pyodide](https://pyodide.org) (Python compiled to WebAssembly) inside a Web Worker —
  `pandas` + `backtesting.py` + `matplotlib`. No server-side sandbox needed or possible.
- **Storage**: everything (OAuth tokens, the pasted Anthropic key, cached price data)
  lives in `localStorage`/`IndexedDB`. Nothing is stored server-side because there is no
  server.

## Features

1. **Backtest** — describe a trading rule in plain English; an agent writes a
   `backtesting.py` script, runs it in-browser, retries on error/look-ahead-bias, and
   reports return/Sharpe/drawdown/trades plus a matplotlib equity curve.
2. **Analyze** — a single coordinator agent investigates a symbol using tools backed by
   `ceyloncharts-mcp` (income statement, balance sheet, cash flow, shareholding changes,
   announcements, technicals) plus a chart-generation tool, streaming its reasoning and
   tool calls live, then produces a downloadable two-page PDF report.

## Development

```bash
npm install
npm run dev
```

Open the app, go to **Settings**, connect your ceyloncharts account and paste your
Anthropic key, then try **System Check** first — it validates that Pyodide can load
`pandas` + `backtesting.py` + `matplotlib` in your browser before you rely on the other
two tabs.

```bash
npm run build    # production build to dist/
```

Live at https://ishara0925.github.io/cse-sage/, auto-deployed on every push to `main`.

## License

MIT — see [LICENSE](LICENSE). Not officially affiliated with CeylonCharts unless
deployed at the URL above; this is a third-party client of the public
`ceyloncharts-mcp` API.
