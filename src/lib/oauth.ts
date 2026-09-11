// OAuth 2.1 + PKCE + Dynamic Client Registration against ceyloncharts-mcp's
// auth server — the same flow any browser-based MCP client (Claude.ai, etc.)
// uses, so this site never needs to be specially allowlisted. See
// ceyloncharts-mcp-docs/docs/authentication.md and oauth-server/src/index.ts.
const ISSUER = 'https://oauth.ceyloncharts.com'
const RESOURCE = 'https://mcp.ceyloncharts.com/mcp'
const SCOPES = 'mcp:read mcp:analyze'

const CLIENT_ID_KEY = 'cse-sage.oauth.client_id'
const TOKENS_KEY = 'cse-sage.oauth.tokens'
const PKCE_KEY = 'cse-sage.oauth.pkce' // sessionStorage: survives the redirect round-trip only

interface Tokens {
  access_token: string
  refresh_token: string
  expires_at: number // epoch ms
}

function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`
}

function randomString(len = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return base64url(bytes)
}

function base64url(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveTokens(t: Tokens) {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t))
}

export function isConnected(): boolean {
  return loadTokens() !== null
}

export function disconnect() {
  localStorage.removeItem(TOKENS_KEY)
}

async function getOrRegisterClientId(): Promise<string> {
  const existing = localStorage.getItem(CLIENT_ID_KEY)
  if (existing) return existing

  const res = await fetch(`${ISSUER}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'CSE Sage',
      redirect_uris: [redirectUri()],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (!res.ok) throw new Error(`Client registration failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  localStorage.setItem(CLIENT_ID_KEY, data.client_id)
  return data.client_id as string
}

/** Redirects the browser to the ceyloncharts login/consent page. Call from a click handler. */
export async function startLogin(): Promise<void> {
  const clientId = await getOrRegisterClientId()
  const verifier = randomString(64)
  const state = randomString(24)
  const challenge = await pkceChallenge(verifier)

  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }))

  const url = new URL(`${ISSUER}/authorize`)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('resource', RESOURCE)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)

  window.location.href = url.toString()
}

/** Call once on app load. If the URL carries an OAuth redirect, completes the token exchange. */
export async function handleRedirectCallback(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')

  if (!code && !error) return

  const cleanUrl = window.location.origin + window.location.pathname
  window.history.replaceState({}, '', cleanUrl)

  if (error) {
    console.error('OAuth error:', error, params.get('error_description'))
    return
  }

  const raw = sessionStorage.getItem(PKCE_KEY)
  sessionStorage.removeItem(PKCE_KEY)
  if (!raw) return
  const { verifier, state: savedState } = JSON.parse(raw)
  if (state !== savedState) {
    console.error('OAuth state mismatch')
    return
  }

  const clientId = localStorage.getItem(CLIENT_ID_KEY)
  if (!clientId || !code) return

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  })

  const res = await fetch(`${ISSUER}/token`, { method: 'POST', body })
  if (!res.ok) {
    console.error('Token exchange failed:', await res.text())
    return
  }
  const data = await res.json()
  saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 15_000, // 15s safety margin
  })
}

async function refresh(tokens: Tokens): Promise<Tokens | null> {
  const clientId = localStorage.getItem(CLIENT_ID_KEY)
  if (!clientId) return null
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  })
  const res = await fetch(`${ISSUER}/token`, { method: 'POST', body })
  if (!res.ok) return null
  const data = await res.json()
  const next: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 15_000,
  }
  saveTokens(next)
  return next
}

/** Access tokens are short-lived (900s) — this transparently refreshes when needed. */
export async function getAccessToken(): Promise<string | null> {
  let tokens = loadTokens()
  if (!tokens) return null
  if (Date.now() >= tokens.expires_at) {
    tokens = await refresh(tokens)
    if (!tokens) {
      disconnect()
      return null
    }
  }
  return tokens.access_token
}
