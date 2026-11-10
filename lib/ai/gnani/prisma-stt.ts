import { GNANI_CONFIG } from './config.ts'
import type { STTRequestOptions, STTResponse } from '../types.ts'

/**
 * Transcribes audio using Gnani Prisma STT (REST API).
 *
 * Endpoint: POST https://api.vachana.ai/stt/v3
 * Header: X-API-Key-ID: <GNANI_API_KEY>
 * Format: multipart/form-data
 */
export async function transcribeWithPrisma(
  options: STTRequestOptions
): Promise<STTResponse> {
  const apiKey = GNANI_CONFIG.apiKey

  if (!apiKey) {
    return {
      success: false,
      transcript: '',
      error: 'GNANI_API_KEY is not configured in the environment variables.',
    }
  }

  if (!options.audioBuffer) {
    return {
      success: false,
      transcript: '',
      error: 'No audio data provided for transcription.',
    }
  }

  const model = options.model || GNANI_CONFIG.models.sttDefault // 'prisma-v2.5'
  const languageCode = options.languageCode || GNANI_CONFIG.defaultLanguage // 'hi-IN'
  const format = options.format || 'transcribe'
  const itnNativeNumerals = options.itnNativeNumerals ? 'true' : 'false'
  const fileName = options.fileName || 'audio.wav'
  const mimeType = options.mimeType || 'audio/wav'

  try {
    const formData = new FormData()

    // Prepare audio as a Blob/File
    const audioBlob =
      options.audioBuffer instanceof Blob
        ? options.audioBuffer
        : new Blob([options.audioBuffer], { type: mimeType })

    formData.append('audio_file', audioBlob, fileName)
    formData.append('model', model)
    formData.append('language_code', languageCode)
    formData.append('format', format)
    formData.append('itn_native_numerals', itnNativeNumerals)

    const response = await fetch(`${GNANI_CONFIG.baseUrl}${GNANI_CONFIG.endpoints.stt}`, {
      method: 'POST',
      headers: {
        [GNANI_CONFIG.headerKey]: apiKey,
      },
      body: formData,
    })

    const rawText = await response.text()

    if (!response.ok) {
      let errorMessage = `Gnani Prisma API error (HTTP ${response.status})`
      try {
        const errorJson = JSON.parse(rawText)
        errorMessage = errorJson.message || errorJson.error?.message || errorMessage
      } catch {
        if (rawText) errorMessage += `: ${rawText}`
      }
      return {
        success: false,
        transcript: '',
        error: errorMessage,
      }
    }

    const data = JSON.parse(rawText)

    return {
      success: data.success !== false,
      transcript: data.transcript || '',
      detectedLanguageCode: data.detected_language_code || languageCode,
      model: data.model || model,
      requestId: data.request_id,
      processingTime: data.processing_time,
      endToEndLatency: data.end_to_end_latency,
    }
  } catch (err: any) {
    return {
      success: false,
      transcript: '',
      error: `Network or runtime error connecting to Gnani Prisma: ${err?.message || err}`,
    }
  }
}
