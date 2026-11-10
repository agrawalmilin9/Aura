import { NextRequest, NextResponse } from 'next/server'
import { revokeSessionToken } from '@/lib/auth/storage.ts'
import { clearSessionCookie, SESSION_COOKIE_NAME } from '@/lib/auth/session.ts'

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
    await revokeSessionToken(token)

    const res = NextResponse.json(
      { success: true, message: 'Logged out successfully.' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
    clearSessionCookie(res, req)
    return res
  } catch {
    const res = NextResponse.json(
      { success: true, message: 'Session cleared.' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
    clearSessionCookie(res, req)
    return res
  }
}
