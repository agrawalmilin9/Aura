import { GNANI_CONFIG } from './config.ts'
import type { TTSRequestOptions, TTSResponse } from '../types.ts'

/**
 * Synthesizes speech from text using Gnani Timbre TTS (REST API).
 *
 * Endpoint: POST https://api.vachana.ai/api/v1/tts/inference
 * Headers:
 *   - Content-Type: application/json
 *   - X-API-Key-ID: <GNANI_API_KEY>
 * Response:
 *   - HTTP 200: Raw binary audio (audio/wav)
 *   - Error: JSON error envelope
 */
export async function synthesizeWithTimbre(
  options: TTSRequestOptions
): Promise<TTSResponse> {
  const apiKey = GNANI_CONFIG.apiKey

  if (!apiKey) {
    return {
      success: false,
      error: 'GNANI_API_KEY is not configured in server environment variables.',
    }
  }

  const trimmedText = options.text?.trim()
  if (!trimmedText) {
    return {
      success: false,
      error: 'No text provided for speech synthesis.',
    }
  }

  const model = options.model || GNANI_CONFIG.models.ttsDefault // 'timbre-v2.5'
  const voice = options.voice || GNANI_CONFIG.defaultVoice // 'Nalini'
  const language = options.languageCode || GNANI_CONFIG.defaultLanguage // 'hi-IN'

  // Clamp speed to valid Gnani range: 0.85 to 1.15
  let speed = typeof options.speed === 'number' ? options.speed : 1.0
  if (speed < 0.85) speed = 0.85
  if (speed > 1.15) speed = 1.15

  const sampleRate = options.sampleRate || 24000

  const payload = {
    text: trimmedText,
    model,
    voice,
    language,
    speed,
    audio_config: {
      sample_rate: sampleRate,
      num_channels: 1,
      sample_width: 2,
      encoding: 'linear_pcm',
      container: 'wav',
    },
  }

  try {
    const response = await fetch(
      `${GNANI_CONFIG.baseUrl}${GNANI_CONFIG.endpoints.tts}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [GNANI_CONFIG.headerKey]: apiKey,
        },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const rawText = await response.text()
      let errorMessage = `Gnani Timbre TTS API error (HTTP ${response.status})`
      try {
        const errorJson = JSON.parse(rawText)
        errorMessage = errorJson.message || errorJson.error?.message || errorMessage
      } catch {
        if (rawText) errorMessage += `: ${rawText}`
      }
      return {
        success: false,
        error: errorMessage,
      }
    }

    // Binary audio stream returned on 200 OK
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = Buffer.from(arrayBuffer)
    const contentType = response.headers.get('content-type') || 'audio/wav'

    return {
      success: true,
      audioBuffer,
      contentType,
    }
  } catch (err: any) {
    return {
      success: false,
      error: `Network or runtime error connecting to Gnani Timbre: ${err?.message || err}`,
    }
  }
}
