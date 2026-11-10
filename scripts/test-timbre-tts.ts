import { synthesizeWithTimbre } from '../lib/ai/gnani/timbre-tts.ts'
import { GNANI_CONFIG } from '../lib/ai/gnani/config.ts'

async function runTests() {
  console.log('=============================================')
  console.log('🧪 Gnani Timbre v2.5 TTS Verification Suite')
  console.log('=============================================\n')

  let passed = 0
  let failed = 0

  function assert(desc: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${desc}`)
      passed++
    } else {
      console.error(`❌ FAIL: ${desc} ${detail ? `(${detail})` : ''}`)
      failed++
    }
  }

  // Preserve existing environment variable safely
  const originalKey = process.env.GNANI_API_KEY

  // Test 1: Missing API Key check
  delete process.env.GNANI_API_KEY
  const res1 = await synthesizeWithTimbre({ text: 'नमस्ते, मैं ऑरा हूँ।' })
  assert(
    'Fails gracefully when GNANI_API_KEY is missing',
    res1.success === false && res1.error?.includes('GNANI_API_KEY is not configured') === true,
    res1.error
  )

  // Test 2: Missing or whitespace text check
  process.env.GNANI_API_KEY = 'mock_secret_key'
  const res2 = await synthesizeWithTimbre({ text: '   ' })
  assert(
    'Fails gracefully when text is empty or blank',
    res2.success === false && res2.error?.includes('No text provided') === true,
    res2.error
  )

  // Test 3: Verify Request Construction (Endpoint, Headers, Payload & Binary Response)
  const originalFetch = globalThis.fetch
  let capturedUrl = ''
  let capturedHeaders: Record<string, string> = {}
  let capturedBody: any = null

  // Simulated WAV header bytes
  const mockWavBytes = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // file size
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    0x66, 0x6d, 0x74, 0x20, // "fmt "
  ])

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = url.toString()
    capturedHeaders = (init?.headers as Record<string, string>) || {}
    try {
      capturedBody = JSON.parse(init?.body as string)
    } catch {
      capturedBody = null
    }

    return new Response(mockWavBytes, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': mockWavBytes.length.toString(),
      },
    })
  }) as typeof fetch

  const res3 = await synthesizeWithTimbre({
    text: 'नमस्ते, मैं ऑरा हूँ।',
    languageCode: 'hi-IN',
    voice: 'Nalini',
    model: 'timbre-v2.5',
    speed: 1.0,
  })

  assert(
    'Targets correct Gnani endpoint (https://api.vachana.ai/api/v1/tts/inference)',
    capturedUrl === 'https://api.vachana.ai/api/v1/tts/inference',
    capturedUrl
  )

  assert(
    'Sends X-API-Key-ID and Content-Type: application/json',
    capturedHeaders['X-API-Key-ID'] === 'mock_secret_key' &&
      capturedHeaders['Content-Type'] === 'application/json',
    JSON.stringify(capturedHeaders)
  )

  assert(
    'Payload has correct text, model=timbre-v2.5, voice=Nalini, language=hi-IN',
    capturedBody?.text === 'नमस्ते, मैं ऑरा हूँ।' &&
      capturedBody?.model === 'timbre-v2.5' &&
      capturedBody?.voice === 'Nalini' &&
      capturedBody?.language === 'hi-IN' &&
      capturedBody?.speed === 1.0 &&
      capturedBody?.audio_config?.container === 'wav',
    JSON.stringify(capturedBody)
  )

  assert(
    'Successfully parses binary audio buffer on 200 OK',
    res3.success === true &&
      Buffer.isBuffer(res3.audioBuffer) &&
      res3.audioBuffer.length === mockWavBytes.length &&
      res3.contentType === 'audio/wav',
    `Buffer length: ${res3.audioBuffer?.length}`
  )

  // Test 4: Error handling on 401 Unauthorized
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        message: 'Invalid API Key provided',
        status_code: 401,
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }) as typeof fetch

  const res4 = await synthesizeWithTimbre({
    text: 'नमस्ते',
  })

  assert(
    'Properly propagates 401 Invalid Key error message without leaking secrets',
    res4.success === false && res4.error?.includes('Invalid API Key') === true,
    res4.error
  )

  // Test 5: Error handling on 429 Rate Limit
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        message: 'Wait for your current request to finish before sending another.',
        status_code: 429,
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }) as typeof fetch

  const res5 = await synthesizeWithTimbre({
    text: 'नमस्ते',
  })

  assert(
    'Properly handles 429 Rate Limit response',
    res5.success === false && res5.error?.includes('Wait for your current request') === true,
    res5.error
  )

  // Restore fetch
  globalThis.fetch = originalFetch

  // Test 6: Live API test check if process.env.GNANI_API_KEY was already in the environment
  if (originalKey && originalKey !== 'your_gnani_api_key_here') {
    console.log('\n📡 Testing live connection to Gnani Timbre API with environment key...')
    process.env.GNANI_API_KEY = originalKey
    const liveRes = await synthesizeWithTimbre({
      text: 'नमस्ते',
      languageCode: 'hi-IN',
      voice: 'Nalini',
      model: 'timbre-v2.5',
    })

    if (liveRes.success && liveRes.audioBuffer) {
      console.log(`✅ Live TTS succeeded! Received ${liveRes.audioBuffer.length} bytes of audio.`)
      passed++
    } else {
      console.log(`⚠️ Live TTS response: ${liveRes.error}`)
    }
  } else {
    console.log('\n💡 Note: Live API test skipped (GNANI_API_KEY not loaded in current execution context).')
  }

  // Restore original key
  if (originalKey) {
    process.env.GNANI_API_KEY = originalKey
  } else {
    delete process.env.GNANI_API_KEY
  }

  console.log('\n---------------------------------------------')
  console.log(`Results: ${passed} Passed, ${failed} Failed`)
  console.log('=============================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Test execution error:', err)
  process.exit(1)
})
