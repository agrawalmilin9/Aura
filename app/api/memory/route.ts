import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { getAllMemories, saveMemory } from '@/lib/memory/storage.ts'
import type { MemoryCategory } from '@/lib/memory/types.ts'

const VALID_CATEGORIES: MemoryCategory[] = [
  'preference',
  'family',
  'home',
  'reminder_rule',
  'other',
]

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const memories = await getAllMemories(auth.user.id)
    return NextResponse.json({ success: true, memories }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to retrieve personal memories: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid JSON request body.' }, { status: 400 })
    }

    const category: MemoryCategory = VALID_CATEGORIES.includes(body.category)
      ? body.category
      : 'preference'

    const result = await saveMemory({
      content: body.content,
      category,
      approvedByUser: body.approvedByUser === true,
    }, auth.user.id)

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    return NextResponse.json(
      { success: true, memory: result.memory, duplicate: Boolean(result.duplicate) },
      { status: result.duplicate ? 200 : 201 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to save personal memory: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
