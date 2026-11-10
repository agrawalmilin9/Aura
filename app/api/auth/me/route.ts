import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { updateUserProfile } from '@/lib/auth/storage.ts'

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  return NextResponse.json(
    { success: true, user: auth.user },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request body.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (typeof body.name === 'string' && body.name.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: 'Name must be at least 2 characters.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const updated = await updateUserProfile(auth.user.id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      phone: body.phone !== undefined ? (typeof body.phone === 'string' ? body.phone : null) : undefined,
      photoDataUrl:
        body.photoDataUrl !== undefined
          ? typeof body.photoDataUrl === 'string'
            ? body.photoDataUrl
            : null
          : undefined,
    })

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Account not found.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    return NextResponse.json(
      { success: true, user: updated },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to update profile.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
