import type { ReasoningRequestOptions, ReasoningResponse } from '../types.ts'

export const AURA_SYSTEM_PROMPT = `You are AURA, a warm, intelligent personal command centre AI designed for Indian users. 
You help users manage their documents (LifeFile), electricity and utility bills, health/vehicle insurance, product warranties, and daily tasks.
You understand Indian contexts, currencies (₹ INR), code-switching (Hinglish), and regional Indian languages.
When speaking in Hindi or Hinglish, speak naturally, politely, and respectfully.
For voice answers, keep responses direct, clear, and concise (1 to 3 sentences maximum) so that it sounds natural when spoken aloud via Text-to-Speech.`

const DEFAULT_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-2.5-pro',
]

export async function generateGeminiReasoning(
  options: ReasoningRequestOptions
): Promise<ReasoningResponse> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    return {
      success: false,
      reply: '',
      provider: 'gemini',
      error: 'GEMINI_API_KEY is not configured in server environment variables.',
    }
  }

  const modelEnv = process.env.GEMINI_MODEL
  const modelsToTry = modelEnv ? [modelEnv, ...DEFAULT_MODELS] : DEFAULT_MODELS

  const systemInstruction = options.systemPrompt || AURA_SYSTEM_PROMPT

  // Format messages for Gemini API
  const contents = options.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const body = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 600,
    },
  }

  let lastError = 'No models available'

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const raw = await response.text()

      if (!response.ok) {
        let errDesc = `HTTP ${response.status}`
        try {
          const parsed = JSON.parse(raw)
          errDesc = parsed.error?.message || errDesc
        } catch {}
        lastError = `Model ${model}: ${errDesc}`
        // Try next model on 404, 429, 503, deprecation, or high demand
        if (
          response.status === 404 ||
          response.status === 429 ||
          response.status === 503 ||
          errDesc.includes('no longer available') ||
          errDesc.includes('high demand')
        ) {
          continue
        }
        return {
          success: false,
          reply: '',
          provider: 'gemini',
          error: lastError,
        }
      }

      const data = JSON.parse(raw)
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''

      if (!text) {
        lastError = `Model ${model}: returned empty response content`
        continue
      }

      return {
        success: true,
        reply: text,
        provider: 'gemini',
      }
    } catch (err: any) {
      lastError = err?.message || String(err)
    }
  }

  return {
    success: false,
    reply: '',
    provider: 'gemini',
    error: `All Gemini model attempts failed: ${lastError}`,
  }
}
