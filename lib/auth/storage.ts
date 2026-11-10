import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../storage/atomic-json.ts'
import { resolveScopedDocumentsDir, validateUserId } from '../storage/user-scope.ts'
import { getStorageBackendMode, isVercelDeployment } from '../storage/backend.ts'
import { getSupabaseAdmin, unwrapSupabaseResult } from '../storage/supabase-client.ts'
import type { PublicUser, SessionRecord, StoredUser } from './types.ts'

const AUTH_DIR = path.resolve(process.cwd(), 'data', 'auth')
const USERS_FILE = path.resolve(AUTH_DIR, 'users.json')
const SESSIONS_FILE = path.resolve(AUTH_DIR, 'sessions.json')
const RATE_LIMITS_FILE = path.resolve(AUTH_DIR, 'ratelimits.json')
const SECRET_FILE = path.resolve(AUTH_DIR, '.session-secret')

const BCRYPT_SALT_ROUNDS = 12
// Precomputed dummy bcrypt hash so unknown-email login checks run constant-work comparison
const DUMMY_BCRYPT_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.1N1c3uE4O/vV0Z0bW9D3fZ1y6o9lR1e'

export const LOGIN_EMAIL_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
export const LOGIN_EMAIL_MAX_ATTEMPTS = 10
export const AUTH_IP_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
export const AUTH_IP_MAX_ATTEMPTS = 25
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let cachedSecret: string | null = null

async function ensureAuthDir(): Promise<void> {
  if (!fsSync.existsSync(AUTH_DIR)) {
    await fs.mkdir(AUTH_DIR, { recursive: true })
  }
}

function rowToStoredUser(row: any): StoredUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    phone: row.phone ?? null,
    photoDataUrl: row.photo_data_url ?? null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(row.updated_at).toISOString(),
  }
}

function rowToSession(row: any): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    revoked: Boolean(row.revoked),
  }
}

export async function getAuthSigningSecret(): Promise<string> {
  const envSecret = process.env.AUTH_SESSION_SECRET?.trim()
  if (envSecret && envSecret.length >= 16) {
    return envSecret
  }

  const mode = getStorageBackendMode()
  if (process.env.NODE_ENV === 'production' || mode === 'cloud' || isVercelDeployment()) {
    throw new Error(
      'AUTH_SESSION_SECRET environment variable (minimum 16 characters, 32+ recommended) is required in production.'
    )
  }

  if (cachedSecret) return cachedSecret

  await ensureAuthDir()
  if (fsSync.existsSync(SECRET_FILE)) {
    const raw = (await fs.readFile(SECRET_FILE, 'utf-8')).trim()
    if (raw.length >= 32) {
      cachedSecret = raw
      return raw
    }
  }

  const generated = crypto.randomBytes(32).toString('hex')
  await fs.writeFile(SECRET_FILE, generated, { encoding: 'utf-8', mode: 0o600 })
  cachedSecret = generated
  return generated
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  const norm = normalizeEmail(email)
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(norm) && norm.length <= 254
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' }
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password cannot exceed 128 characters.' }
  }
  return { valid: true }
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    photoDataUrl: user.photoDataUrl,
    createdAt: user.createdAt,
  }
}

async function checkAndRecordRateLimit(
  bucketKey: string,
  windowMs: number,
  maxCount: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (getStorageBackendMode() === 'cloud') {
    const sb = getSupabaseAdmin()
    const now = Date.now()
    const { data, error } = await sb
      .from('aura_rate_limits')
      .select('attempts')
      .eq('bucket_key', bucketKey)
      .maybeSingle()

    if (error) {
      throw new Error(`Rate limit lookup failed: ${error.message}`)
    }

    const existing = Array.isArray(data?.attempts) ? (data.attempts as number[]) : []
    const recent = existing.filter((ts) => typeof ts === 'number' && now - ts < windowMs)

    if (recent.length >= maxCount) {
      const oldest = Math.min(...recent)
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
      await sb.from('aura_rate_limits').upsert({
        bucket_key: bucketKey,
        attempts: recent,
        updated_at: new Date(now).toISOString(),
      })
      return { allowed: false, retryAfterSeconds }
    }

    recent.push(now)
    const upsertRes = await sb.from('aura_rate_limits').upsert({
      bucket_key: bucketKey,
      attempts: recent,
      updated_at: new Date(now).toISOString(),
    })
    if (upsertRes.error) {
      throw new Error(`Rate limit write failed: ${upsertRes.error.message}`)
    }
    return { allowed: true, retryAfterSeconds: 0 }
  }

  return withFileLock(RATE_LIMITS_FILE, async () => {
    await ensureAuthDir()
    const now = Date.now()
    const limits = await readJsonSafe<Record<string, number[]>>(RATE_LIMITS_FILE, {})
    const recent = (limits[bucketKey] || []).filter((ts) => now - ts < windowMs)

    if (recent.length >= maxCount) {
      const oldest = Math.min(...recent)
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
      limits[bucketKey] = recent
      await writeJsonAtomic(RATE_LIMITS_FILE, limits)
      return { allowed: false, retryAfterSeconds }
    }

    recent.push(now)
    limits[bucketKey] = recent

    for (const key of Object.keys(limits)) {
      if (limits[key].every((ts) => now - ts >= windowMs)) {
        delete limits[key]
      }
    }

    await writeJsonAtomic(RATE_LIMITS_FILE, limits)
    return { allowed: true, retryAfterSeconds: 0 }
  })
}

async function clearRateLimitBucket(bucketKey: string): Promise<void> {
  if (getStorageBackendMode() === 'cloud') {
    const sb = getSupabaseAdmin()
    await sb.from('aura_rate_limits').delete().eq('bucket_key', bucketKey)
    return
  }

  await withFileLock(RATE_LIMITS_FILE, async () => {
    await ensureAuthDir()
    const limits = await readJsonSafe<Record<string, number[]>>(RATE_LIMITS_FILE, {})
    if (limits[bucketKey]) {
      delete limits[bucketKey]
      await writeJsonAtomic(RATE_LIMITS_FILE, limits)
    }
  })
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const norm = normalizeEmail(email)
  if (getStorageBackendMode() === 'cloud') {
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_users')
      .select('*')
      .eq('email', norm)
      .maybeSingle()
    if (error) throw new Error(`User lookup failed: ${error.message}`)
    return data ? rowToStoredUser(data) : null
  }

  await ensureAuthDir()
  const users = await readJsonSafe<Record<string, StoredUser>>(USERS_FILE, {})
  return Object.values(users).find((u) => u.email === norm) || null
}

export async function findUserById(userId: string): Promise<StoredUser | null> {
  if (!validateUserId(userId)) return null
  if (getStorageBackendMode() === 'cloud') {
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw new Error(`User lookup failed: ${error.message}`)
    return data ? rowToStoredUser(data) : null
  }

  await ensureAuthDir()
  const users = await readJsonSafe<Record<string, StoredUser>>(USERS_FILE, {})
  return users[userId] || null
}

async function createSessionForUser(userId: string): Promise<string> {
  const now = Date.now()
  const sessionId = `ses_${now}_${crypto.randomBytes(12).toString('hex')}`
  const secret = await getAuthSigningSecret()
  const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('base64url')
  const sessionToken = `${sessionId}.${sig}`

  if (getStorageBackendMode() === 'cloud') {
    const sb = getSupabaseAdmin()
    // Clean stale sessions for this user and insert active session
    await sb
      .from('aura_sessions')
      .delete()
      .eq('user_id', userId)
      .or(`expires_at.lt.${now},revoked.eq.true`)

    const insertRes = await sb.from('aura_sessions').insert({
      id: sessionId,
      user_id: userId,
      created_at: now,
      expires_at: now + SESSION_DURATION_MS,
      revoked: false,
    })
    if (insertRes.error) {
      throw new Error(`Failed to create session: ${insertRes.error.message}`)
    }
    return sessionToken
  }

  const docsDir = resolveScopedDocumentsDir(userId)
  if (!fsSync.existsSync(docsDir)) {
    await fs.mkdir(docsDir, { recursive: true })
  }

  await withFileLock(SESSIONS_FILE, async () => {
    await ensureAuthDir()
    const sessions = await readJsonSafe<Record<string, SessionRecord>>(SESSIONS_FILE, {})
    for (const [k, s] of Object.entries(sessions)) {
      if (s.expiresAt < now || s.revoked) delete sessions[k]
    }
    sessions[sessionId] = {
      id: sessionId,
      userId,
      createdAt: now,
      expiresAt: now + SESSION_DURATION_MS,
      revoked: false,
    }
    await writeJsonAtomic(SESSIONS_FILE, sessions)
  })

  return sessionToken
}

export async function registerUserWithPassword(params: {
  name: string
  email: string
  password: string
  confirmPassword: string
  ipAddress?: string
}): Promise<{
  success: boolean
  statusCode: number
  error?: string
  user?: PublicUser
  sessionToken?: string
}> {
  const ipKey = `signup_ip:${(params.ipAddress || 'local').slice(0, 64)}`
  const ipLimit = await checkAndRecordRateLimit(ipKey, AUTH_IP_WINDOW_MS, AUTH_IP_MAX_ATTEMPTS)
  if (!ipLimit.allowed) {
    return {
      success: false,
      statusCode: 429,
      error: `Too many signup attempts. Please try again in ${ipLimit.retryAfterSeconds} seconds.`,
    }
  }

  const trimmedName = (params.name || '').trim()
  if (trimmedName.length < 2 || trimmedName.length > 80) {
    return {
      success: false,
      statusCode: 400,
      error: 'Please enter your full name (2 to 80 characters).',
    }
  }

  const email = normalizeEmail(params.email || '')
  if (!isValidEmail(email)) {
    return {
      success: false,
      statusCode: 400,
      error: 'Please enter a valid email address.',
    }
  }

  const pwCheck = validatePasswordStrength(params.password)
  if (!pwCheck.valid) {
    return {
      success: false,
      statusCode: 400,
      error: pwCheck.error,
    }
  }

  if (params.password !== params.confirmPassword) {
    return {
      success: false,
      statusCode: 400,
      error: 'Password and Confirm Password do not match.',
    }
  }

  const passwordHash = await bcrypt.hash(params.password, BCRYPT_SALT_ROUNDS)

  let createdUser: StoredUser | null = null

  if (getStorageBackendMode() === 'cloud') {
    const existing = await findUserByEmail(email)
    if (!existing) {
      const sb = getSupabaseAdmin()
      const id = `usr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
      const iso = new Date().toISOString()
      const { data, error } = await sb
        .from('aura_users')
        .insert({
          id,
          email,
          name: trimmedName,
          password_hash: passwordHash,
          phone: null,
          photo_data_url: null,
          created_at: iso,
          updated_at: iso,
        })
        .select('*')
        .single()

      if (error) {
        if (error.code === '23505') {
          createdUser = null
        } else {
          throw new Error(`Signup failed: ${error.message}`)
        }
      } else if (data) {
        createdUser = rowToStoredUser(data)
      }
    }
  } else {
    createdUser = await withFileLock(USERS_FILE, async () => {
      await ensureAuthDir()
      const users = await readJsonSafe<Record<string, StoredUser>>(USERS_FILE, {})
      const duplicate = Object.values(users).find((u) => u.email === email)
      if (duplicate) return null

      const id = `usr_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
      const iso = new Date().toISOString()
      const newUser: StoredUser = {
        id,
        email,
        name: trimmedName,
        passwordHash,
        phone: null,
        photoDataUrl: null,
        createdAt: iso,
        updatedAt: iso,
      }
      users[id] = newUser
      await writeJsonAtomic(USERS_FILE, users)
      return newUser
    })
  }

  if (!createdUser) {
    return {
      success: false,
      statusCode: 409,
      error: 'An account with this email address is already registered. Please log in instead.',
    }
  }

  const sessionToken = await createSessionForUser(createdUser.id)
  return {
    success: true,
    statusCode: 201,
    user: toPublicUser(createdUser),
    sessionToken,
  }
}

export async function authenticateWithPassword(params: {
  email: string
  password: string
  ipAddress?: string
}): Promise<{
  success: boolean
  statusCode: number
  error?: string
  user?: PublicUser
  sessionToken?: string
}> {
  const ipKey = `login_ip:${(params.ipAddress || 'local').slice(0, 64)}`
  const ipLimit = await checkAndRecordRateLimit(ipKey, AUTH_IP_WINDOW_MS, AUTH_IP_MAX_ATTEMPTS)
  if (!ipLimit.allowed) {
    return {
      success: false,
      statusCode: 429,
      error: `Too many login attempts from this device. Please try again in ${ipLimit.retryAfterSeconds} seconds.`,
    }
  }

  const email = normalizeEmail(params.email || '')
  const password = typeof params.password === 'string' ? params.password : ''

  if (!isValidEmail(email) || !password) {
    return {
      success: false,
      statusCode: 400,
      error: 'Please enter a valid email address and password.',
    }
  }

  const emailBucket = `login_email:${email}`
  const emailLimit = await checkAndRecordRateLimit(
    emailBucket,
    LOGIN_EMAIL_WINDOW_MS,
    LOGIN_EMAIL_MAX_ATTEMPTS
  )
  if (!emailLimit.allowed) {
    return {
      success: false,
      statusCode: 429,
      error: `Too many failed login attempts for this account. Please wait ${emailLimit.retryAfterSeconds} seconds.`,
    }
  }

  const user = await findUserByEmail(email)
  if (!user) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH)
    return {
      success: false,
      statusCode: 401,
      error: 'Invalid email address or password.',
    }
  }

  if (!user.passwordHash) {
    return {
      success: false,
      statusCode: 403,
      error:
        'This existing account was created without a password and cannot log in automatically. Please create a new password account on Sign Up.',
    }
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash)
  if (!passwordValid) {
    return {
      success: false,
      statusCode: 401,
      error: 'Invalid email address or password.',
    }
  }

  await clearRateLimitBucket(emailBucket)
  const sessionToken = await createSessionForUser(user.id)

  return {
    success: true,
    statusCode: 200,
    user: toPublicUser(user),
    sessionToken,
  }
}

export async function updateUserProfile(
  userId: string,
  updates: {
    name?: string
    phone?: string | null
    photoDataUrl?: string | null
  }
): Promise<PublicUser | null> {
  if (!validateUserId(userId)) return null

  if (getStorageBackendMode() === 'cloud') {
    const existing = await findUserById(userId)
    if (!existing) return null

    const nextName =
      typeof updates.name === 'string' && updates.name.trim().length >= 2
        ? updates.name.trim().slice(0, 80)
        : existing.name

    const nextPhone =
      updates.phone !== undefined
        ? typeof updates.phone === 'string' && updates.phone.trim()
          ? updates.phone.trim().slice(0, 24)
          : null
        : existing.phone

    const nextPhoto =
      updates.photoDataUrl !== undefined
        ? typeof updates.photoDataUrl === 'string' &&
          updates.photoDataUrl.startsWith('data:image/') &&
          updates.photoDataUrl.length <= 1_500_000
          ? updates.photoDataUrl
          : null
        : existing.photoDataUrl

    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_users')
      .update({
        name: nextName,
        phone: nextPhone,
        photo_data_url: nextPhoto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('*')
      .maybeSingle()

    const row = unwrapSupabaseResult(res, 'updateUserProfile')
    return row ? toPublicUser(rowToStoredUser(row)) : null
  }

  return withFileLock(USERS_FILE, async () => {
    await ensureAuthDir()
    const users = await readJsonSafe<Record<string, StoredUser>>(USERS_FILE, {})
    const existing = users[userId]
    if (!existing) return null

    const nextName =
      typeof updates.name === 'string' && updates.name.trim().length >= 2
        ? updates.name.trim().slice(0, 80)
        : existing.name

    const nextPhone =
      updates.phone !== undefined
        ? typeof updates.phone === 'string' && updates.phone.trim()
          ? updates.phone.trim().slice(0, 24)
          : null
        : existing.phone

    const nextPhoto =
      updates.photoDataUrl !== undefined
        ? typeof updates.photoDataUrl === 'string' &&
          updates.photoDataUrl.startsWith('data:image/') &&
          updates.photoDataUrl.length <= 1_500_000
          ? updates.photoDataUrl
          : null
        : existing.photoDataUrl

    const updated: StoredUser = {
      ...existing,
      name: nextName,
      phone: nextPhone,
      photoDataUrl: nextPhoto,
      updatedAt: new Date().toISOString(),
    }

    users[userId] = updated
    await writeJsonAtomic(USERS_FILE, users)
    return toPublicUser(updated)
  })
}

export async function verifySessionToken(token: string | undefined | null): Promise<PublicUser | null> {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [sessionId, sig] = parts
  if (!/^ses_[0-9]+_[a-f0-9]+$/.test(sessionId) || !sig) return null

  const secret = await getAuthSigningSecret()
  const expectedSig = crypto.createHmac('sha256', secret).update(sessionId).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  if (getStorageBackendMode() === 'cloud') {
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()
    if (error || !data) return null
    const session = rowToSession(data)
    if (session.revoked || Date.now() > session.expiresAt) return null

    const user = await findUserById(session.userId)
    return user ? toPublicUser(user) : null
  }

  await ensureAuthDir()
  const sessions = await readJsonSafe<Record<string, SessionRecord>>(SESSIONS_FILE, {})
  const session = sessions[sessionId]
  if (!session || session.revoked || Date.now() > session.expiresAt) return null

  const user = await findUserById(session.userId)
  return user ? toPublicUser(user) : null
}

export async function revokeSessionToken(token: string | undefined | null): Promise<void> {
  if (!token || typeof token !== 'string') return
  const sessionId = token.split('.')[0]
  if (!/^ses_[0-9]+_[a-f0-9]+$/.test(sessionId)) return

  if (getStorageBackendMode() === 'cloud') {
    const sb = getSupabaseAdmin()
    await sb.from('aura_sessions').update({ revoked: true }).eq('id', sessionId)
    return
  }

  await withFileLock(SESSIONS_FILE, async () => {
    await ensureAuthDir()
    const sessions = await readJsonSafe<Record<string, SessionRecord>>(SESSIONS_FILE, {})
    if (sessions[sessionId]) {
      sessions[sessionId].revoked = true
      await writeJsonAtomic(SESSIONS_FILE, sessions)
    }
  })
}
