export type TaskCategory =
  | 'bill'
  | 'insurance'
  | 'warranty'
  | 'subscription'
  | 'personal'
  | 'general'

export type TaskStatus = 'pending' | 'completed' | 'dismissed'

export type TaskPriority = 'high' | 'medium' | 'low'

export type TaskSource = 'auto' | 'manual'

export type TaskRecurrence = 'none' | 'monthly' | 'quarterly' | 'yearly'

export interface TaskReminder {
  reminderDate: string // ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
  enabled: boolean
  timezone?: string
}

export interface StoredTask {
  id: string
  title: string
  description: string
  category: TaskCategory
  dueDate: string // YYYY-MM-DD
  status: TaskStatus
  priority: TaskPriority
  linkedDocumentId: string | null
  linkedDocumentName?: string | null
  source: TaskSource
  recurrence?: TaskRecurrence
  snoozeCount?: number
  createdAt: string
  updatedAt: string
  reminder?: TaskReminder | null
}

export interface TaskValidationResult {
  valid: boolean
  error?: string
}

export interface TaskSummary {
  total: number
  pending: number
  overdue: number
  dueToday: number
  upcoming: number
  completed: number
  dismissed: number
  byCategory: Record<TaskCategory, number>
}
