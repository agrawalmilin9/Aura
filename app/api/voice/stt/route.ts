import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { transcribeWithPrisma } from '@/lib/ai/gnani/prisma-stt.ts'
import type { IndicLanguageCode, STTFormat } from '@/lib/ai/types.ts'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Content-Type must be multipart/form-data with an audio file.',
        },
        { status: 400 }
      )
    }

    const formData = await req.formData()
    const audioFile = (formData.get('audio_file') || formData.get('file')) as File | null

    if (!audioFile) {
      return NextResponse.json(
        {
          success: false,
          error: 'No audio file provided in request. Expected form field "audio_file" or "file".',
        },
        { status: 400 }
      )
    }

    const languageCode = (formData.get('language_code') as IndicLanguageCode) || 'hi-IN'
    const model = (formData.get('model') as 'prisma-v2.5' | 'prisma-v3.0') || 'prisma-v2.5'
    const format = (formData.get('format') as STTFormat) || 'transcribe'
    const itnNativeNumerals = formData.get('itn_native_numerals') === 'true'

    const fileName = audioFile.name || 'recording.wav'
    const mimeType = audioFile.type || 'audio/wav'

    // Supported formats by Gnani Prisma
    const isSupportedFormat =
      fileName.endsWith('.wav') ||
      fileName.endsWith('.mp3') ||
      fileName.endsWith('.ogg') ||
      fileName.endsWith('.flac') ||
      fileName.endsWith('.aac') ||
      fileName.endsWith('.m4a') ||
      mimeType.includes('wav') ||
      mimeType.includes('mpeg') ||
      mimeType.includes('ogg') ||
      mimeType.includes('flac') ||
      mimeType.includes('aac') ||
      mimeType.includes('mp4')

    if (!isSupportedFormat && (fileName.endsWith('.webm') || mimeType.includes('webm'))) {
      return NextResponse.json(
        {
          success: false,
          transcript: '',
          error:
            'Unsupported audio format (WebM). Gnani Prisma requires WAV, MP3, OGG, FLAC, AAC, or M4A. Audio will be converted to WAV automatically.',
        },
        { status: 400 }
      )
    }

    const arrayBuffer = await audioFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const result = await transcribeWithPrisma({
      audioBuffer: buffer,
      fileName,
      mimeType,
      languageCode,
      model,
      format,
      itnNativeNumerals,
    })

    if (!result.success) {
      const status = result.error?.includes('GNANI_API_KEY')
        ? 500
        : result.error?.includes('401')
        ? 401
        : 502
      return NextResponse.json(result, { status })
    }

    return NextResponse.json(result, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        transcript: '',
        error: `Unexpected server error in STT handler: ${err?.message || err}`,
      },
      { status: 500 }
    )
  }
}
