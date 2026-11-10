import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import crypto from 'node:crypto'
import type { StoredDocument } from '../lifefile/types.ts'
import type {
  ProductDocumentRole,
  StoredProduct,
  WarrantyStatus,
} from './types.ts'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../storage/atomic-json.ts'
import { resolveScopedBaseDir, resolveScopedJsonFile, validateUserId } from '../storage/user-scope.ts'
import { getStorageBackendMode } from '../storage/backend.ts'
import { getSupabaseAdmin, unwrapSupabaseResult } from '../storage/supabase-client.ts'

const PRODUCT_ID_REGEX = /^prod_[0-9]+_[a-f0-9]+$/

function requireCloudUserId(userId?: string): string {
  if (!userId || !validateUserId(userId)) {
    throw new Error('Authenticated userId scope is required in cloud storage mode.')
  }
  return userId
}

function rowToProduct(row: any, referenceDate?: string): StoredProduct {
  const warrantyExpiry = row.warranty_expiry ?? null
  return {
    id: row.id,
    productName: row.product_name,
    brand: row.brand ?? null,
    modelNumber: row.model_number ?? null,
    serialNumber: row.serial_number ?? null,
    purchaseDate: row.purchase_date ?? null,
    warrantyExpiry,
    warrantyDuration: row.warranty_duration ?? null,
    warrantyStatus: computeWarrantyStatus(warrantyExpiry, referenceDate),
    linkedDocumentIds: Array.isArray(row.linked_document_ids) ? row.linked_document_ids : [],
    documentRoles: row.document_roles && typeof row.document_roles === 'object' ? row.document_roles : {},
    source: row.source,
    notes: row.notes ?? null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(row.updated_at).toISOString(),
  }
}

function productToRow(prod: StoredProduct, userId: string) {
  return {
    id: prod.id,
    user_id: userId,
    product_name: prod.productName,
    brand: prod.brand,
    model_number: prod.modelNumber,
    serial_number: prod.serialNumber,
    purchase_date: prod.purchaseDate,
    warranty_expiry: prod.warrantyExpiry,
    warranty_duration: prod.warrantyDuration,
    warranty_status: prod.warrantyStatus,
    linked_document_ids: prod.linkedDocumentIds,
    document_roles: prod.documentRoles,
    source: prod.source,
    notes: prod.notes ?? null,
    created_at: prod.createdAt,
    updated_at: prod.updatedAt,
  }
}

function getProductsFile(userId?: string): string {
  return resolveScopedJsonFile('products.json', userId)
}

async function ensureDirectory(userId?: string): Promise<string> {
  const baseDir = resolveScopedBaseDir(userId)
  if (!fsSync.existsSync(baseDir)) {
    await fs.mkdir(baseDir, { recursive: true })
  }
  return getProductsFile(userId)
}

async function readProducts(userId?: string): Promise<Record<string, StoredProduct>> {
  const file = await ensureDirectory(userId)
  return readJsonSafe<Record<string, StoredProduct>>(file, {})
}

async function writeProducts(data: Record<string, StoredProduct>, userId?: string): Promise<void> {
  const file = await ensureDirectory(userId)
  await writeJsonAtomic(file, data)
}

export function generateProductId(): string {
  return `prod_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

export function validateProductId(id: string): boolean {
  return PRODUCT_ID_REGEX.test(id)
}

/**
 * Computes warranty status relative to an optional reference YYYY-MM-DD date.
 */
export function computeWarrantyStatus(
  warrantyExpiry: string | null | undefined,
  referenceDate?: string
): WarrantyStatus {
  if (!warrantyExpiry) return 'unknown'
  const parsed = new Date(warrantyExpiry)
  if (Number.isNaN(parsed.getTime())) return 'unknown'

  const refStr = referenceDate || new Date().toISOString().split('T')[0]
  const refTime = new Date(refStr).getTime()
  const expTime = parsed.getTime()
  const diffDays = Math.ceil((expTime - refTime) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'expired'
  if (diffDays <= 60) return 'expiring_soon'
  return 'active'
}

function normalizeTokenText(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeIdentifier(value: string | null | undefined): string {
  if (!value) return ''
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

function inferDocumentRole(doc: StoredDocument): ProductDocumentRole {
  const type = doc.extractedData?.documentType
  const nameLower = doc.originalFilename.toLowerCase()
  const summaryLower = (doc.extractedData?.summary || '').toLowerCase()

  if (type === 'Invoice') return 'invoice'
  if (type === 'Warranty') return 'warranty'
  if (type === 'Manual' || nameLower.includes('manual') || nameLower.includes('guide')) return 'manual'
  if (
    nameLower.includes('service') ||
    nameLower.includes('repair') ||
    summaryLower.includes('service') ||
    summaryLower.includes('repair')
  ) {
    return 'service'
  }
  if (type === 'Receipt') return 'invoice'
  return 'other'
}

/**
 * Checks whether two product records represent the same physical product to prevent duplicates.
 */
export function isSameProductCandidate(
  existing: Pick<StoredProduct, 'productName' | 'brand' | 'modelNumber' | 'serialNumber'>,
  candidate: {
    productName?: string | null
    brand?: string | null
    modelNumber?: string | null
    serialNumber?: string | null
  }
): boolean {
  const existingSerial = normalizeIdentifier(existing.serialNumber)
  const candSerial = normalizeIdentifier(candidate.serialNumber)
  if (existingSerial && candSerial) {
    return existingSerial === candSerial
  }

  const existingModel = normalizeIdentifier(existing.modelNumber)
  const candModel = normalizeIdentifier(candidate.modelNumber)
  const existingBrand = normalizeTokenText(existing.brand)
  const candBrand = normalizeTokenText(candidate.brand)

  if (existingModel && candModel && existingModel === candModel) {
    if (!existingBrand || !candBrand || existingBrand === candBrand || existingBrand.includes(candBrand) || candBrand.includes(existingBrand)) {
      return true
    }
  }

  const existingName = normalizeTokenText(existing.productName)
  const candName = normalizeTokenText(candidate.productName)
  if (!existingName || !candName) return false

  if (existingName === candName) {
    if (!existingBrand || !candBrand || existingBrand === candBrand || existingBrand.includes(candBrand) || candBrand.includes(existingBrand)) {
      return true
    }
  }

  const existingTokens = existingName.split(' ').filter((t) => t.length > 1)
  const candTokens = candName.split(' ').filter((t) => t.length > 1)
  const shorter = existingTokens.length <= candTokens.length ? existingTokens : candTokens
  const longer = existingTokens.length <= candTokens.length ? candTokens : existingTokens

  if (shorter.length >= 2) {
    const allMatch = shorter.every((t) => longer.includes(t))
    if (allMatch) {
      if (!existingBrand || !candBrand || existingBrand === candBrand || existingBrand.includes(candBrand) || candBrand.includes(existingBrand)) {
        return true
      }
    }
  }

  return false
}

function isProductDocument(doc: StoredDocument): boolean {
  if (doc.extractionStatus !== 'completed' || !doc.extractedData) return false
  const data = doc.extractedData

  if (
    data.documentType === 'Invoice' ||
    data.documentType === 'Warranty' ||
    data.documentType === 'Manual'
  ) {
    return Boolean(data.productName || data.modelNumber || data.serialNumber || data.warrantyExpiry)
  }

  if (data.documentType === 'Receipt' || data.documentType === 'Bill' || data.documentType === 'Other') {
    return Boolean(data.productName || data.serialNumber || data.modelNumber)
  }

  return false
}

export async function getAllProducts(referenceDate?: string, userId?: string): Promise<StoredProduct[]> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_products')
      .select('*')
      .eq('user_id', scopedUser)
      .order('updated_at', { ascending: false })
    const rows = unwrapSupabaseResult(res, 'getAllProducts')
    return rows.map((r) => rowToProduct(r, referenceDate))
  }

  const map = await readProducts(userId)
  return Object.values(map)
    .map((p) => ({
      ...p,
      warrantyStatus: computeWarrantyStatus(p.warrantyExpiry, referenceDate),
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export async function getProductById(id: string, referenceDate?: string, userId?: string): Promise<StoredProduct | null> {
  if (!validateProductId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_products')
      .select('*')
      .eq('id', id)
      .eq('user_id', scopedUser)
      .maybeSingle()
    if (error) throw new Error(`getProductById failed: ${error.message}`)
    return data ? rowToProduct(data, referenceDate) : null
  }

  const map = await readProducts(userId)
  const prod = map[id]
  if (!prod) return null
  return {
    ...prod,
    warrantyStatus: computeWarrantyStatus(prod.warrantyExpiry, referenceDate),
  }
}

export async function saveProduct(
  input: {
    productName: string
    brand?: string | null
    modelNumber?: string | null
    serialNumber?: string | null
    purchaseDate?: string | null
    warrantyExpiry?: string | null
    warrantyDuration?: string | null
    linkedDocumentIds?: string[]
    documentRoles?: Record<string, ProductDocumentRole>
    source?: 'auto' | 'manual'
    notes?: string | null
  },
  userId?: string
): Promise<{ product: StoredProduct; duplicateFound: boolean }> {
  const buildResult = (existingList: StoredProduct[]) => {
    const duplicate = existingList.find((p) =>
      isSameProductCandidate(p, {
        productName: input.productName,
        brand: input.brand,
        modelNumber: input.modelNumber,
        serialNumber: input.serialNumber,
      })
    )

    if (duplicate) {
      const mergedDocs = Array.from(
        new Set([...(duplicate.linkedDocumentIds || []), ...(input.linkedDocumentIds || [])])
      )
      const updated: StoredProduct = {
        ...duplicate,
        brand: duplicate.brand || input.brand || null,
        modelNumber: duplicate.modelNumber || input.modelNumber || null,
        serialNumber: duplicate.serialNumber || input.serialNumber || null,
        purchaseDate: duplicate.purchaseDate || input.purchaseDate || null,
        warrantyExpiry: duplicate.warrantyExpiry || input.warrantyExpiry || null,
        warrantyDuration: duplicate.warrantyDuration || input.warrantyDuration || null,
        linkedDocumentIds: mergedDocs,
        documentRoles: {
          ...(duplicate.documentRoles || {}),
          ...(input.documentRoles || {}),
        },
        notes: duplicate.notes || input.notes || null,
        updatedAt: new Date().toISOString(),
      }
      updated.warrantyStatus = computeWarrantyStatus(updated.warrantyExpiry)
      return { product: updated, duplicateFound: true }
    }

    const id = generateProductId()
    const now = new Date().toISOString()
    const newProduct: StoredProduct = {
      id,
      productName: input.productName.trim(),
      brand: input.brand?.trim() || null,
      modelNumber: input.modelNumber?.trim() || null,
      serialNumber: input.serialNumber?.trim() || null,
      purchaseDate: input.purchaseDate?.trim() || null,
      warrantyExpiry: input.warrantyExpiry?.trim() || null,
      warrantyDuration: input.warrantyDuration?.trim() || null,
      warrantyStatus: computeWarrantyStatus(input.warrantyExpiry),
      linkedDocumentIds: Array.from(new Set(input.linkedDocumentIds || [])),
      documentRoles: input.documentRoles || {},
      source: input.source || 'manual',
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    }
    return { product: newProduct, duplicateFound: false }
  }

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existingList = await getAllProducts(undefined, scopedUser)
    const outcome = buildResult(existingList)
    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_products')
      .upsert(productToRow(outcome.product, scopedUser))
      .select('*')
      .single()
    const row = unwrapSupabaseResult(res, 'saveProduct')
    return { product: rowToProduct(row), duplicateFound: outcome.duplicateFound }
  }

  const file = getProductsFile(userId)
  return withFileLock(file, async () => {
    await ensureDirectory(userId)
    const map = await readProducts(userId)
    const outcome = buildResult(Object.values(map))
    map[outcome.product.id] = outcome.product
    await writeProducts(map, userId)
    return outcome
  })
}

export async function updateProduct(
  id: string,
  updates: Partial<Omit<StoredProduct, 'id' | 'createdAt'>>,
  userId?: string
): Promise<StoredProduct | null> {
  if (!validateProductId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existing = await getProductById(id, undefined, scopedUser)
    if (!existing) return null

    const updated: StoredProduct = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    updated.warrantyStatus = computeWarrantyStatus(updated.warrantyExpiry)

    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_products')
      .update(productToRow(updated, scopedUser))
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('*')
      .maybeSingle()

    const row = unwrapSupabaseResult(res, 'updateProduct')
    return row ? rowToProduct(row) : null
  }

  const file = getProductsFile(userId)
  return withFileLock(file, async () => {
    const map = await readProducts(userId)
    const existing = map[id]
    if (!existing) return null

    const updated: StoredProduct = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    }
    updated.warrantyStatus = computeWarrantyStatus(updated.warrantyExpiry)

    map[id] = updated
    await writeProducts(map, userId)
    return updated
  })
}

export async function deleteProduct(id: string, userId?: string): Promise<boolean> {
  if (!validateProductId(id)) return false

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_products')
      .delete()
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`deleteProduct failed: ${error.message}`)
    return Boolean(data)
  }

  const file = getProductsFile(userId)
  return withFileLock(file, async () => {
    const map = await readProducts(userId)
    if (!map[id]) return false
    delete map[id]
    await writeProducts(map, userId)
    return true
  })
}

/**
 * Synchronizes product records from LifeFile documents (Invoices, Warranties, Manuals, Service records),
 * deduplicating across documents belonging to the same product and linking all relevant documents.
 */
export async function syncProductsFromLifeFile(
  documents: StoredDocument[],
  productsOverride?: StoredProduct[],
  userId?: string
): Promise<{
  added: StoredProduct[]
  updated: StoredProduct[]
  skippedCount: number
  allProducts: StoredProduct[]
}> {
  const isInMemory = Array.isArray(productsOverride)
  const useCloud = !isInMemory && getStorageBackendMode() === 'cloud'
  const map: Record<string, StoredProduct> = {}

  if (isInMemory) {
    for (const p of productsOverride) {
      map[p.id] = { ...p, linkedDocumentIds: [...p.linkedDocumentIds], documentRoles: { ...p.documentRoles } }
    }
  } else if (useCloud) {
    const scopedUser = requireCloudUserId(userId)
    const list = await getAllProducts(undefined, scopedUser)
    for (const p of list) map[p.id] = p
  } else {
    Object.assign(map, await readProducts(userId))
  }

  const added: StoredProduct[] = []
  const updated: StoredProduct[] = []
  let skippedCount = 0
  let dirty = false

  for (const doc of documents) {
    if (!isProductDocument(doc)) continue
    const data = doc.extractedData!
    const candidateName =
      data.productName ||
      (data.issuer && data.modelNumber ? `${data.issuer} ${data.modelNumber}` : null) ||
      (data.issuer ? `${data.issuer} Product` : doc.originalFilename.replace(/\.[^.]+$/, ''))

    const candidateBrand = data.issuer || null
    const role = inferDocumentRole(doc)

    const existingList = Object.values(map)
    const matched = existingList.find((p) =>
      isSameProductCandidate(p, {
        productName: candidateName,
        brand: candidateBrand,
        modelNumber: data.modelNumber,
        serialNumber: data.serialNumber,
      })
    )

    if (matched) {
      const alreadyLinked = matched.linkedDocumentIds.includes(doc.id)
      const needsFieldMerge =
        (!matched.brand && candidateBrand) ||
        (!matched.modelNumber && data.modelNumber) ||
        (!matched.serialNumber && data.serialNumber) ||
        (!matched.purchaseDate && (data.purchaseDate || data.documentDate)) ||
        (!matched.warrantyExpiry && data.warrantyExpiry) ||
        (!matched.warrantyDuration && data.warrantyDuration) ||
        matched.documentRoles?.[doc.id] !== role

      if (alreadyLinked && !needsFieldMerge) {
        skippedCount++
        continue
      }

      const nextLinked = Array.from(new Set([...matched.linkedDocumentIds, doc.id]))
      const nextPurchaseDate =
        matched.purchaseDate ||
        data.purchaseDate ||
        (data.documentType === 'Invoice' ? data.documentDate : null)

      const merged: StoredProduct = {
        ...matched,
        brand: matched.brand || candidateBrand,
        modelNumber: matched.modelNumber || data.modelNumber || null,
        serialNumber: matched.serialNumber || data.serialNumber || null,
        purchaseDate: nextPurchaseDate,
        warrantyExpiry: matched.warrantyExpiry || data.warrantyExpiry || null,
        warrantyDuration: matched.warrantyDuration || data.warrantyDuration || null,
        linkedDocumentIds: nextLinked,
        documentRoles: {
          ...(matched.documentRoles || {}),
          [doc.id]: role,
        },
        updatedAt: new Date().toISOString(),
      }
      merged.warrantyStatus = computeWarrantyStatus(merged.warrantyExpiry)
      map[matched.id] = merged
      if (!updated.some((u) => u.id === merged.id)) {
        updated.push(merged)
      }
      dirty = true
    } else {
      const id = generateProductId()
      const now = new Date().toISOString()
      const purchaseDate =
        data.purchaseDate || (data.documentType === 'Invoice' ? data.documentDate : null)

      const created: StoredProduct = {
        id,
        productName: candidateName,
        brand: candidateBrand,
        modelNumber: data.modelNumber || null,
        serialNumber: data.serialNumber || null,
        purchaseDate,
        warrantyExpiry: data.warrantyExpiry || null,
        warrantyDuration: data.warrantyDuration || null,
        warrantyStatus: computeWarrantyStatus(data.warrantyExpiry),
        linkedDocumentIds: [doc.id],
        documentRoles: { [doc.id]: role },
        source: 'auto',
        notes: data.summary || null,
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
      const changedRows = [...added, ...updated].map((p) => productToRow(p, scopedUser))
      if (changedRows.length > 0) {
        const sb = getSupabaseAdmin()
        const res = await sb.from('aura_products').upsert(changedRows)
        if (res.error) throw new Error(`syncProductsFromLifeFile upsert failed: ${res.error.message}`)
      }
    } else {
      await writeProducts(map, userId)
    }
  }

  return {
    added,
    updated,
    skippedCount,
    allProducts: Object.values(map),
  }
}

/**
 * Unlinks a deleted document from all stored product records.
 */
export async function handleDocumentDeletedForProducts(documentId: string, userId?: string): Promise<number> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const list = await getAllProducts(undefined, scopedUser)
    const modifiedRows: StoredProduct[] = []

    for (const prod of list) {
      if (prod.linkedDocumentIds.includes(documentId)) {
        prod.linkedDocumentIds = prod.linkedDocumentIds.filter((id) => id !== documentId)
        if (prod.documentRoles && prod.documentRoles[documentId]) {
          delete prod.documentRoles[documentId]
        }
        prod.updatedAt = new Date().toISOString()
        modifiedRows.push(prod)
      }
    }

    if (modifiedRows.length > 0) {
      const sb = getSupabaseAdmin()
      const res = await sb
        .from('aura_products')
        .upsert(modifiedRows.map((p) => productToRow(p, scopedUser)))
      if (res.error) throw new Error(`handleDocumentDeletedForProducts upsert failed: ${res.error.message}`)
    }
    return modifiedRows.length
  }

  const map = await readProducts(userId)
  let modified = 0

  for (const prod of Object.values(map)) {
    if (prod.linkedDocumentIds.includes(documentId)) {
      prod.linkedDocumentIds = prod.linkedDocumentIds.filter((id) => id !== documentId)
      if (prod.documentRoles && prod.documentRoles[documentId]) {
        delete prod.documentRoles[documentId]
      }
      prod.updatedAt = new Date().toISOString()
      modified++
    }
  }

  if (modified > 0) {
    await writeProducts(map, userId)
  }
  return modified
}
