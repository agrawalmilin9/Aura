import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { getReasoningReply } from '@/lib/ai/reasoning-orchestrator.ts'
import type { ReasoningMessage } from '@/lib/ai/types.ts'

export const runtime = 'nodejs'
export const maxDuration = 60

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
    if (!body) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid JSON body.',
        },
        { status: 400 }
      )
    }

    // Build message list
    const messages: ReasoningMessage[] = Array.isArray(body.messages)
      ? body.messages
      : []

    if (typeof body.message === 'string' && body.message.trim()) {
      messages.push({
        role: 'user',
        content: body.message.trim(),
      })
    }

    if (messages.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No messages provided in request.',
        },
        { status: 400 }
      )
    }

    const result = await getReasoningReply({
      messages,
      languageCode: body.language_code,
      userProfileOverride: {
        name: auth.user.name,
        email: auth.user.email,
        phone: auth.user.phone,
      },
      activeFormDocId: typeof body.activeFormDocId === 'string' ? body.activeFormDocId : undefined,
      userId: auth.user.id,
    })

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Failed to generate reasoning response.',
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        reply: result.reply,
        provider: result.provider,
        sources: result.sources || [],
        actionExecuted: result.actionExecuted || false,
        isAmbiguous: result.isAmbiguous || false,
        noMatchFound: result.noMatchFound || false,
        actionDetails: result.actionDetails || null,
        memoryProposal: result.memoryProposal || null,
        formGuideDoc: result.formGuideDoc || null,
      },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: `Unexpected server error in chat handler: ${err?.message || err}`,
      },
      { status: 500 }
    )
  }
}
