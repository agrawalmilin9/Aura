'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { StoredTask, TaskCategory, TaskPriority, TaskRecurrence } from '../tasks/types.ts'

export function useTasks(onMutated?: () => void) {
  const [tasks, setTasks] = useState<StoredTask[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [togglingTaskIds, setTogglingTaskIds] = useState<Set<string>>(() => new Set())
  const togglingRef = useRef<Set<string>>(new Set())

  const refreshTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' })
      const data = await res.json()
      if (res.ok && data.success && Array.isArray(data.tasks)) {
        setTasks(data.tasks)
      }
    } catch {
      setTaskError('Could not load tasks from server.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshTasks()
  }, [refreshTasks])

  const toggleTaskStatus = useCallback(
    async (task: StoredTask) => {
      if (togglingRef.current.has(task.id)) return
      togglingRef.current.add(task.id)
      setTogglingTaskIds((prev) => {
        const next = new Set(prev)
        next.add(task.id)
        return next
      })
      setTaskError(null)

      const previousStatus = task.status
      const nextStatus = previousStatus === 'completed' ? 'pending' : 'completed'

      // Optimistic update shared across Overview, Tasks & Sidebar
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t))
      )

      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Failed to update task status.')
        }
        if (nextStatus === 'completed' && task.recurrence && task.recurrence !== 'none') {
          // Refresh from server when a recurring task schedules its next cycle
          await refreshTasks()
        } else if (data?.task) {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? data.task : t))
          )
        }
        onMutated?.()
      } catch (err: any) {
        // Revert optimistic update on failure
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: previousStatus } : t))
        )
        setTaskError(err?.message || 'Could not update task status. Changes reverted.')
      } finally {
        togglingRef.current.delete(task.id)
        setTogglingTaskIds((prev) => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
      }
    },
    [onMutated, refreshTasks]
  )

  const snoozeTaskByDays = useCallback(
    async (id: string, days: number) => {
      setTaskError(null)
      try {
        const res = await fetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snoozeDays: days }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Failed to snooze task.')
        }
        await refreshTasks()
        onMutated?.()
      } catch (err: any) {
        setTaskError(err?.message || 'Failed to snooze task.')
      }
    },
    [onMutated, refreshTasks]
  )

  const dismissTaskById = useCallback(
    async (id: string) => {
      setTaskError(null)
      let snapshot: StoredTask[] = []
      setTasks((prev) => {
        snapshot = prev
        return prev.map((t) => (t.id === id ? { ...t, status: 'dismissed' } : t))
      })
      try {
        const res = await fetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'dismissed' }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Failed to dismiss task.')
        }
        await refreshTasks()
        onMutated?.()
      } catch (err: any) {
        setTasks(snapshot)
        setTaskError(err?.message || 'Failed to dismiss task.')
      }
    },
    [onMutated, refreshTasks]
  )

  const deleteTaskById = useCallback(
    async (id: string) => {
      setTaskError(null)
      let snapshot: StoredTask[] = []
      setTasks((prev) => {
        snapshot = prev
        return prev.filter((t) => t.id !== id)
      })
      try {
        const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Failed to delete task.')
        }
        onMutated?.()
      } catch (err: any) {
        setTasks(snapshot)
        setTaskError(err?.message || 'Failed to delete task.')
      }
    },
    [onMutated]
  )

  const saveOrUpdateTask = useCallback(
    async (
      payload: {
        title: string
        dueDate: string
        category: TaskCategory
        priority: TaskPriority
        recurrence: TaskRecurrence
        description: string
      },
      editingTaskId?: string | null
    ): Promise<{ success: boolean; error?: string }> => {
      setTaskError(null)
      try {
        const res = editingTaskId
          ? await fetch(`/api/tasks/${editingTaskId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success || !data?.task) {
          return { success: false, error: data?.error || 'Failed to save task.' }
        }
        await refreshTasks()
        onMutated?.()
        return { success: true }
      } catch {
        return { success: false, error: 'Network error while saving task.' }
      }
    },
    [onMutated, refreshTasks]
  )

  const syncTasksFromDocs = useCallback(async () => {
    setIsSyncing(true)
    setTaskError(null)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to sync tasks from LifeFile.')
      }
      await refreshTasks()
      onMutated?.()
    } catch (err: any) {
      setTaskError(err?.message || 'Failed to sync tasks from LifeFile.')
    } finally {
      setIsSyncing(false)
    }
  }, [onMutated, refreshTasks])

  return {
    tasks,
    isLoading,
    isSyncing,
    taskError,
    togglingTaskIds,
    clearTaskError: () => setTaskError(null),
    refreshTasks,
    toggleTaskStatus,
    snoozeTaskByDays,
    dismissTaskById,
    deleteTaskById,
    saveOrUpdateTask,
    syncTasksFromDocs,
  }
}
