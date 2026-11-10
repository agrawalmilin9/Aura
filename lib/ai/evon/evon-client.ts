import type { ReasoningRequestOptions, ReasoningResponse } from '../types.ts'
import { AURA_SYSTEM_PROMPT } from '../gemini/reasoning.ts'

/**
 * Client for self-hosted Evon v3.3 (gnani/gnani-evon-v3.3-30B-A3B) via vLLM or SGLang.
 * Exposes an OpenAI-compatible /v1/chat/completions endpoint.
 */
export async function generateEvonReasoning(
  options: ReasoningRequestOptions
): Promise<ReasoningResponse> {
  const baseUrl = process.env.EVON_BASE_URL || 'http://localhost:8000/v1'
  const apiKey = process.env.EVON_API_KEY || 'dummy'
  const model = process.env.EVON_MODEL || 'gnani/gnani-evon-v3.3-30B-A3B'

  const systemInstruction = options.systemPrompt || AURA_SYSTEM_PROMPT

  const messages = [
    { role: 'system', content: systemInstruction },
    ...options.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ]

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.6,
        max_tokens: options.maxTokens ?? 300,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return {
        success: false,
        reply: '',
        provider: 'evon',
        error: `Evon endpoint returned HTTP ${response.status}: ${text}`,
      }
    }

    const data = await response.json()
    const reply = data.choices?.[0]?.message?.content?.trim() || ''

    return {
      success: true,
      reply,
      provider: 'evon',
    }
  } catch (err: any) {
    return {
      success: false,
      reply: '',
      provider: 'evon',
      error: `Failed to connect to Evon instance at ${baseUrl}: ${err?.message || err}`,
    }
  }
}
