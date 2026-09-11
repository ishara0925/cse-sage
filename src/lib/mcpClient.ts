// Calls ceyloncharts-mcp's MCP server directly from the browser — plain JSON-RPC
// over a single POST per call (this server has no session/SSE transport, just
// request/response — see ceyloncharts-mcp/workers/mcp-server), authenticated
// with the OAuth access token from oauth.ts.
import { getAccessToken, startLogin } from './oauth'

const MCP_ENDPOINT = 'https://mcp.ceyloncharts.com/mcp/'

export class NotConnectedError extends Error {
  constructor() {
    super('Not connected to ceyloncharts — connect your account in Settings first.')
  }
}

export class McpToolError extends Error {}

let nextId = 1

/** Calls one MCP tool and returns its raw text content (CSV, or JSON for a few tools). */
export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const token = await getAccessToken()
  if (!token) throw new NotConnectedError()

  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new McpToolError(`MCP call failed (${res.status}): ${body}`)
  }

  const payload = await res.json()
  if (payload.error) {
    throw new McpToolError(payload.error.message ?? JSON.stringify(payload.error))
  }

  const content = payload.result?.content?.[0]
  if (!content || content.type !== 'text') {
    throw new McpToolError('Unexpected tool response shape.')
  }
  if (payload.result?.isError) {
    throw new McpToolError(content.text)
  }
  return content.text as string
}

export { startLogin }
