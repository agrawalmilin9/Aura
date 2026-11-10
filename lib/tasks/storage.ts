import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import crypto from 'node:crypto'
import type { StoredTask, TaskCategory, TaskPriority, TaskRecurrence, TaskStatus } from './types.ts'
import type { StoredDocument } from '../lifefile/types.ts'
import { normalizeDate } from './categorization.ts'
import { readJsonSafe, withFileLock, writeJsonAtomic } from '../storage/atomic-json.ts'
import { resolveScopedBaseDir, resolveScopedJsonFile, validateUserId } from '../storage/user-scope.ts'
import { getStorageBackendMode } from '../storage/backend.ts'
import { getSupabaseAdmin, unwrapSupabaseResult } from '../storage/supabase-client.ts'

const TASK_ID_REGEX = /^task_[0-9]+_[a-f0-9]+$/

function requireCloudUserId(userId?: string): string {
  if (!userId || !validateUserId(userId)) {
    throw new Error('Authenticated userId scope is required in cloud storage mode.')
  }
  return userId
}

function rowToTask(row: any): StoredTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    dueDate: row.due_date,
    status: row.status,
    priority: row.priority,
    linkedDocumentId: row.linked_document_id ?? null,
    linkedDocumentName: row.linked_document_name ?? null,
    source: row.source,
    recurrence: row.recurrence ?? 'none',
    snoozeCount: Number(row.snooze_count || 0),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(row.updated_at).toISOString(),
    reminder: row.reminder ?? null,
  }
}

function taskToRow(task: StoredTask, userId: string) {
  return {
    id: task.id,
    user_id: userId,
    title: task.title,
    description: task.description,
    category: task.category,
    due_date: task.dueDate,
    status: task.status,
    priority: task.priority,
    linked_document_id: task.linkedDocumentId,
    linked_document_name: task.linkedDocumentName ?? null,
    source: task.source,
    recurrence: task.recurrence || 'none',
    snooze_count: task.snoozeCount || 0,
    reminder: task.reminder ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  }
}

function getTasksFile(userId?: string): string {
  return resolveScopedJsonFile('tasks.json', userId)
}

/**
 * Ensures storage directories exist on server initialization.
 */
async function ensureTasksDirectory(userId?: string): Promise<string> {
  const baseDir = resolveScopedBaseDir(userId)
  if (!fsSync.existsSync(baseDir)) {
    await fs.mkdir(baseDir, { recursive: true })
  }
  return getTasksFile(userId)
}

async function readTasks(userId?: string): Promise<Record<string, StoredTask>> {
  const file = await ensureTasksDirectory(userId)
  return readJsonSafe<Record<string, StoredTask>>(file, {})
}

async function writeTasks(data: Record<string, StoredTask>, userId?: string): Promise<void> {
  const file = await ensureTasksDirectory(userId)
  await writeJsonAtomic(file, data)
}

/**
 * Advances a YYYY-MM-DD date cleanly by the recurrence interval.
 */
export function computeNextRecurringDueDate(currentDueDate: string, recurrence: TaskRecurrence): string {
  const normalized = normalizeDate(currentDueDate)
  const [y, m, d] = normalized.split('-').map(Number)
  if (!y || !m || !d || recurrence === 'none') return normalized

  const monthsToAdd = recurrence === 'monthly' ? 1 : recurrence === 'quarterly' ? 3 : 12
  const targetMonthIndex = m - 1 + monthsToAdd
  const targetYear = y + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const maxDayInMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const clampedDay = Math.min(d, maxDayInMonth)

  const mm = String(targetMonth + 1).padStart(2, '0')
  const dd = String(clampedDay).padStart(2, '0')
  return `${targetYear}-${mm}-${dd}`
}

/**
 * Generates a unique task ID.
 */
export function generateTaskId(): string {
  const timestamp = Date.now()
  const random = crypto.randomBytes(4).toString('hex')
  return `task_${timestamp}_${random}`
}

/**
 * Validates task ID format.
 */
export function validateTaskId(id: string): boolean {
  return TASK_ID_REGEX.test(id)
}

function sortTasks(list: StoredTask[]): StoredTask[] {
  return list.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1
    if (a.status !== 'pending' && b.status === 'pending') return 1
    return a.dueDate.localeCompare(b.dueDate)
  })
}

/**
 * Retrieves all stored tasks ordered by due date ascending.
 */
export async function getAllTasks(userId?: string): Promise<StoredTask[]> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const res = await sb.from('aura_tasks').select('*').eq('user_id', scopedUser)
    const rows = unwrapSupabaseResult(res, 'getAllTasks')
    return sortTasks(rows.map(rowToTask))
  }

  const tasksMap = await readTasks(userId)
  return sortTasks(Object.values(tasksMap))
}

/**
 * Retrieves a single task by ID.
 */
export async function getTaskById(id: string, userId?: string): Promise<StoredTask | null> {
  if (!validateTaskId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_tasks')
      .select('*')
      .eq('id', id)
      .eq('user_id', scopedUser)
      .maybeSingle()
    if (error) throw new Error(`getTaskById failed: ${error.message}`)
    return data ? rowToTask(data) : null
  }

  const tasksMap = await readTasks(userId)
  return tasksMap[id] || null
}

/**
 * Creates and saves a new task manually.
 */
export async function saveTask(
  taskInput: Omit<StoredTask, 'id' | 'createdAt' | 'updatedAt'>,
  userId?: string
): Promise<StoredTask> {
  const id = generateTaskId()
  const now = new Date().toISOString()
  const cleanDueDate = normalizeDate(taskInput.dueDate)

  const newTask: StoredTask = {
    ...taskInput,
    id,
    dueDate: cleanDueDate,
    recurrence: taskInput.recurrence || 'none',
    snoozeCount: taskInput.snoozeCount || 0,
    createdAt: now,
    updatedAt: now,
  }

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_tasks')
      .insert(taskToRow(newTask, scopedUser))
      .select('*')
      .single()
    const row = unwrapSupabaseResult(res, 'saveTask')
    return rowToTask(row)
  }

  const tasksFile = getTasksFile(userId)
  return withFileLock(tasksFile, async () => {
    await ensureTasksDirectory(userId)
    const tasksMap = await readTasks(userId)
    tasksMap[id] = newTask
    await writeTasks(tasksMap, userId)
    return newTask
  })
}

function buildNextRecurringTask(updated: StoredTask, now: string): StoredTask | null {
  const recurrence = updated.recurrence || 'none'
  if (recurrence === 'none') return null
  const nextDueDate = computeNextRecurringDueDate(updated.dueDate, recurrence)
  return {
    id: generateTaskId(),
    title: updated.title,
    description: updated.description,
    category: updated.category,
    dueDate: nextDueDate,
    status: 'pending',
    priority: calculatePriority(nextDueDate),
    linkedDocumentId: updated.linkedDocumentId,
    linkedDocumentName: updated.linkedDocumentName,
    source: updated.source,
    recurrence,
    snoozeCount: 0,
    createdAt: now,
    updatedAt: now,
    reminder: {
      reminderDate: nextDueDate,
      enabled: updated.reminder?.enabled !== false,
      timezone: updated.reminder?.timezone,
    },
  }
}

/**
 * Updates an existing task. If a recurring task transitions to 'completed',
 * schedules the next occurrence automatically without creating duplicates.
 */
export async function updateTask(
  id: string,
  updates: Partial<Omit<StoredTask, 'id' | 'createdAt'>>,
  userId?: string
): Promise<StoredTask | null> {
  if (!validateTaskId(id)) return null

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existing = await getTaskById(id, scopedUser)
    if (!existing) return null

    const now = new Date().toISOString()
    const updated: StoredTask = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
      dueDate: updates.dueDate ? normalizeDate(updates.dueDate) : existing.dueDate,
    }

    const sb = getSupabaseAdmin()
    const updRes = await sb
      .from('aura_tasks')
      .update(taskToRow(updated, scopedUser))
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('*')
      .maybeSingle()

    const savedRow = unwrapSupabaseResult(updRes, 'updateTask')

    if (existing.status !== 'completed' && updated.status === 'completed' && (updated.recurrence || 'none') !== 'none') {
      const nextTask = buildNextRecurringTask(updated, now)
      if (nextTask) {
        const dupRes = await sb
          .from('aura_tasks')
          .select('id')
          .eq('user_id', scopedUser)
          .eq('status', 'pending')
          .eq('title', updated.title)
          .eq('category', updated.category)
          .eq('due_date', nextTask.dueDate)
          .limit(1)
        if (!dupRes.error && (!dupRes.data || dupRes.data.length === 0)) {
          await sb.from('aura_tasks').insert(taskToRow(nextTask, scopedUser))
        }
      }
    }

    return savedRow ? rowToTask(savedRow) : null
  }

  const tasksFile = getTasksFile(userId)

  return withFileLock(tasksFile, async () => {
    const tasksMap = await readTasks(userId)
    const existing = tasksMap[id]
    if (!existing) return null

    const now = new Date().toISOString()
    const updated: StoredTask = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
      dueDate: updates.dueDate ? normalizeDate(updates.dueDate) : existing.dueDate,
    }

    tasksMap[id] = updated

    const recurrence = updated.recurrence || 'none'
    if (existing.status !== 'completed' && updated.status === 'completed' && recurrence !== 'none') {
      const nextDueDate = computeNextRecurringDueDate(updated.dueDate, recurrence)
      const duplicateNext = Object.values(tasksMap).some(
        (t) =>
          t.status === 'pending' &&
          t.title === updated.title &&
          t.category === updated.category &&
          t.dueDate === nextDueDate
      )
      if (!duplicateNext) {
        const nextTask = buildNextRecurringTask(updated, now)
        if (nextTask) {
          tasksMap[nextTask.id] = nextTask
        }
      }
    }

    await writeTasks(tasksMap, userId)
    return updated
  })
}

/**
 * Snoozes a task's due date forward by the specified number of days (1..365).
 */
export async function snoozeTask(
  id: string,
  days: number,
  referenceDate?: string,
  userId?: string
): Promise<StoredTask | null> {
  if (!validateTaskId(id)) return null
  const clampedDays = Math.max(1, Math.min(365, Math.floor(days)))

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existing = await getTaskById(id, scopedUser)
    if (!existing) return null

    const todayStr = normalizeDate(referenceDate)
    const baseStr = existing.dueDate > todayStr ? existing.dueDate : todayStr
    const baseDate = new Date(`${baseStr}T00:00:00Z`)
    baseDate.setUTCDate(baseDate.getUTCDate() + clampedDays)
    const nextDue = baseDate.toISOString().split('T')[0]

    const updated: StoredTask = {
      ...existing,
      status: 'pending',
      dueDate: nextDue,
      priority: calculatePriority(nextDue),
      snoozeCount: (existing.snoozeCount || 0) + 1,
      reminder: {
        reminderDate: nextDue,
        enabled: true,
        timezone: existing.reminder?.timezone,
      },
      updatedAt: new Date().toISOString(),
    }

    const sb = getSupabaseAdmin()
    const res = await sb
      .from('aura_tasks')
      .update(taskToRow(updated, scopedUser))
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('*')
      .maybeSingle()

    const row = unwrapSupabaseResult(res, 'snoozeTask')
    return row ? rowToTask(row) : null
  }

  const tasksFile = getTasksFile(userId)

  return withFileLock(tasksFile, async () => {
    const tasksMap = await readTasks(userId)
    const existing = tasksMap[id]
    if (!existing) return null

    const todayStr = normalizeDate(referenceDate)
    const baseStr = existing.dueDate > todayStr ? existing.dueDate : todayStr
    const baseDate = new Date(`${baseStr}T00:00:00Z`)
    baseDate.setUTCDate(baseDate.getUTCDate() + clampedDays)
    const nextDue = baseDate.toISOString().split('T')[0]

    const updated: StoredTask = {
      ...existing,
      status: 'pending',
      dueDate: nextDue,
      priority: calculatePriority(nextDue),
      snoozeCount: (existing.snoozeCount || 0) + 1,
      reminder: {
        reminderDate: nextDue,
        enabled: true,
        timezone: existing.reminder?.timezone,
      },
      updatedAt: new Date().toISOString(),
    }

    tasksMap[id] = updated
    await writeTasks(tasksMap, userId)
    return updated
  })
}

/**
 * Updates the status of a task (pending, completed, dismissed).
 */
export async function markTaskStatus(
  id: string,
  status: TaskStatus,
  userId?: string
): Promise<StoredTask | null> {
  return updateTask(id, { status }, userId)
}

/**
 * Permanently deletes a task.
 */
export async function deleteTask(id: string, userId?: string): Promise<boolean> {
  if (!validateTaskId(id)) return false

  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', scopedUser)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`deleteTask failed: ${error.message}`)
    return Boolean(data)
  }

  const tasksFile = getTasksFile(userId)

  return withFileLock(tasksFile, async () => {
    const tasksMap = await readTasks(userId)
    if (!tasksMap[id]) return false

    delete tasksMap[id]
    await writeTasks(tasksMap, userId)
    return true
  })
}

/**
 * Computes suggested priority based on days remaining until due date.
 */
function calculatePriority(dueDate: string): TaskPriority {
  const today = new Date().toISOString().split('T')[0]
  const diffDays = Math.ceil(
    (new Date(dueDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)
  )

  if (diffDays <= 7) return 'high'
  if (diffDays <= 30) return 'medium'
  return 'low'
}

function computePotentialDocumentTasks(
  documents: StoredDocument[],
  existingTasks: StoredTask[]
): { added: StoredTask[]; skippedCount: number } {
  const added: StoredTask[] = []
  let skippedCount = 0

  for (const doc of documents) {
    if (doc.extractionStatus !== 'completed' || !doc.extractedData) {
      continue
    }

    const data = doc.extractedData
    const potentialTasks: Array<{
      title: string
      description: string
      category: TaskCategory
      dueDate: string
      priority: TaskPriority
      recurrence: TaskRecurrence
    }> = []

    if (
      data.dueDate &&
      (data.documentType === 'Bill' ||
        (data.documentType !== 'Insurance' && data.documentType !== 'Warranty' && data.totalAmount !== null))
    ) {
      const issuerName = data.issuer || 'Utility'
      const amountStr = data.totalAmount !== null ? `${data.currency || '₹'}${data.totalAmount}` : ''
      potentialTasks.push({
        title: `Pay ${issuerName} bill`,
        description: `${amountStr ? `${amountStr} ` : ''}due on ${data.dueDate}. Found in ${doc.originalFilename}.`,
        category: 'bill',
        dueDate: normalizeDate(data.dueDate),
        priority: calculatePriority(data.dueDate),
        recurrence: data.documentType === 'Bill' ? 'monthly' : 'none',
      })
    }

    const insuranceDeadline = data.expiryDate || data.dueDate
    if (insuranceDeadline && data.documentType === 'Insurance') {
      const issuerName = data.issuer || 'Health/Vehicle'
      const policyStr = data.policyNumber ? ` (Policy: ${data.policyNumber})` : ''
      potentialTasks.push({
        title: `Renew ${issuerName} insurance policy`,
        description: `Policy renewal due on ${insuranceDeadline}${policyStr}. Found in ${doc.originalFilename}.`,
        category: 'insurance',
        dueDate: normalizeDate(insuranceDeadline),
        priority: calculatePriority(insuranceDeadline),
        recurrence: 'yearly',
      })
    }

    if (data.warrantyExpiry) {
      const prodName = data.productName || data.issuer || 'Product'
      const durationStr = data.warrantyDuration ? ` (${data.warrantyDuration})` : ''
      potentialTasks.push({
        title: `Warranty expiry: ${prodName}`,
        description: `Warranty coverage${durationStr} expires on ${data.warrantyExpiry}. Found in ${doc.originalFilename}.`,
        category: 'warranty',
        dueDate: normalizeDate(data.warrantyExpiry),
        priority: calculatePriority(data.warrantyExpiry),
        recurrence: 'none',
      })
    }

    if (data.expiryDate && data.documentType === 'Contract') {
      potentialTasks.push({
        title: `Contract renewal: ${data.issuer || doc.originalFilename}`,
        description: `Contract agreement ends on ${data.expiryDate}. Found in ${doc.originalFilename}.`,
        category: 'subscription',
        dueDate: normalizeDate(data.expiryDate),
        priority: calculatePriority(data.expiryDate),
        recurrence: 'yearly',
      })
    }

    for (const pt of potentialTasks) {
      const isDuplicate = existingTasks.some(
        (existing) =>
          existing.linkedDocumentId === doc.id &&
          existing.category === pt.category &&
          existing.dueDate === pt.dueDate
      )

      if (isDuplicate) {
        skippedCount++
        continue
      }

      const id = generateTaskId()
      const now = new Date().toISOString()
      const newTask: StoredTask = {
        id,
        title: pt.title,
        description: pt.description,
        category: pt.category,
        dueDate: pt.dueDate,
        status: 'pending',
        priority: pt.priority,
        linkedDocumentId: doc.id,
        linkedDocumentName: doc.originalFilename,
        source: 'auto',
        recurrence: pt.recurrence,
        snoozeCount: 0,
        createdAt: now,
        updatedAt: now,
        reminder: {
          reminderDate: pt.dueDate,
          enabled: true,
        },
      }

      existingTasks.push(newTask)
      added.push(newTask)
    }
  }

  return { added, skippedCount }
}

/**
 * Synchronizes tasks automatically from LifeFile extracted documents with strict duplicate prevention.
 */
export async function syncTasksFromLifeFile(
  documents: StoredDocument[],
  userId?: string
): Promise<{ added: StoredTask[]; skippedCount: number; updatedCount: number }> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const existingTasks = await getAllTasks(scopedUser)
    const { added, skippedCount } = computePotentialDocumentTasks(documents, [...existingTasks])

    if (added.length > 0) {
      const sb = getSupabaseAdmin()
      const res = await sb
        .from('aura_tasks')
        .insert(added.map((t) => taskToRow(t, scopedUser)))
      if (res.error) throw new Error(`syncTasksFromLifeFile insert failed: ${res.error.message}`)
    }

    return { added, skippedCount, updatedCount: 0 }
  }

  const tasksFile = getTasksFile(userId)
  return withFileLock(tasksFile, async () => {
    await ensureTasksDirectory(userId)
    const tasksMap = await readTasks(userId)
    const existingTasks = Object.values(tasksMap)
    const { added, skippedCount } = computePotentialDocumentTasks(documents, existingTasks)

    for (const t of added) {
      tasksMap[t.id] = t
    }
    if (added.length > 0) {
      await writeTasks(tasksMap, userId)
    }

    return { added, skippedCount, updatedCount: 0 }
  })
}

/**
 * Handles the event where a LifeFile document is deleted:
 * Safely unlinks the document from tasks without deleting manual user tasks.
 */
export async function handleDocumentDeleted(documentId: string, userId?: string): Promise<number> {
  if (getStorageBackendMode() === 'cloud') {
    const scopedUser = requireCloudUserId(userId)
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('aura_tasks')
      .select('id, linked_document_name')
      .eq('user_id', scopedUser)
      .eq('linked_document_id', documentId)

    if (error) throw new Error(`handleDocumentDeleted query failed: ${error.message}`)
    if (!data || data.length === 0) return 0

    let modified = 0
    const now = new Date().toISOString()
    for (const row of data) {
      const nextName = `${row.linked_document_name || 'Document'} (deleted)`
      const upd = await sb
        .from('aura_tasks')
        .update({
          linked_document_id: null,
          linked_document_name: nextName,
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('user_id', scopedUser)
      if (!upd.error) modified++
    }
    return modified
  }

  const tasksFile = getTasksFile(userId)
  return withFileLock(tasksFile, async () => {
    await ensureTasksDirectory(userId)
    const tasksMap = await readTasks(userId)
    let modifiedCount = 0

    for (const task of Object.values(tasksMap)) {
      if (task.linkedDocumentId === documentId) {
        task.linkedDocumentId = null
        task.linkedDocumentName = `${task.linkedDocumentName || 'Document'} (deleted)`
        task.updatedAt = new Date().toISOString()
        modifiedCount++
      }
    }

    if (modifiedCount > 0) {
      await writeTasks(tasksMap, userId)
    }

    return modifiedCount
  })
}
