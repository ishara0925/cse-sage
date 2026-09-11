import { useState } from 'react'
import { useSettings } from './lib/settings'
import { useOauth } from './lib/useOauth'
import SettingsPage from './pages/SettingsPage'
import SystemCheckPage from './pages/SystemCheckPage'
import BacktesterPage from './pages/BacktesterPage'
import AnalysisPage from './pages/AnalysisPage'

type Tab = 'analyze' | 'backtest' | 'system' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'system', label: 'System Check' },
  { id: 'settings', label: 'Settings' },
]

export default function App() {
  const { settings, update, clear, hasAnthropicKey } = useSettings()
  const oauth = useOauth()
  const ready = oauth.connected && hasAnthropicKey
  const [tab, setTab] = useState<Tab>(ready ? 'analyze' : 'settings')

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border)] px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)] pulse-glow" />
            <h1 className="text-lg font-semibold tracking-tight">
              CSE <span style={{ color: 'var(--accent)' }}>Sage</span>
            </h1>
          </div>
          <nav className="flex gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  tab === t.id
                    ? 'bg-[var(--accent)] text-black font-medium'
                    : 'text-[var(--text-dim)] hover:text-[var(--text-h)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {oauth.checkedRedirect && !ready && tab !== 'settings' && (
          <div className="mb-6 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-bg)] px-4 py-3 text-sm">
            Connect your ceyloncharts account and add your Anthropic key in{' '}
            <button className="underline" onClick={() => setTab('settings')}>
              Settings
            </button>{' '}
            to use this.
          </div>
        )}
        {tab === 'settings' && (
          <SettingsPage settings={settings} onChange={update} onClear={clear} oauth={oauth} />
        )}
        {tab === 'system' && <SystemCheckPage />}
        {tab === 'backtest' && <BacktesterPage settings={settings} ready={ready} />}
        {tab === 'analyze' && <AnalysisPage settings={settings} ready={ready} />}
      </main>

      <footer className="border-t border-[var(--border)] px-6 py-4 text-center text-xs text-[var(--text-dim)]">
        Hypothetical / AI-generated analysis, not investment advice. Your Anthropic key stays in this browser;
        ceyloncharts access uses OAuth, not a stored password.
      </footer>
    </div>
  )
}
