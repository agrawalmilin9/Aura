import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getTaskById,
  updateTask,
  snoozeTask,
  deleteTask,
  validateTaskId,
} from '@/lib/tasks/storage.ts'
import type { TaskCategory, TaskPriority, TaskRecurrence, TaskStatus } from '@/lib/tasks/types.ts'

interface RouteContext {
  params: Promise<{ id: string }>
}

const VALID_STATUSES: TaskStatus[] = ['pending', 'completed', 'dismissed']
const VALID_CATEGORIES: TaskCategory[] = [
  'bill',
  'insurance',
  'warranty',
  'subscription',
  'personal',
  'general',
]
const VALID_PRIORITIES: TaskPriority[] = ['high', 'medium', 'low']
const VALID_RECURRENCES: TaskRecurrence[] = ['none', 'monthly', 'quarterly', 'yearly']

/**
 * GET /api/tasks/[id]
 * Retrieves task metadata by ID.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateTaskId(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid task ID format.' },
        { status: 400 }
      )
    }

    const task = await getTaskById(id, auth.user.id)
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, task }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to retrieve task: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/tasks/[id]
 * Updates task fields (e.g. status, title, dueDate, priority, reminder).
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const { id } = await context.params
    if (!validateTaskId(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid task ID format.' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400 }
      )
    }

    if (typeof body.snoozeDays === 'number' && body.snoozeDays >= 1 && body.snoozeDays <= 365) {
      const snoozed = await snoozeTask(id, body.snoozeDays, undefined, userId)
      if (!snoozed) {
        return NextResponse.json(
          { success: false, error: 'Task not found or could not be snoozed.' },
          { status: 404 }
        )
      }
      return NextResponse.json({ success: true, task: snoozed }, { status: 200 })
    }

    const updates: any = {}

    if (body.title && typeof body.title === 'string' && body.title.trim()) {
      updates.title = body.title.trim()
    }
    if (typeof body.description === 'string') {
      updates.description = body.description.trim()
    }
    if (body.status && VALID_STATUSES.includes(body.status)) {
      updates.status = body.status
    }
    if (body.priority && VALID_PRIORITIES.includes(body.priority)) {
      updates.priority = body.priority
    }
    if (body.category && VALID_CATEGORIES.includes(body.category)) {
      updates.category = body.category
    }
    if (body.recurrence && VALID_RECURRENCES.includes(body.recurrence)) {
      updates.recurrence = body.recurrence
    }
    if (body.dueDate && typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(body.dueDate)) {
      updates.dueDate = body.dueDate.trim()
    }
    if (body.reminder !== undefined) {
      updates.reminder = body.reminder
    }

    const updatedTask = await updateTask(id, updates, userId)
    if (!updatedTask) {
      return NextResponse.json(
        { success: false, error: 'Task not found or could not be updated.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, task: updatedTask }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to update task: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tasks/[id]
 * Deletes a task by ID.
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateTaskId(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid task ID format.' },
        { status: 400 }
      )
    }

    const success = await deleteTask(id, auth.user.id)
    if (!success) {
      return NextResponse.json(
        { success: false, error: 'Task not found or could not be deleted.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, deletedId: id }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to delete task: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
