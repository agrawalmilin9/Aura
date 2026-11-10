import type { StoredTask, TaskCategory, TaskSummary } from './types.ts'

/**
 * Normalizes a date into YYYY-MM-DD format.
 */
export function normalizeDate(dateInput?: string | Date | null): string {
  if (!dateInput) {
    const d = new Date()
    return d.toISOString().split('T')[0]
  }
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput
  }
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) {
    return new Date().toISOString().split('T')[0]
  }
  return d.toISOString().split('T')[0]
}

/**
 * Returns tasks that are past their due date and not yet completed or dismissed.
 */
export function getOverdueTasks(tasks: StoredTask[], referenceDate?: string): StoredTask[] {
  const ref = normalizeDate(referenceDate)
  return tasks.filter(
    (t) => t.status === 'pending' && t.dueDate && t.dueDate < ref
  ).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/**
 * Returns tasks that are due on the reference date.
 */
export function getDueTodayTasks(tasks: StoredTask[], referenceDate?: string): StoredTask[] {
  const ref = normalizeDate(referenceDate)
  return tasks.filter(
    (t) => t.status === 'pending' && t.dueDate === ref
  )
}

/**
 * Returns upcoming tasks due within daysAhead days (default 30 days).
 */
export function getUpcomingTasks(
  tasks: StoredTask[],
  daysAhead = 30,
  referenceDate?: string
): StoredTask[] {
  const ref = normalizeDate(referenceDate)
  const refDateObj = new Date(ref)
  const maxDateObj = new Date(refDateObj.getTime() + daysAhead * 24 * 60 * 60 * 1000)
  const maxDateStr = maxDateObj.toISOString().split('T')[0]

  return tasks.filter(
    (t) => t.status === 'pending' && t.dueDate > ref && t.dueDate <= maxDateStr
  ).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/**
 * Returns tasks marked as completed.
 */
export function getCompletedTasks(tasks: StoredTask[]): StoredTask[] {
  return tasks.filter((t) => t.status === 'completed').sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

/**
 * Returns tasks belonging to a specific category.
 */
export function getTasksByCategory(tasks: StoredTask[], category: TaskCategory): StoredTask[] {
  return tasks.filter((t) => t.category === category)
}

/**
 * Computes an aggregated task summary for dashboard cards.
 */
export function getTaskSummary(tasks: StoredTask[], referenceDate?: string): TaskSummary {
  const ref = normalizeDate(referenceDate)

  const summary: TaskSummary = {
    total: tasks.length,
    pending: 0,
    overdue: 0,
    dueToday: 0,
    upcoming: 0,
    completed: 0,
    dismissed: 0,
    byCategory: {
      bill: 0,
      insurance: 0,
      warranty: 0,
      subscription: 0,
      personal: 0,
      general: 0,
    },
  }

  for (const t of tasks) {
    if (t.status === 'completed') {
      summary.completed++
    } else if (t.status === 'dismissed') {
      summary.dismissed++
    } else {
      summary.pending++
      if (t.dueDate < ref) {
        summary.overdue++
      } else if (t.dueDate === ref) {
        summary.dueToday++
      } else {
        summary.upcoming++
      }
    }

    if (t.category in summary.byCategory) {
      summary.byCategory[t.category]++
    }
  }

  return summary
}
