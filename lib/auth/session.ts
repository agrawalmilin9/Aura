import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { SESSION_DURATION_MS, toPublicUser, verifySessionToken } from './storage.ts'
import type { PublicUser } from './types.ts'

export const SESSION_COOKIE_NAME = 'aura_session'

export function extractClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return req.headers.get('x-real-ip') || 'local'
}

export function shouldUseSecureCookie(req?: NextRequest): boolean {
  if (req) {
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
    if (forwardedProto === 'https' || req.nextUrl.protocol === 'https:') {
      return true
    }
    const host = req.nextUrl.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') {
      return false
    }
  }
  return process.env.NODE_ENV === 'production'
}

export function applySessionCookie(res: NextResponse, token: string, req?: NextRequest): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(req),
    path: '/',
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  })
}

export function clearSessionCookie(res: NextResponse, req?: NextRequest): void {
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(req),
    path: '/',
    maxAge: 0,
  })
}

export async function getAuthenticatedUserFromRequest(req: NextRequest): Promise<PublicUser | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  return verifySessionToken(token)
}

export async function getAuthenticatedUserFromCookies(): Promise<PublicUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
    return verifySessionToken(token)
  } catch {
    return null
  }
}

export async function requireApiAuth(
  req: NextRequest
): Promise<{ user: PublicUser; errorResponse?: never } | { user?: never; errorResponse: NextResponse }> {
  const user = await getAuthenticatedUserFromRequest(req)
  if (!user) {
    return {
      errorResponse: NextResponse.json(
        {
          success: false,
          error: 'Authentication required. Please log in to continue.',
        },
        { status: 401 }
      ),
    }
  }
  return { user }
}

export { toPublicUser }
