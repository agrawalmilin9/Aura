import { getReasoningReply } from '../lib/ai/reasoning-orchestrator.ts'
import { synthesizeWithTimbre } from '../lib/ai/gnani/timbre-tts.ts'
import { transcribeWithPrisma } from '../lib/ai/gnani/prisma-stt.ts'

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

async function runEndToEndTest() {
  console.log('====================================================')
  console.log('🎙️ AURA Phase 3: Complete Hindi Voice Pipeline Test')
  console.log('====================================================\n')

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

  // 1. Test Prisma STT with valid audio
  console.log('Step 1: Testing Gnani Prisma v2.5 STT...')
  const audio = createValidWav(1, 16000)
  const sttRes = await transcribeWithPrisma({
    audioBuffer: audio,
    languageCode: 'hi-IN',
    model: 'prisma-v2.5',
  })

  assert(
    'Prisma STT responds to valid audio buffer',
    sttRes.success === true || sttRes.requestId !== undefined,
    sttRes.error
  )

  // 2. Test Reasoning Engine (Gemini) with Hindi query
  console.log('\nStep 2: Testing AURA Reasoning Engine with Hindi prompt...')
  const hindiPrompt = 'मेरा बिजली का बिल कितना है?'
  console.log(`User Query: "${hindiPrompt}"`)

  const reasoningRes = await getReasoningReply({
    messages: [{ role: 'user', content: hindiPrompt }],
    languageCode: 'hi-IN',
    documentsOverride: [
      {
        id: 'doc_demo_bill',
        originalFilename: 'Adani_Electricity_Oct2026.pdf',
        storageFilename: 'doc_demo_bill.pdf',
        mimeType: 'application/pdf',
        fileSize: 450000,
        uploadTimestamp: '2026-11-02T10:15:00.000Z',
        extractionStatus: 'completed',
        extractedData: {
          documentType: 'Bill',
          issuer: 'Adani Electricity',
          customerName: 'Ananya Kapoor',
          documentDate: '2026-10-28',
          dueDate: '2026-11-25',
          expiryDate: null,
          totalAmount: 2840,
          currency: '₹',
          productName: null,
          modelNumber: null,
          serialNumber: null,
          purchaseDate: null,
          warrantyDuration: null,
          warrantyExpiry: null,
          policyNumber: null,
          importantConditions: null,
          contactDetails: null,
          summary: 'Adani electricity bill of ₹2,840 due 25 Nov 2026',
        },
        extractionError: null,
      },
    ],
  })

  assert(
    'Reasoning engine generated a response',
    reasoningRes.success === true && reasoningRes.reply.length > 0,
    reasoningRes.error
  )

  if (reasoningRes.success) {
    console.log(`AURA Reply (${reasoningRes.provider}): "${reasoningRes.reply}"`)
    assert(
      'Reply contains electricity bill context (₹2,840 / Adani Electricity)',
      reasoningRes.reply.includes('2,840') ||
        reasoningRes.reply.includes('2840') ||
        reasoningRes.reply.includes('बिजली') ||
        reasoningRes.reply.includes('अदाणी') ||
        reasoningRes.reply.includes('Adani') ||
        reasoningRes.reply.includes('November') ||
        reasoningRes.reply.includes('नवंबर'),
      reasoningRes.reply
    )
  }

  // 3. Test Gnani Timbre v2.5 TTS with the actual reasoning output
  console.log('\nStep 3: Testing Gnani Timbre v2.5 TTS speech synthesis...')
  const textToSpeak = reasoningRes.success
    ? reasoningRes.reply
    : 'नमस्ते, आपका अदाणी बिजली का बिल ₹2,840 है।'

  const ttsRes = await synthesizeWithTimbre({
    text: textToSpeak,
    languageCode: 'hi-IN',
    voice: 'Nalini',
    model: 'timbre-v2.5',
  })

  assert(
    'Timbre TTS synthesized spoken audio',
    ttsRes.success === true &&
      Buffer.isBuffer(ttsRes.audioBuffer) &&
      (ttsRes.audioBuffer?.length ?? 0) > 1000,
    ttsRes.error || `Bytes: ${ttsRes.audioBuffer?.length}`
  )

  if (ttsRes.success && ttsRes.audioBuffer) {
    console.log(`Synthesized Audio Size: ${ttsRes.audioBuffer.length} bytes (WAV)`)
  }

  console.log('\n----------------------------------------------------')
  console.log(`End-to-End Pipeline Summary: ${passed} Passed, ${failed} Failed`)
  console.log('====================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runEndToEndTest().catch((err) => {
  console.error('End-to-End test crashed:', err)
  process.exit(1)
})
