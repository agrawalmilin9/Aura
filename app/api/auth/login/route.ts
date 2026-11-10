import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithPassword } from '@/lib/auth/storage.ts'
import { applySessionCookie, extractClientIp } from '@/lib/auth/session.ts'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request body.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const result = await authenticateWithPassword({
      email: typeof body.email === 'string' ? body.email : '',
      password: typeof body.password === 'string' ? body.password : '',
      ipAddress: extractClientIp(req),
    })

    if (!result.success || !result.user || !result.sessionToken) {
      return NextResponse.json(
        { success: false, error: result.error || 'Invalid credentials.' },
        { status: result.statusCode, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const res = NextResponse.json(
      { success: true, user: result.user },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
    applySessionCookie(res, result.sessionToken, req)
    return res
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to log in.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
