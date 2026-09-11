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

## Required upstream changes (in the `ceyloncharts-mcp` repo, not here)

1. **Done, not yet deployed**: `workers/mcp-server/src/index.ts` had zero CORS handling
   at all (no `OPTIONS` support, no `Access-Control-Allow-Origin`), so no browser-based
   client — this site or any other — could call it directly. Added an open (`origin: '*'`)
   CORS layer matching `oauth-server`'s existing policy. This is a generic fix (any
   browser MCP client benefits), not a per-site allowlist entry. **Needs `wrangler deploy`
   before OAuth login will actually work end-to-end.**
2. **Not done, deferred**: there's no `get_shareholdings`-style MCP tool yet (the
   underlying data exists in D1 under `financial_statements` / `statement_type=
   'shareholdings'`, extracted by `cse-data-admin`, just not exposed as a tool). Until
   that's added, the shareholding-changes tool in the Analyze feature returns "not
   available yet" without making a network call.

## Development

```bash
npm install
npm run dev
```

Open the app, go to **Settings**, connect your ceyloncharts account and paste your
Anthropic key, then try **System Check** first — it validates that Pyodide can load
`pandas` + `backtesting.py` + `matplotlib` in your browser (the biggest open technical
risk in this project) before you rely on the other two tabs. Note: the ceyloncharts
connection won't fully succeed until the CORS fix above is deployed.

```bash
npm run build    # production build to dist/
```

## Status / open items

- Not yet pushed to GitHub / deployed — see the plan doc for the phased roadmap.
- Anthropic's direct-browser-access header/CORS behavior should be reconfirmed against
  current docs before relying on it in production.
- MVP backtesting is single-symbol only (rate-limit reasons — see the plan).
