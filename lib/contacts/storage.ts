import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import crypto from 'node:crypto'
import type { StoredDocument } from '../lifefile/types.ts'
import type { StoredProduct } from '../products/types.ts'
import type { ParsedContactFields, StoredContact } from './types.ts'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../storage/atomic-json.ts'
import { resolveScopedBaseDir, resolveScopedJsonFile, validateUserId } from '../storage/user-scope.ts'
import { getStorageBackendMode } from '../storage/backend.ts'
import { getSupabaseAdmin, unwrapSupabaseResult } from '../storage/supabase-client.ts'

const CONTACT_ID_REGEX = /^cont_[0-9]+_[a-f0-9]+$/

function requireCloudUserId(userId?: string): string {
  if (!userId || !validateUserId(userId)) {
    throw new Error('Authenticated userId scope is required in cloud storage mode.')
  }
  return userId
}

function rowToContact(row: any): StoredContact {
  return {
    id: row.id,
    companyName: row.company_name,
    phone: row.phone ?? null,
    email: row.email ?? null,
    website: row.website ?? null,
    linkedProductIds: Array.isArray(row.linked_product_ids) ? row.linked_product_ids : [],
    linkedDocumentIds: Array.isArray(row.linked_document_ids) ? row.linked_document_ids : [],
    notes: row.notes ?? null,
    source: row.source,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(row.updated_at).toISOString(),
  }
}

function contactToRow(contact: StoredContact, userId: string) {
  return {
    id: contact.id,
    user_id: userId,
    company_name: contact.companyName,
    phone: contact.phone,
    email: contact.email,
    website: contact.website,
    linked_product_ids: contact.linkedProductIds,
    linked_document_ids: contact.linkedDocumentIds,
    notes: contact.notes ?? null,
    source: contact.source,
    created_at: contact.createdAt,
    updated_at: contact.updatedAt,
  }
}

function getContactsFile(userId?: string): string {
  return resolveScopedJsonFile('contacts.json', userId)
}

async function ensureDirectory(userId?: string): Promise<string> {
  const baseDir = resolveScopedBaseDir(userId)
  if (!fsSync.existsSync(baseDir)) {
    await fs.mkdir(baseDir, { recursive: true })
  }
  return getContactsFile(userId)
}

async function readContacts(userId?: string): Promise<Record<string, StoredContact>> {
  const file = await ensureDirectory(userId)
  return readJsonSafe<Record<string, StoredContact>>(file, {})
}

async function writeContacts(data: Record<string, StoredContact>, userId?: string): Promise<void> {
  const file = await ensureDirectory(userId)
  await writeJsonAtomic(file, data)
}

export function generateContactId(): string {
  return `cont_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export function validateContactId(id: string): boolean {
  return CONTACT_ID_REGEX.test(id)
}

/**
 * Sanitizes and validates a support website URL to block unsafe schemes (e.g., javascript:).
 */
export function sanitizeWebsiteUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null
  const trimmed = rawUrl.trim().replace(/[),.;]+$/, '')
  if (!trimmed) return null

  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(withProtocol)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    if (!parsed.hostname.includes('.')) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function sanitizeEmail(rawEmail: string | null | undefined): string | null {
  if (!rawEmail) return null
  const trimmed = rawEmail.trim()
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
    return trimmed
  }
  return null
}

export function sanitizePhone(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null
  const cleaned = rawPhone.replace(/[^\d+\-\s()]/g, '').trim()
  const digits = cleaned.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return cleaned
}

/**
 * Extracts phone number, email address, and website URL from freeform contactDetails or structured fields.
 */
export function parseContactDetails(
  contactDetails: string | null | undefined,
  supportPhone?: string | null,
  supportEmail?: string | null,
  supportWebsite?: string | null
): ParsedContactFields {
  const sourceText = contactDetails || ''

  const emailMatch = sourceText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const email = sanitizeEmail(supportEmail) || (emailMatch ? sanitizeEmail(emailMatch[0]) : null)

  const textWithoutEmail = emailMatch ? sourceText.replace(emailMatch[0], ' ') : sourceText
  const urlMatch = textWithoutEmail.match(/(?:https?:\/\/|www\.)[^\s,;<>()]+|[a-zA-Z0-9-]+\.(?:com|in|co\.in|org|net|care|support)(?:\/[^\s,;<>()]*)?/i)
  const website =
    sanitizeWebsiteUrl(supportWebsite) || (urlMatch ? sanitizeWebsiteUrl(urlMatch[0]) : null)

  const phoneMatch = sourceText.match(/(?:\+?\d[\d\s\-()]{6,16}\d)/)
  const phone = sanitizePhone(supportPhone) || (phoneMatch ? sanitizePhone(phoneMatch[0]) : null)

  return { phone, email, website }
}

function normalizeCompanyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(india|pvt|ltd|limited|private|inc|corp|corporation|customer\s*care|support)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isSameContactCandidate(
  existing: StoredContact,
  companyName: string,
  parsed: ParsedContactFields
): boolean {
  const keyA = normalizeCompanyKey(existing.companyName)
  const keyB = normalizeCompanyKey(companyName)
  if (keyA && keyB && (keyA === keyB || keyA.includes(keyB) || keyB.includes(keyA))) {
    return true
  }
  if (existing.email && parsed.email && existing.email.toLowerCase() === parsed.email.toLowerCase()) {
    return true
  }
  if (existing.phone && parsed.phone) {
    const digitsA = existing.phone.replace(/\D/g, '')
    const digitsB = parsed.phone.replace(/\D/g, '')
    if (digitsA.length >= 7 && digitsA === digitsB) return true
  }
  return false
}

export async function getAllContacts(userId?: string): Promise<StoredContact[]> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_contacts')
      .select('*')
      .eq('user_id', scopedUser)
      .order('company_name', { ascending: true })
    const rows = unwrapSupabaseResult(res, 'getAllContacts')
    return rows.map(rowToContact)
  }

  const map = await readContacts(userId)
  return Object.values(map).sort((a, b) => a.companyName.localeCompare(b.companyName))
}

export async function getContactById(id: string, userId?: string): Promise<StoredContact | null> {
  if (!validateContactId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_contacts')
      .select('*')
      .eq('id', id)
      .eq('user_id', scopedUser)
      .maybeSingle()
    if (error) throw new Error(`getContactById failed: ${error.message}`)
    return data ? rowToContact(data) : null
  }

  const map = await readContacts(userId)
  return map[id] || null
}

export async function saveContact(
  input: {
    companyName: string
    phone?: string | null
    email?: string | null
    website?: string | null
    linkedProductIds?: string[]
    linkedDocumentIds?: string[]
    notes?: string | null
    source?: 'auto' | 'manual'
  },
  userId?: string
): Promise<{ contact: StoredContact; duplicateFound: boolean }> {
  const buildOutcome = (existingList: StoredContact[]) => {
    const parsed: ParsedContactFields = {
      phone: sanitizePhone(input.phone),
      email: sanitizeEmail(input.email),
      website: sanitizeWebsiteUrl(input.website),
    }

    const duplicate = existingList.find((c) => isSameContactCandidate(c, input.companyName, parsed))

    if (duplicate) {
      const updated: StoredContact = {
        ...duplicate,
        phone: duplicate.phone || parsed.phone,
        email: duplicate.email || parsed.email,
        website: duplicate.website || parsed.website,
        linkedProductIds: Array.from(
          new Set([...(duplicate.linkedProductIds || []), ...(input.linkedProductIds || [])])
        ),
        linkedDocumentIds: Array.from(
          new Set([...(duplicate.linkedDocumentIds || []), ...(input.linkedDocumentIds || [])])
        ),
        notes: duplicate.notes || input.notes?.trim() || null,
        updatedAt: new Date().toISOString(),
      }
      return { contact: updated, duplicateFound: true }
    }

    const id = generateContactId()
    const now = new Date().toISOString()
    const newContact: StoredContact = {
      id,
      companyName: input.companyName.trim(),
      phone: parsed.phone,
      email: parsed.email,
      website: parsed.website,
      linkedProductIds: Array.from(new Set(input.linkedProductIds || [])),
      linkedDocumentIds: Array.from(new Set(input.linkedDocumentIds || [])),
      notes: input.notes?.trim() || null,
      source: input.source || 'manual',
      createdAt: now,
      updatedAt: now,
    }
    return { contact: newContact, duplicateFound: false }
  }

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existingList = await getAllContacts(scopedUser)
    const outcome = buildOutcome(existingList)
    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_contacts')
      .upsert(contactToRow(outcome.contact, scopedUser))
      .select('*')
      .single()
    const row = unwrapSupabaseResult(res, 'saveContact')
    return { contact: rowToContact(row), duplicateFound: outcome.duplicateFound }
  }

  const file = getContactsFile(userId)
  return withFileLock(file, async () => {
    await ensureDirectory(userId)
    const map = await readContacts(userId)
    const outcome = buildOutcome(Object.values(map))
    map[outcome.contact.id] = outcome.contact
    await writeContacts(map, userId)
    return outcome
  })
}

export async function updateContact(
  id: string,
  updates: Partial<Omit<StoredContact, 'id' | 'createdAt'>>,
  userId?: string
): Promise<StoredContact | null> {
  if (!validateContactId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existing = await getContactById(id, scopedUser)
    if (!existing) return null

    const updated: StoredContact = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      phone: updates.phone !== undefined ? sanitizePhone(updates.phone) : existing.phone,
      email: updates.email !== undefined ? sanitizeEmail(updates.email) : existing.email,
      website: updates.website !== undefined ? sanitizeWebsiteUrl(updates.website) : existing.website,
      updatedAt: new Date().toISOString(),
    }

    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_contacts')
      .update(contactToRow(updated, scopedUser))
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('*')
      .maybeSingle()

    const row = unwrapSupabaseResult(res, 'updateContact')
    return row ? rowToContact(row) : null
  }

  const file = getContactsFile(userId)
  return withFileLock(file, async () => {
    const map = await readContacts(userId)
    const existing = map[id]
    if (!existing) return null

    const updated: StoredContact = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      phone: updates.phone !== undefined ? sanitizePhone(updates.phone) : existing.phone,
      email: updates.email !== undefined ? sanitizeEmail(updates.email) : existing.email,
      website: updates.website !== undefined ? sanitizeWebsiteUrl(updates.website) : existing.website,
      updatedAt: new Date().toISOString(),
    }

    map[id] = updated
    await writeContacts(map, userId)
    return updated
  })
}

export async function deleteContact(id: string, userId?: string): Promise<boolean> {
  if (!validateContactId(id)) return false

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_contacts')
      .delete()
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`deleteContact failed: ${error.message}`)
    return Boolean(data)
  }

  const file = getContactsFile(userId)
  return withFileLock(file, async () => {
    const map = await readContacts(userId)
    if (!map[id]) return false
    delete map[id]
    await writeContacts(map, userId)
    return true
  })
}

/**
 * Extracts and deduplicates customer-care contacts from LifeFile documents and associates them with matching products.
 */
export async function syncContactsFromLifeFile(
  documents: StoredDocument[],
  products: StoredProduct[] = [],
  contactsOverride?: StoredContact[],
  userId?: string
): Promise<{
  added: StoredContact[]
  updated: StoredContact[]
  skippedCount: number
  allContacts: StoredContact[]
}> {
  const isInMemory = Array.isArray(contactsOverride)
  const useCloud = !isInMemory && getStorageBackendMode() === 'cloud'
  const map: Record<string, StoredContact> = {}

  if (isInMemory) {
    for (const c of contactsOverride) {
      map[c.id] = {
        ...c,
        linkedProductIds: [...c.linkedProductIds],
        linkedDocumentIds: [...c.linkedDocumentIds],
      }
    }
  } else if (useCloud) {
    const scopedUser = requireCloudUserId(userId)
    const list = await getAllContacts(scopedUser)
    for (const c of list) map[c.id] = c
  } else {
    Object.assign(map, await readContacts(userId))
  }

  const added: StoredContact[] = []
  const updated: StoredContact[] = []
  let skippedCount = 0
  let dirty = false

  for (const doc of documents) {
    if (doc.extractionStatus !== 'completed' || !doc.extractedData) continue
    const data = doc.extractedData

    const parsed = parseContactDetails(
      data.contactDetails,
      data.supportPhone,
      data.supportEmail,
      data.supportWebsite
    )

    if (!parsed.phone && !parsed.email && !parsed.website) {
      continue
    }

    const companyName = (data.issuer || data.productName || 'Customer Support').trim()

    const companyKey = normalizeCompanyKey(companyName)
    const associatedProductIds = products
      .filter((p) => {
        if (p.linkedDocumentIds.includes(doc.id)) return true
        const brandKey = normalizeCompanyKey(p.brand || '')
        return Boolean(companyKey && brandKey && (companyKey === brandKey || companyKey.includes(brandKey) || brandKey.includes(companyKey)))
      })
      .map((p) => p.id)

    const existingList = Object.values(map)
    const matched = existingList.find((c) => isSameContactCandidate(c, companyName, parsed))

    if (matched) {
      const nextDocs = Array.from(new Set([...matched.linkedDocumentIds, doc.id]))
      const nextProds = Array.from(new Set([...matched.linkedProductIds, ...associatedProductIds]))

      const changed =
        (!matched.phone && parsed.phone) ||
        (!matched.email && parsed.email) ||
        (!matched.website && parsed.website) ||
        nextDocs.length !== matched.linkedDocumentIds.length ||
        nextProds.length !== matched.linkedProductIds.length

      if (!changed) {
        skippedCount++
        continue
      }

      const merged: StoredContact = {
        ...matched,
        phone: matched.phone || parsed.phone,
        email: matched.email || parsed.email,
        website: matched.website || parsed.website,
        linkedDocumentIds: nextDocs,
        linkedProductIds: nextProds,
        updatedAt: new Date().toISOString(),
      }
      map[matched.id] = merged
      if (!updated.some((u) => u.id === merged.id)) {
        updated.push(merged)
      }
      dirty = true
    } else {
      const id = generateContactId()
      const now = new Date().toISOString()
      const created: StoredContact = {
        id,
        companyName,
        phone: parsed.phone,
        email: parsed.email,
        website: parsed.website,
        linkedProductIds: associatedProductIds,
        linkedDocumentIds: [doc.id],
        notes: data.contactDetails || null,
        source: 'auto',
        createdAt: now,
        updatedAt: now,
      }
      map[id] = created
      added.push(created)
      dirty = true
    }
  }

  if (dirty && !isInMemory) {
    if (useCloud) {
      const scopedUser = requireCloudUserId(userId)
      const changedRows = [...added, ...updated].map((c) => contactToRow(c, scopedUser))
      if (changedRows.length > 0) {
        const sb = getSupabaseAdmin()
        const res = await sb.from('aura_contacts').upsert(changedRows)
        if (res.error) throw new Error(`syncContactsFromLifeFile upsert failed: ${res.error.message}`)
      }
    } else {
      await writeContacts(map, userId)
    }
  }

  return {
    added,
    updated,
    skippedCount,
    allContacts: Object.values(map),
  }
}

export async function handleDocumentDeletedForContacts(documentId: string, userId?: string): Promise<number> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const list = await getAllContacts(scopedUser)
    const modifiedRows: StoredContact[] = []

    for (const contact of list) {
      if (contact.linkedDocumentIds.includes(documentId)) {
        contact.linkedDocumentIds = contact.linkedDocumentIds.filter((id) => id !== documentId)
        contact.updatedAt = new Date().toISOString()
        modifiedRows.push(contact)
      }
    }
    if (modifiedRows.length > 0) {
      const sb = getSupabaseAdmin()
      const res = await sb
        .from('aura_contacts')
        .upsert(modifiedRows.map((c) => contactToRow(c, scopedUser)))
      if (res.error) throw new Error(`handleDocumentDeletedForContacts upsert failed: ${res.error.message}`)
    }
    return modifiedRows.length
  }

  const map = await readContacts(userId)
  let modified = 0
  for (const contact of Object.values(map)) {
    if (contact.linkedDocumentIds.includes(documentId)) {
      contact.linkedDocumentIds = contact.linkedDocumentIds.filter((id) => id !== documentId)
      contact.updatedAt = new Date().toISOString()
      modified++
    }
  }
  if (modified > 0) {
    await writeContacts(map, userId)
  }
  return modified
}

export async function handleProductDeletedForContacts(productId: string, userId?: string): Promise<number> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const list = await getAllContacts(scopedUser)
    const modifiedRows: StoredContact[] = []

    for (const contact of list) {
      if (contact.linkedProductIds.includes(productId)) {
        contact.linkedProductIds = contact.linkedProductIds.filter((id) => id !== productId)
        contact.updatedAt = new Date().toISOString()
        modifiedRows.push(contact)
      }
    }
    if (modifiedRows.length > 0) {
      const sb = getSupabaseAdmin()
      const res = await sb
        .from('aura_contacts')
        .upsert(modifiedRows.map((c) => contactToRow(c, scopedUser)))
      if (res.error) throw new Error(`handleProductDeletedForContacts upsert failed: ${res.error.message}`)
    }
    return modifiedRows.length
  }

  const map = await readContacts(userId)
  let modified = 0
  for (const contact of Object.values(map)) {
    if (contact.linkedProductIds.includes(productId)) {
      contact.linkedProductIds = contact.linkedProductIds.filter((id) => id !== productId)
      contact.updatedAt = new Date().toISOString()
      modified++
    }
  }
  if (modified > 0) {
    await writeContacts(map, userId)
  }
  return modified
}
