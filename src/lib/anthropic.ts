// Calls the Anthropic Messages API directly from the browser with the visitor's own
// key (BYOK). Requires the direct-browser-access opt-in header — verify this is still
// the current mechanism in Anthropic's docs before shipping; it can change between
// API versions.
const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
export const DEFAULT_MODEL = 'claude-sonnet-5'

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type Role = 'user' | 'assistant'

export interface Message {
  role: Role
  content: string | ContentBlock[]
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface SseEvent {
  type: string
  [k: string]: unknown
}

async function* streamSse(res: Response): AsyncGenerator<SseEvent> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const json = line.slice(5).trim()
      if (!json) continue
      try {
        yield JSON.parse(json) as SseEvent
      } catch {
        // ignore malformed chunk
      }
    }
  }
}

export interface AnthropicCallOpts {
  apiKey: string
  workspaceId?: string
  model?: string
  system?: string
  messages: Message[]
  tools?: ToolDef[]
  maxTokens?: number
}

/** One streaming call to Claude; yields raw text deltas and resolves the full assistant turn. */
export async function* streamOneTurn(
  opts: AnthropicCallOpts
): AsyncGenerator<{ type: 'text'; text: string }, { content: ContentBlock[]; stopReason: string | null }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': opts.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  }
  if (opts.workspaceId) headers['anthropic-workspace-id'] = opts.workspaceId

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      stream: true,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Anthropic API error ${res.status}: ${body}`)
  }

  const blocks: ContentBlock[] = []
  let stopReason: string | null = null

  for await (const evt of streamSse(res)) {
    if (evt.type === 'content_block_start') {
      const cb = (evt as any).content_block
      blocks[(evt as any).index] =
        cb.type === 'tool_use' ? { type: 'tool_use', id: cb.id, name: cb.name, input: {} } : { type: 'text', text: '' }
    } else if (evt.type === 'content_block_delta') {
      const delta = (evt as any).delta
      const idx = (evt as any).index
      const block = blocks[idx]
      if (delta.type === 'text_delta' && block?.type === 'text') {
        block.text += delta.text
        yield { type: 'text', text: delta.text }
      } else if (delta.type === 'input_json_delta' && block?.type === 'tool_use') {
        ;(block as any)._raw = ((block as any)._raw ?? '') + delta.partial_json
      }
    } else if (evt.type === 'message_delta') {
      stopReason = (evt as any).delta?.stop_reason ?? stopReason
    }
  }

  for (const block of blocks) {
    if (block?.type === 'tool_use' && (block as any)._raw !== undefined) {
      try {
        block.input = JSON.parse((block as any)._raw || '{}')
      } catch {
        block.input = {}
      }
      delete (block as any)._raw
    }
  }

  return { content: blocks.filter(Boolean), stopReason }
}

export type ToolHandler = (input: any) => Promise<string> | string

export interface AgentEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'turn_end' | 'done' | 'error'
  text?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: string
  error?: string
}

export interface RunAgentLoopOpts {
  apiKey: string
  workspaceId?: string
  model?: string
  system: string
  tools: ToolDef[]
  toolHandlers: Record<string, ToolHandler>
  initialMessages: Message[]
  maxTurns?: number
}

/** Runs a full multi-turn tool-use loop, entirely client-side, yielding live events for UI streaming. */
export async function* runAgentLoop(opts: RunAgentLoopOpts): AsyncGenerator<AgentEvent> {
  const messages: Message[] = [...opts.initialMessages]
  const maxTurns = opts.maxTurns ?? 12

  for (let turn = 0; turn < maxTurns; turn++) {
    let turnResult: { content: ContentBlock[]; stopReason: string | null }
    try {
      const gen = streamOneTurn({
        apiKey: opts.apiKey,
        workspaceId: opts.workspaceId,
        model: opts.model,
        system: opts.system,
        messages,
        tools: opts.tools,
      })
      while (true) {
        const { value, done } = await gen.next()
        if (done) {
          turnResult = value
          break
        }
        yield { type: 'text', text: value.text }
      }
    } catch (e: any) {
      yield { type: 'error', error: e.message ?? String(e) }
      return
    }

    // Claude occasionally emits a zero-length text block before a tool_use (valid as
    // output, but the API rejects it if echoed back as input on the next turn: "text
    // content blocks must be non-empty") — drop those before resubmitting.
    const nonEmptyContent = turnResult.content.filter((b) => !(b.type === 'text' && b.text.trim() === ''))
    messages.push({ role: 'assistant', content: nonEmptyContent })
    yield { type: 'turn_end' }

    const toolUses = turnResult.content.filter((b) => b.type === 'tool_use') as Extract<
      ContentBlock,
      { type: 'tool_use' }
    >[]

    if (toolUses.length === 0 || turnResult.stopReason !== 'tool_use') {
      yield { type: 'done' }
      return
    }

    const resultBlocks: ContentBlock[] = []
    for (const tu of toolUses) {
      yield { type: 'tool_call', toolName: tu.name, toolInput: tu.input }
      const handler = opts.toolHandlers[tu.name]
      let resultText: string
      let isError = false
      try {
        resultText = handler ? await handler(tu.input) : `Unknown tool: ${tu.name}`
        if (!handler) isError = true
      } catch (e: any) {
        resultText = `Error: ${e.message ?? String(e)}`
        isError = true
      }
      yield { type: 'tool_result', toolName: tu.name, toolResult: resultText }
      resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText, is_error: isError })
    }
    messages.push({ role: 'user', content: resultBlocks })
  }

  yield { type: 'done' }
}
