import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getAllTasks,
  saveTask,
  syncTasksFromLifeFile,
} from '@/lib/tasks/storage.ts'
import {
  getOverdueTasks,
  getDueTodayTasks,
  getUpcomingTasks,
  getCompletedTasks,
  getTasksByCategory,
  getTaskSummary,
  normalizeDate,
} from '@/lib/tasks/categorization.ts'
import { getAllDocuments } from '@/lib/lifefile/storage.ts'
import type { TaskCategory, TaskPriority, TaskRecurrence } from '@/lib/tasks/types.ts'

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
 * GET /api/tasks
 * Returns tasks and summary with optional filtering.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const { searchParams } = new URL(req.url)
    const statusParam = searchParams.get('status')
    const categoryParam = searchParams.get('category')
    const timeframeParam = searchParams.get('timeframe')
    const refDateParam = searchParams.get('refDate') || undefined

    let tasks = await getAllTasks(userId)

    // Filter by timeframe
    if (timeframeParam === 'overdue') {
      tasks = getOverdueTasks(tasks, refDateParam)
    } else if (timeframeParam === 'today') {
      tasks = getDueTodayTasks(tasks, refDateParam)
    } else if (timeframeParam === 'upcoming') {
      tasks = getUpcomingTasks(tasks, 30, refDateParam)
    } else if (timeframeParam === 'completed') {
      tasks = getCompletedTasks(tasks)
    }

    // Filter by status if specified
    if (statusParam && ['pending', 'completed', 'dismissed'].includes(statusParam)) {
      tasks = tasks.filter((t) => t.status === statusParam)
    }

    // Filter by category if specified
    if (categoryParam && VALID_CATEGORIES.includes(categoryParam as TaskCategory)) {
      tasks = getTasksByCategory(tasks, categoryParam as TaskCategory)
    }

    const allTasksForSummary = await getAllTasks(userId)
    const summary = getTaskSummary(allTasksForSummary, refDateParam)

    return NextResponse.json(
      {
        success: true,
        tasks,
        summary,
      },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: `Failed to retrieve tasks: ${err?.message || err}`,
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/tasks
 * Creates a manual task or synchronizes tasks from LifeFile documents.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400 }
      )
    }

    // Handle sync action
    if (body.action === 'sync') {
      const documents = await getAllDocuments(userId)
      const syncResult = await syncTasksFromLifeFile(documents, userId)
      const allTasks = await getAllTasks(userId)
      return NextResponse.json(
        {
          success: true,
          action: 'sync',
          addedCount: syncResult.added.length,
          skippedCount: syncResult.skippedCount,
          tasks: allTasks,
        },
        { status: 200 }
      )
    }

    // Manual Task Creation Validation
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json(
        { success: false, error: 'Task title is required.' },
        { status: 400 }
      )
    }

    const dueDate = typeof body.dueDate === 'string' ? body.dueDate.trim() : ''
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}/.test(dueDate)) {
      return NextResponse.json(
        { success: false, error: 'Valid due date (YYYY-MM-DD) is required.' },
        { status: 400 }
      )
    }

    const category: TaskCategory = VALID_CATEGORIES.includes(body.category)
      ? body.category
      : 'personal'

    const priority: TaskPriority = VALID_PRIORITIES.includes(body.priority)
      ? body.priority
      : 'medium'

    const recurrence: TaskRecurrence = VALID_RECURRENCES.includes(body.recurrence)
      ? body.recurrence
      : 'none'

    const description = typeof body.description === 'string' ? body.description.trim() : ''

    const reminder =
      body.reminder && typeof body.reminder === 'object'
        ? {
            reminderDate: normalizeDate(body.reminder.reminderDate || dueDate),
            enabled: Boolean(body.reminder.enabled),
            timezone: typeof body.reminder.timezone === 'string' ? body.reminder.timezone : 'Asia/Kolkata',
          }
        : null

    const newTask = await saveTask({
      title,
      description,
      category,
      dueDate,
      status: 'pending',
      priority,
      linkedDocumentId: null,
      source: 'manual',
      recurrence,
      reminder,
    }, userId)

    return NextResponse.json({ success: true, task: newTask }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: `Failed to create task: ${err?.message || err}`,
      },
      { status: 500 }
    )
  }
}
