import { del, get, head, put } from '@vercel/blob'
import { validateUserId } from './user-scope.ts'

const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._-]+$/

/**
 * Builds a strict user-scoped Private Vercel Blob pathname for a stored document.
 */
export function buildUserDocumentBlobPathname(userId: string, storageFilename: string): string {
  if (!validateUserId(userId)) {
    throw new Error('Invalid user scope identifier for private document storage.')
  }
  const cleanName = storageFilename.trim()
  if (!cleanName || cleanName.includes('/') || cleanName.includes('\\') || cleanName.includes('..') || !SAFE_FILENAME_REGEX.test(cleanName)) {
    throw new Error('Unsafe storage filename detected for private blob pathname.')
  }
  return `users/${userId}/documents/${cleanName}`
}

/**
 * Builds the temporary client-upload blob prefix permitted for an authenticated user.
 */
export function buildUserTempUploadPrefix(userId: string): string {
  if (!validateUserId(userId)) {
    throw new Error('Invalid user scope identifier for temporary upload prefix.')
  }
  return `uploads/tmp/${userId}/`
}

/**
 * Validates that a Blob pathname stays strictly within AURA's private document or temp prefixes
 * and belongs to the expected userId when provided.
 */
export function assertValidPrivateBlobPathname(pathname: string, expectedUserId?: string): string {
  const normalized = pathname.trim().replace(/^\/+/, '')
  if (!normalized || normalized.includes('..') || normalized.includes('\\') || normalized.startsWith('http')) {
    throw new Error('Invalid private blob pathname.')
  }

  if (expectedUserId) {
    if (!validateUserId(expectedUserId)) {
      throw new Error('Invalid expected user scope for blob access.')
    }
    const permPrefix = `users/${expectedUserId}/documents/`
    const tmpPrefix = `uploads/tmp/${expectedUserId}/`
    if (!normalized.startsWith(permPrefix) && !normalized.startsWith(tmpPrefix)) {
      throw new Error('Unauthorized blob pathname outside user scope.')
    }
  } else if (!/^users\/usr_[0-9]+_[a-f0-9]+\/documents\/[a-zA-Z0-9._-]+$/.test(normalized) &&
             !/^uploads\/tmp\/usr_[0-9]+_[a-f0-9]+\/[a-zA-Z0-9._-]+$/.test(normalized)) {
    throw new Error('Blob pathname does not match private user storage structure.')
  }

  return normalized
}

function getBlobToken(): string | undefined {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  return token || undefined
}

/**
 * Uploads a document binary strictly as a Private Vercel Blob (`access: 'private'`).
 * Never exposes public URLs; reads are proxied solely through authenticated API routes.
 */
export async function uploadPrivateDocumentBlob(
  pathname: string,
  buffer: Buffer,
  contentType: string,
  expectedUserId?: string
): Promise<{ pathname: string; contentType: string }> {
  const safePath = assertValidPrivateBlobPathname(pathname, expectedUserId)
  const result = await put(safePath, buffer, {
    access: 'private',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    token: getBlobToken(),
  })

  return {
    pathname: result.pathname,
    contentType: result.contentType,
  }
}

/**
 * Fetches bytes for a Private Vercel Blob server-side using BLOB_READ_WRITE_TOKEN.
 */
export async function downloadPrivateDocumentBlob(
  pathname: string,
  expectedUserId?: string
): Promise<Buffer | null> {
  const safePath = assertValidPrivateBlobPathname(pathname, expectedUserId)
  try {
    const res = await get(safePath, {
      access: 'private',
      useCache: false,
      token: getBlobToken(),
    })
    if (!res || res.statusCode !== 200 || !res.stream) {
      return null
    }
    const arrayBuffer = await new Response(res.stream).arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch {
    return null
  }
}

/**
 * Reads metadata (size, contentType) for a Private Vercel Blob without downloading its entire body.
 */
export async function headPrivateDocumentBlob(
  pathname: string,
  expectedUserId?: string
): Promise<{ size: number; contentType: string; pathname: string } | null> {
  const safePath = assertValidPrivateBlobPathname(pathname, expectedUserId)
  try {
    const meta = await head(safePath, { token: getBlobToken() })
    return {
      size: meta.size,
      contentType: meta.contentType,
      pathname: meta.pathname,
    }
  } catch {
    return null
  }
}

/**
 * Deletes a Private Vercel Blob cleanly when a document or temp upload is removed.
 */
export async function deletePrivateDocumentBlob(
  pathname: string,
  expectedUserId?: string
): Promise<void> {
  const safePath = assertValidPrivateBlobPathname(pathname, expectedUserId)
  try {
    await del(safePath, { token: getBlobToken() })
  } catch {
    // Ignore missing blob on idempotent cleanup
  }
}
