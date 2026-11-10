export const GNANI_CONFIG = {
  baseUrl: process.env.GNANI_BASE_URL || 'https://api.vachana.ai',
  get apiKey(): string {
    return process.env.GNANI_API_KEY || ''
  },
  headerKey: 'X-API-Key-ID',
  endpoints: {
    stt: '/stt/v3',
    tts: '/api/v1/tts/inference',
    ttsSse: '/api/v1/tts/sse',
  },
  models: {
    sttDefault: 'prisma-v2.5',
    sttMultilingual: 'prisma-v3.0',
    ttsDefault: 'timbre-v2.5',
    ttsExpressive: 'timbre-v3.0',
  },
  defaultLanguage: 'hi-IN' as const,
  defaultVoice: 'Nalini',
}
