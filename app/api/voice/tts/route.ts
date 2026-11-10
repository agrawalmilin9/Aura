import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { synthesizeWithTimbre } from '@/lib/ai/gnani/timbre-tts.ts'
import type { IndicLanguageCode } from '@/lib/ai/types.ts'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Content-Type must be application/json.',
        },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body.text !== 'string' || !body.text.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field "text" in JSON body.',
        },
        { status: 400 }
      )
    }

    const text = body.text.trim()
    const languageCode = (body.language_code || body.language) as IndicLanguageCode | undefined
    const voice = typeof body.voice === 'string' ? body.voice : undefined
    const speed = typeof body.speed === 'number' ? body.speed : undefined
    const model = body.model === 'timbre-v3.0' ? 'timbre-v3.0' : 'timbre-v2.5'
    const sampleRate = typeof body.sample_rate === 'number' ? body.sample_rate : 24000

    const result = await synthesizeWithTimbre({
      text,
      languageCode,
      voice,
      speed,
      model,
      sampleRate,
    })

    if (!result.success || !result.audioBuffer) {
      const status = result.error?.includes('GNANI_API_KEY')
        ? 500
        : result.error?.includes('401')
        ? 401
        : 502

      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to synthesize speech.',
        },
        { status }
      )
    }

    // Return raw audio bytes to browser
    return new NextResponse(result.audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType || 'audio/wav',
        'Content-Length': result.audioBuffer.length.toString(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: `Unexpected server error in TTS handler: ${err?.message || err}`,
      },
      { status: 500 }
    )
  }
}
