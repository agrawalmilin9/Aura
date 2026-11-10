import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getMemoryById,
  updateMemory,
  deleteMemory,
  validateMemoryId,
} from '@/lib/memory/storage.ts'
import type { MemoryCategory } from '@/lib/memory/types.ts'

interface RouteContext {
  params: Promise<{ id: string }>
}

const VALID_CATEGORIES: MemoryCategory[] = [
  'preference',
  'family',
  'home',
  'reminder_rule',
  'other',
]

export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateMemoryId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid memory ID format.' }, { status: 400 })
    }
    const memory = await getMemoryById(id, auth.user.id)
    if (!memory) {
      return NextResponse.json({ success: false, error: 'Memory not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, memory }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to retrieve memory: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateMemoryId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid memory ID format.' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid JSON request body.' }, { status: 400 })
    }

    const category: MemoryCategory | undefined = VALID_CATEGORIES.includes(body.category)
      ? body.category
      : undefined

    const result = await updateMemory(id, {
      content: typeof body.content === 'string' ? body.content : undefined,
      category,
    }, auth.user.id)

    if (!result.success) {
      const status = result.error === 'Memory not found.' ? 404 : 400
      return NextResponse.json({ success: false, error: result.error }, { status })
    }

    return NextResponse.json({ success: true, memory: result.memory }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to update memory: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateMemoryId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid memory ID format.' }, { status: 400 })
    }
    const deleted = await deleteMemory(id, auth.user.id)
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Memory not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, deletedId: id }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to delete memory: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
