import type { Settings } from '../lib/settings'
import type { useOauth } from '../lib/useOauth'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClear: () => void
  oauth: ReturnType<typeof useOauth>
}

export default function SettingsPage({ settings, onChange, onClear, oauth }: Props) {
  return (
    <div className="mx-auto max-w-xl">
      <h2 className="mb-1 text-2xl">Your access</h2>
      <p className="mb-6 text-sm text-[var(--text-dim)]">
        This site has no backend and no server-side database. Nothing you connect or enter here is ever sent to
        us — only directly to ceyloncharts.com and Anthropic's API from this browser.
      </p>

      <div className="glass-panel space-y-5 rounded-2xl p-6">
        <div>
          <h3 className="mb-3 text-sm uppercase tracking-wide text-[var(--text-dim)]">ceyloncharts</h3>
          {oauth.connected ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-bg)] px-3 py-2">
              <span className="text-sm text-[var(--accent)]">● Connected</span>
              <button onClick={oauth.disconnect} className="text-xs underline text-[var(--text-dim)]">
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={oauth.connect}
              className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black"
            >
              Connect your ceyloncharts account
            </button>
          )}
          <p className="mt-2 text-xs text-[var(--text-dim)]">
            Uses OAuth, the same way Claude.ai or ChatGPT connect to ceyloncharts-mcp — you log in on
            ceyloncharts.com and grant this site access; no password or API key is ever pasted here. Access tokens
            are short-lived and stored only in this browser.
          </p>
        </div>

        <div className="h-px bg-[var(--border)]" />

        <div>
          <h3 className="mb-3 text-sm uppercase tracking-wide text-[var(--text-dim)]">Anthropic</h3>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[var(--text-h)]">API Key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={settings.anthropicApiKey}
              onChange={(e) => onChange({ anthropicApiKey: e.target.value })}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)]"
              placeholder="sk-ant-..."
            />
          </label>
          <p className="mt-2 text-xs text-[var(--text-dim)]">
            Get one from console.anthropic.com. This site calls the Claude API directly from your browser using
            this key — your own usage, your own cost. Stored only in this browser's localStorage.
          </p>

          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium text-[var(--text-h)]">Workspace ID (optional)</span>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={settings.anthropicWorkspaceId}
              onChange={(e) => onChange({ anthropicWorkspaceId: e.target.value })}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)]"
              placeholder="wrkspc-..."
            />
          </label>
          <p className="mt-2 text-xs text-[var(--text-dim)]">
            Only needed if you get "This API key is not scoped to a workspace" — some Console accounts with
            multiple workspaces issue keys that require this. Find it at console.anthropic.com under your
            workspace settings, then it's sent as an <code>anthropic-workspace-id</code> header.
          </p>
        </div>
      </div>

      <button
        onClick={onClear}
        className="mt-4 rounded-lg border border-[var(--danger)]/40 px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10"
      >
        Clear Anthropic key
      </button>
    </div>
  )
}
