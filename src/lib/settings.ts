// Anthropic key lives only in this browser's localStorage, sent only to Anthropic's
// API. ceyloncharts access is handled separately via OAuth — see oauth.ts.
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'cse-sage.settings.v1'

export interface Settings {
  anthropicApiKey: string
  anthropicWorkspaceId: string
}

const EMPTY: Settings = {
  anthropicApiKey: '',
  anthropicWorkspaceId: '',
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    return { ...EMPTY, ...JSON.parse(raw) }
  } catch {
    return EMPTY
  }
}

function save(settings: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function clearSettings() {
  localStorage.removeItem(STORAGE_KEY)
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    save(settings)
  }, [settings])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const clear = useCallback(() => {
    clearSettings()
    setSettings(EMPTY)
  }, [])

  return { settings, update, clear, hasAnthropicKey: Boolean(settings.anthropicApiKey) }
}
