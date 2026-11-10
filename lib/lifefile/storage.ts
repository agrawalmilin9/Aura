import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { StoredDocument } from './types.ts'
import { handleDocumentDeleted } from '../tasks/storage.ts'
import { handleDocumentDeletedForProducts } from '../products/storage.ts'
import { handleDocumentDeletedForContacts } from '../contacts/storage.ts'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../storage/atomic-json.ts'
import { resolveScopedDocumentsDir, resolveScopedJsonFile, validateUserId } from '../storage/user-scope.ts'
import { getStorageBackendMode } from '../storage/backend.ts'
import { getSupabaseAdmin, unwrapSupabaseResult } from '../storage/supabase-client.ts'
import {
  buildUserDocumentBlobPathname,
  deletePrivateDocumentBlob,
  downloadPrivateDocumentBlob,
  uploadPrivateDocumentBlob,
} from '../storage/blob-storage.ts'

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const ID_REGEX = /^doc_[0-9]+_[a-f0-9]+$/

function requireCloudUserId(userId?: string): string {
  if (!userId || !validateUserId(userId)) {
    throw new Error('Authenticated userId scope is required in cloud storage mode.')
  }
  return userId
}

function rowToDocument(row: any): StoredDocument {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    storageFilename: row.storage_filename,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    uploadTimestamp:
      typeof row.upload_timestamp === 'string'
        ? row.upload_timestamp
        : new Date(row.upload_timestamp).toISOString(),
    extractionStatus: row.extraction_status,
    extractedData: row.extracted_data ?? null,
    extractionError: row.extraction_error ?? null,
  }
}

function getPaths(userId?: string) {
  return {
    documentsDir: resolveScopedDocumentsDir(userId),
    metadataFile: resolveScopedJsonFile('metadata.json', userId),
  }
}

/**
 * Ensures storage directories exist on server initialization.
 */
async function ensureStorageDirectories(userId?: string): Promise<{ documentsDir: string; metadataFile: string }> {
  const paths = getPaths(userId)
  if (!fsSync.existsSync(paths.documentsDir)) {
    await fs.mkdir(paths.documentsDir, { recursive: true })
  }
  return paths
}

async function readMetadata(userId?: string): Promise<Record<string, StoredDocument>> {
  const { metadataFile } = await ensureStorageDirectories(userId)
  return readJsonSafe<Record<string, StoredDocument>>(metadataFile, {})
}

async function writeMetadata(data: Record<string, StoredDocument>, userId?: string): Promise<void> {
  const { metadataFile } = await ensureStorageDirectories(userId)
  await writeJsonAtomic(metadataFile, data)
}

/**
 * Generates a unique secure document ID.
 */
export function generateDocumentId(): string {
  const timestamp = Date.now()
  const random = crypto.randomBytes(4).toString('hex')
  return `doc_${timestamp}_${random}`
}

/**
 * Verifies that a document ID is safe and does not contain path traversal characters.
 */
export function validateDocumentId(id: string): boolean {
  return ID_REGEX.test(id)
}

/**
 * Saves a validated document buffer and creates its persistent metadata record.
 */
export async function saveDocument(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  userId?: string
): Promise<StoredDocument> {
  const id = generateDocumentId()
  const ext = MIME_TO_EXT[mimeType] || '.bin'
  const storageFilename = `${id}${ext}`
  const nowIso = new Date().toISOString()

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const blobPathname = buildUserDocumentBlobPathname(scopedUser, storageFilename)

    await uploadPrivateDocumentBlob(blobPathname, buffer, mimeType, scopedUser)

    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_documents')
      .insert({
        id,
        user_id: scopedUser,
        original_filename: originalFilename,
        storage_filename: blobPathname,
        mime_type: mimeType,
        file_size: buffer.length,
        upload_timestamp: nowIso,
        extraction_status: 'pending',
        extracted_data: null,
        extraction_error: null,
      })
      .select('*')
      .single()

    if (res.error || !res.data) {
      await deletePrivateDocumentBlob(blobPathname, scopedUser).catch(() => {})
      throw new Error(`Failed to persist document metadata: ${res.error?.message || 'Insert failed'}`)
    }

    return rowToDocument(res.data)
  }

  const { documentsDir, metadataFile } = await ensureStorageDirectories(userId)
  const filePath = path.resolve(documentsDir, storageFilename)

  // Ensure file path does not escape documents directory
  if (!filePath.startsWith(documentsDir + path.sep)) {
    throw new Error('Path traversal detected during document save.')
  }

  // Write file to disk
  await fs.writeFile(filePath, buffer)

  const newDoc: StoredDocument = {
    id,
    originalFilename,
    storageFilename,
    mimeType,
    fileSize: buffer.length,
    uploadTimestamp: nowIso,
    extractionStatus: 'pending',
    extractedData: null,
    extractionError: null,
  }

  // Update persistent metadata under file lock
  await withFileLock(metadataFile, async () => {
    const metadata = await readMetadata(userId)
    metadata[id] = newDoc
    await writeMetadata(metadata, userId)
  })

  return newDoc
}

/**
 * Retrieves all stored documents ordered by upload timestamp descending.
 */
export async function getAllDocuments(userId?: string): Promise<StoredDocument[]> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_documents')
      .select('*')
      .eq('user_id', scopedUser)
      .order('upload_timestamp', { ascending: false })

    const rows = unwrapSupabaseResult(res, 'getAllDocuments')
    return rows.map(rowToDocument)
  }

  const metadata = await readMetadata(userId)
  return Object.values(metadata).sort(
    (a, b) => new Date(b.uploadTimestamp).getTime() - new Date(a.uploadTimestamp).getTime()
  )
}

/**
 * Retrieves a single stored document's metadata by ID.
 */
export async function getDocumentById(id: string, userId?: string): Promise<StoredDocument | null> {
  if (!validateDocumentId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_documents')
      .select('*')
      .eq('id', id)
      .eq('user_id', scopedUser)
      .maybeSingle()

    if (error) throw new Error(`getDocumentById failed: ${error.message}`)
    return data ? rowToDocument(data) : null
  }

  const metadata = await readMetadata(userId)
  return metadata[id] || null
}

/**
 * Retrieves the raw file buffer of a document.
 */
export async function getDocumentFileBuffer(
  id: string,
  userId?: string
): Promise<{ buffer: Buffer; mimeType: string; originalFilename: string } | null> {
  if (!validateDocumentId(id)) return null

  const doc = await getDocumentById(id, userId)
  if (!doc) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const buffer = await downloadPrivateDocumentBlob(doc.storageFilename, scopedUser)
    if (!buffer) return null
    return {
      buffer,
      mimeType: doc.mimeType,
      originalFilename: doc.originalFilename,
    }
  }

  const { documentsDir } = getPaths(userId)
  const filePath = path.resolve(documentsDir, doc.storageFilename)
  if (!filePath.startsWith(documentsDir + path.sep)) return null

  try {
    const buffer = await fs.readFile(filePath)
    return {
      buffer,
      mimeType: doc.mimeType,
      originalFilename: doc.originalFilename,
    }
  } catch {
    return null
  }
}

/**
 * Updates a document's metadata in persistent storage.
 */
export async function updateDocument(
  id: string,
  updates: Partial<StoredDocument>,
  userId?: string
): Promise<StoredDocument | null> {
  if (!validateDocumentId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existing = await getDocumentById(id, scopedUser)
    if (!existing) return null

    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_documents')
      .update({
        original_filename: updates.originalFilename ?? existing.originalFilename,
        mime_type: updates.mimeType ?? existing.mimeType,
        file_size: updates.fileSize ?? existing.fileSize,
        extraction_status: updates.extractionStatus ?? existing.extractionStatus,
        extracted_data: updates.extractedData !== undefined ? updates.extractedData : existing.extractedData,
        extraction_error:
          updates.extractionError !== undefined ? updates.extractionError : existing.extractionError ?? null,
      })
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('*')
      .maybeSingle()

    if (res.error) throw new Error(`updateDocument failed: ${res.error.message}`)
    return res.data ? rowToDocument(res.data) : null
  }

  const { metadataFile } = getPaths(userId)

  return withFileLock(metadataFile, async () => {
    const metadata = await readMetadata(userId)
    const existing = metadata[id]
    if (!existing) return null

    const updated: StoredDocument = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID mutation
      storageFilename: existing.storageFilename,
    }

    metadata[id] = updated
    await writeMetadata(metadata, userId)
    return updated
  })
}

/**
 * Deletes a stored document and its physical file / Private Blob.
 */
export async function deleteDocument(id: string, userId?: string): Promise<boolean> {
  if (!validateDocumentId(id)) return false

  let removedDoc: StoredDocument | null = null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_documents')
      .delete()
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('*')
      .maybeSingle()

    if (error) throw new Error(`deleteDocument failed: ${error.message}`)
    if (!data) return false
    removedDoc = rowToDocument(data)
    await deletePrivateDocumentBlob(removedDoc.storageFilename, scopedUser)
  } else {
    const { documentsDir, metadataFile } = getPaths(userId)

    removedDoc = await withFileLock(metadataFile, async () => {
      const metadata = await readMetadata(userId)
      const doc = metadata[id]
      if (!doc) return null

      delete metadata[id]
      await writeMetadata(metadata, userId)
      return doc
    })

    if (!removedDoc) return false

    // Delete physical file
    const filePath = path.resolve(documentsDir, removedDoc.storageFilename)
    if (filePath.startsWith(documentsDir + path.sep)) {
      try {
        await fs.unlink(filePath)
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          console.warn('Warning: Could not remove file during deletion:', err)
        }
      }
    }
  }

  // Safely unlink tasks, products, and contacts referencing this deleted document
  try {
    await handleDocumentDeleted(id, userId)
  } catch (err) {
    console.warn('Warning: Could not unlink tasks for deleted document:', err)
  }

  try {
    await handleDocumentDeletedForProducts(id, userId)
  } catch (err) {
    console.warn('Warning: Could not unlink products for deleted document:', err)
  }

  try {
    await handleDocumentDeletedForContacts(id, userId)
  } catch (err) {
    console.warn('Warning: Could not unlink contacts for deleted document:', err)
  }

  return true
}
