import { transcribeWithPrisma } from '../lib/ai/gnani/prisma-stt.ts'
import { GNANI_CONFIG } from '../lib/ai/gnani/config.ts'

function createValidWav(durationSeconds = 1, sampleRate = 16000): Buffer {
  const numChannels = 1
  const bytesPerSample = 2
  const dataSize = durationSeconds * sampleRate * numChannels * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28)
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer
}

async function runTests() {
  console.log('=============================================')
  console.log('🧪 Gnani Prisma v2.5 STT Verification Suite')
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

  // Test 1: Missing API Key check
  const originalKey = process.env.GNANI_API_KEY
  delete process.env.GNANI_API_KEY

  const dummyAudio = Buffer.from('RIFF....WAVEfmt ....data....', 'utf-8')
  const res1 = await transcribeWithPrisma({ audioBuffer: dummyAudio })
  assert(
    'Fails gracefully when GNANI_API_KEY is missing',
    res1.success === false && res1.error?.includes('GNANI_API_KEY is not configured') === true,
    res1.error
  )

  // Test 2: Missing Audio Buffer check
  process.env.GNANI_API_KEY = 'test_key_dummy_123'
  const res2 = await transcribeWithPrisma({ audioBuffer: (null as unknown) as Buffer })
  assert(
    'Fails gracefully when audio buffer is empty',
    res2.success === false && res2.error?.includes('No audio data provided') === true,
    res2.error
  )

  // Test 3: Verify Request Structure (Header, Endpoint & FormData)
  const originalFetch = globalThis.fetch
  let capturedUrl = ''
  let capturedHeaders: Record<string, string> = {}
  let capturedBody: any = null

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = url.toString()
    capturedHeaders = (init?.headers as Record<string, string>) || {}
    capturedBody = (init?.body as FormData) || null

    // Simulate Gnani API success response
    return new Response(
      JSON.stringify({
        success: true,
        request_id: 'test-req-999',
        transcript: 'नमस्ते, मेरा बिजली बिल क्या है?',
        model: 'prisma-v2.5',
        detected_language_code: 'hi-IN',
        processing_time: 0.38,
        end_to_end_latency: 0.45,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }) as typeof fetch

  const res3 = await transcribeWithPrisma({
    audioBuffer: dummyAudio,
    fileName: 'sample.wav',
    languageCode: 'hi-IN',
    model: 'prisma-v2.5',
    format: 'transcribe',
  })

  assert(
    'Targets correct Gnani endpoint (https://api.vachana.ai/stt/v3)',
    capturedUrl === 'https://api.vachana.ai/stt/v3',
    capturedUrl
  )

  assert(
    'Sends X-API-Key-ID authentication header',
    capturedHeaders['X-API-Key-ID'] === 'test_key_dummy_123',
    JSON.stringify(capturedHeaders)
  )

  assert(
    'Builds multipart/form-data with model=prisma-v2.5',
    capturedBody?.get('model') === 'prisma-v2.5',
    `model: ${capturedBody?.get('model')}`
  )

  assert(
    'Builds multipart/form-data with language_code=hi-IN',
    capturedBody?.get('language_code') === 'hi-IN',
    `language_code: ${capturedBody?.get('language_code')}`
  )

  assert(
    'Successfully parses Gnani transcript response',
    res3.success === true &&
      res3.transcript === 'नमस्ते, मेरा बिजली बिल क्या है?' &&
      res3.detectedLanguageCode === 'hi-IN' &&
      res3.requestId === 'test-req-999',
    JSON.stringify(res3)
  )

  // Test 4: Error handling on 401 Unauthorized / Invalid Key
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Invalid API Key provided',
        status_code: 401,
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }) as typeof fetch

  const res4 = await transcribeWithPrisma({
    audioBuffer: dummyAudio,
  })

  assert(
    'Properly propagates 401 Invalid Key error message',
    res4.success === false && res4.error?.includes('Invalid API Key') === true,
    res4.error
  )

  // Restore fetch and original env
  globalThis.fetch = originalFetch
  if (originalKey) {
    process.env.GNANI_API_KEY = originalKey
  } else {
    delete process.env.GNANI_API_KEY
  }

  // Test 5: Live API call test if real key is configured
  if (originalKey && originalKey !== 'your_gnani_api_key_here') {
    console.log('\n📡 Real GNANI_API_KEY detected in environment. Running live connectivity test...')
    process.env.GNANI_API_KEY = originalKey
    const validWav = createValidWav(1, 16000)
    const liveRes = await transcribeWithPrisma({
      audioBuffer: validWav,
      fileName: 'test.wav',
      languageCode: 'hi-IN',
      model: 'prisma-v2.5',
    })
    console.log('Live response received:', JSON.stringify({
      success: liveRes.success,
      detectedLanguageCode: liveRes.detectedLanguageCode,
      model: liveRes.model,
      requestId: liveRes.requestId,
      error: liveRes.error,
    }))
    assert(
      'Live Gnani endpoint responded',
      liveRes.success === true || liveRes.requestId !== undefined,
      liveRes.error
    )
  } else {
    console.log('\n💡 Note: Live API test skipped because GNANI_API_KEY is not yet populated in .env.local')
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
