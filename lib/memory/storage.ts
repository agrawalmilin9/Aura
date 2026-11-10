import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import crypto from 'node:crypto'
import type { MemoryCategory, StoredMemory } from './types.ts'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../storage/atomic-json.ts'
import { resolveScopedBaseDir, resolveScopedJsonFile, validateUserId } from '../storage/user-scope.ts'
import { getStorageBackendMode } from '../storage/backend.ts'
import { getSupabaseAdmin, unwrapSupabaseResult } from '../storage/supabase-client.ts'

const MEMORY_ID_REGEX = /^mem_[0-9]+_[a-f0-9]+$/

function requireCloudUserId(userId?: string): string {
  if (!userId || !validateUserId(userId)) {
    throw new Error('Authenticated userId scope is required in cloud storage mode.')
  }
  return userId
}

function rowToMemory(row: any): StoredMemory {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    approvedByUser: Boolean(row.approved_by_user),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(row.updated_at).toISOString(),
  }
}

function getMemoriesFile(userId?: string): string {
  return resolveScopedJsonFile('memories.json', userId)
}

async function ensureDirectory(userId?: string): Promise<string> {
  const baseDir = resolveScopedBaseDir(userId)
  if (!fsSync.existsSync(baseDir)) {
    await fs.mkdir(baseDir, { recursive: true })
  }
  return getMemoriesFile(userId)
}

async function readMemories(userId?: string): Promise<Record<string, StoredMemory>> {
  const file = await ensureDirectory(userId)
  return readJsonSafe<Record<string, StoredMemory>>(file, {})
}

async function writeMemories(data: Record<string, StoredMemory>, userId?: string): Promise<void> {
  const file = await ensureDirectory(userId)
  await writeJsonAtomic(file, data)
}

export function generateMemoryId(): string {
  return `mem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export function validateMemoryId(id: string): boolean {
  return MEMORY_ID_REGEX.test(id)
}

/**
 * Guards against storing sensitive personal credentials or government IDs inside Personal Memory.
 */
export function detectSensitiveMemoryContent(content: string): { isSensitive: boolean; reason?: string } {
  const text = content.trim()

  if (/\b[A-Z]{5}[0-9]{4}[A-Z]\b/.test(text)) {
    return { isSensitive: true, reason: 'Appears to contain a PAN card number.' }
  }

  if (/\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text)) {
    return { isSensitive: true, reason: 'Appears to contain a 12-digit ID/Aadhaar or card number.' }
  }

  if (/\b(?:\d[ -]?){13,19}\b/.test(text)) {
    return { isSensitive: true, reason: 'Appears to contain a credit/debit card or bank account number.' }
  }

  if (/\b(cvv|pin|password|passcode|otp|secret\s*key|atm\s*pin|bank\s*account)\b/i.test(text)) {
    return { isSensitive: true, reason: 'Contains sensitive credential keywords (password, PIN, CVV, OTP, or bank account).' }
  }

  return { isSensitive: false }
}

export async function getAllMemories(userId?: string): Promise<StoredMemory[]> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_memories')
      .select('*')
      .eq('user_id', scopedUser)
      .eq('approved_by_user', true)
      .order('updated_at', { ascending: false })
    const rows = unwrapSupabaseResult(res, 'getAllMemories')
    return rows.map(rowToMemory)
  }

  const map = await readMemories(userId)
  return Object.values(map)
    .filter((m) => m.approvedByUser === true)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export async function getMemoryById(id: string, userId?: string): Promise<StoredMemory | null> {
  if (!validateMemoryId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_memories')
      .select('*')
      .eq('id', id)
      .eq('user_id', scopedUser)
      .maybeSingle()
    if (error) throw new Error(`getMemoryById failed: ${error.message}`)
    return data ? rowToMemory(data) : null
  }

  const map = await readMemories(userId)
  return map[id] || null
}

/**
 * Saves a personal memory ONLY when explicit user approval is provided and content passes sensitivity checks.
 */
export async function saveMemory(
  input: {
    content: string
    category?: MemoryCategory
    approvedByUser: boolean
  },
  userId?: string
): Promise<{ success: boolean; memory?: StoredMemory; error?: string; duplicate?: boolean }> {
  if (input.approvedByUser !== true) {
    return {
      success: false,
      error: 'Explicit user approval (approvedByUser: true) is required before saving personal memory.',
    }
  }

  const trimmed = typeof input.content === 'string' ? input.content.trim() : ''
  if (!trimmed || trimmed.length < 3) {
    return { success: false, error: 'Memory content must be at least 3 characters long.' }
  }
  if (trimmed.length > 500) {
    return { success: false, error: 'Memory content cannot exceed 500 characters.' }
  }

  const sensitivity = detectSensitiveMemoryContent(trimmed)
  if (sensitivity.isSensitive) {
    return {
      success: false,
      error: `Blocked for your privacy: ${sensitivity.reason} Personal Memory must not store sensitive credentials or ID numbers.`,
    }
  }

  const validCategories: MemoryCategory[] = ['preference', 'family', 'home', 'reminder_rule', 'other']
  const category: MemoryCategory =
    input.category && validCategories.includes(input.category) ? input.category : 'preference'

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const allExisting = await getAllMemories(scopedUser)
    const existing = allExisting.find((m) => m.content.toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      return { success: true, memory: existing, duplicate: true }
    }

    const id = generateMemoryId()
    const now = new Date().toISOString()
    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_memories')
      .insert({
        id,
        user_id: scopedUser,
        content: trimmed,
        category,
        approved_by_user: true,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single()

    const row = unwrapSupabaseResult(res, 'saveMemory')
    return { success: true, memory: rowToMemory(row) }
  }

  const file = getMemoriesFile(userId)
  return withFileLock(file, async () => {
    await ensureDirectory(userId)
    const map = await readMemories(userId)

    const existing = Object.values(map).find((m) => m.content.toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      return { success: true, memory: existing, duplicate: true }
    }

    const id = generateMemoryId()
    const now = new Date().toISOString()
    const memory: StoredMemory = {
      id,
      content: trimmed,
      category,
      approvedByUser: true,
      createdAt: now,
      updatedAt: now,
    }

    map[id] = memory
    await writeMemories(map, userId)
    return { success: true, memory }
  })
}

export async function updateMemory(
  id: string,
  updates: { content?: string; category?: MemoryCategory },
  userId?: string
): Promise<{ success: boolean; memory?: StoredMemory; error?: string }> {
  if (!validateMemoryId(id)) {
    return { success: false, error: 'Invalid memory ID format.' }
  }

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existing = await getMemoryById(id, scopedUser)
    if (!existing) {
      return { success: false, error: 'Memory not found.' }
    }

    let nextContent = existing.content
    if (typeof updates.content === 'string') {
      const trimmed = updates.content.trim()
      if (!trimmed || trimmed.length < 3) {
        return { success: false, error: 'Memory content cannot be empty.' }
      }
      const sensitivity = detectSensitiveMemoryContent(trimmed)
      if (sensitivity.isSensitive) {
        return {
          success: false,
          error: `Blocked for your privacy: ${sensitivity.reason}`,
        }
      }
      nextContent = trimmed
    }

    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_memories')
      .update({
        content: nextContent,
        category: updates.category || existing.category,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('*')
      .maybeSingle()

    const row = unwrapSupabaseResult(res, 'updateMemory')
    return row ? { success: true, memory: rowToMemory(row) } : { success: false, error: 'Memory not found.' }
  }

  const file = getMemoriesFile(userId)
  return withFileLock(file, async () => {
    const map = await readMemories(userId)
    const existing = map[id]
    if (!existing) {
      return { success: false, error: 'Memory not found.' }
    }

    let nextContent = existing.content
    if (typeof updates.content === 'string') {
      const trimmed = updates.content.trim()
      if (!trimmed || trimmed.length < 3) {
        return { success: false, error: 'Memory content cannot be empty.' }
      }
      const sensitivity = detectSensitiveMemoryContent(trimmed)
      if (sensitivity.isSensitive) {
        return {
          success: false,
          error: `Blocked for your privacy: ${sensitivity.reason}`,
        }
      }
      nextContent = trimmed
    }

    const updated: StoredMemory = {
      ...existing,
      content: nextContent,
      category: updates.category || existing.category,
      updatedAt: new Date().toISOString(),
    }

    map[id] = updated
    await writeMemories(map, userId)
    return { success: true, memory: updated }
  })
}

export async function deleteMemory(id: string, userId?: string): Promise<boolean> {
  if (!validateMemoryId(id)) return false

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_memories')
      .delete()
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`deleteMemory failed: ${error.message}`)
    return Boolean(data)
  }

  const file = getMemoriesFile(userId)
  return withFileLock(file, async () => {
    const map = await readMemories(userId)
    if (!map[id]) return false
    delete map[id]
    await writeMemories(map, userId)
    return true
  })
}
