'use client'

import { useState, useEffect, useCallback } from 'react'
import type { StoredTask } from '../tasks/types.ts'
import type { ProactiveSuggestion } from '../intelligence/proactive-suggestions.ts'

export interface InAppReminderItem {
  id: string
  taskId?: string
  title: string
  detail: string
  dueDate?: string
  urgency: 'overdue' | 'today' | 'upcoming' | 'suggestion'
  suggestedPrompt?: string
}

export type BrowserPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

export function useReminders(userId?: string) {
  const notifiedKey = userId ? `aura_notified_reminders_v2_${userId}` : 'aura_notified_reminders_v1'
  const optInKey = userId ? `aura_browser_notif_enabled_${userId}` : 'aura_browser_notif_enabled'
  const [reminders, setReminders] = useState<InAppReminderItem[]>([])
  const [browserPermission, setBrowserPermission] = useState<BrowserPermissionState>('default')
  const [browserEnabled, setBrowserEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserPermission('unsupported')
      return
    }
    const perm = Notification.permission as BrowserPermissionState
    setBrowserPermission(perm)
    const savedOptIn = window.localStorage.getItem(optInKey) === 'true'
    if (perm === 'granted' && savedOptIn) {
      setBrowserEnabled(true)
    }
  }, [optInKey])

  const fireBrowserNotificationsIfAllowed = useCallback((items: InAppReminderItem[]) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    if (window.localStorage.getItem(optInKey) !== 'true') return

    const todayStr = new Date().toISOString().split('T')[0]
    let sentMap: Record<string, string> = {}
    try {
      sentMap = JSON.parse(window.localStorage.getItem(notifiedKey) || '{}')
    } catch {
      sentMap = {}
    }

    const urgentItems = items.filter((r) => r.urgency === 'overdue' || r.urgency === 'today')
    let updated = false

    for (const item of urgentItems.slice(0, 3)) {
      if (sentMap[item.id] === todayStr) continue
      try {
        new Notification(`AURA Reminder: ${item.title}`, {
          body: item.detail,
        })
        sentMap[item.id] = todayStr
        updated = true
      } catch {
        // Ignore browser notification exceptions cleanly
      }
    }

    if (updated) {
      try {
        window.localStorage.setItem(notifiedKey, JSON.stringify(sentMap))
      } catch {}
    }
  }, [notifiedKey, optInKey])

  const refreshReminders = useCallback(async () => {
    setIsLoading(true)
    try {
      const [taskRes, intelRes] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/intelligence'),
      ])
      const [taskData, intelData] = await Promise.all([taskRes.json(), intelRes.json()])
      const todayStr = new Date().toISOString().split('T')[0]
      const nextWeekDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]

      const items: InAppReminderItem[] = []

      if (taskData.success && Array.isArray(taskData.tasks)) {
        const pending = (taskData.tasks as StoredTask[]).filter((t) => t.status === 'pending')
        for (const t of pending) {
          if (t.dueDate < todayStr) {
            items.push({
              id: `rem_${t.id}`,
              taskId: t.id,
              title: t.title,
              detail: `Overdue (was due ${t.dueDate}) · ${t.category}`,
              dueDate: t.dueDate,
              urgency: 'overdue',
            })
          } else if (t.dueDate === todayStr) {
            items.push({
              id: `rem_${t.id}`,
              taskId: t.id,
              title: t.title,
              detail: `Due today (${t.dueDate}) · ${t.category}`,
              dueDate: t.dueDate,
              urgency: 'today',
            })
          } else if (t.dueDate <= nextWeekDate) {
            items.push({
              id: `rem_${t.id}`,
              taskId: t.id,
              title: t.title,
              detail: `Due soon on ${t.dueDate} · ${t.category}`,
              dueDate: t.dueDate,
              urgency: 'upcoming',
            })
          }
        }
      }

      if (intelData.success && Array.isArray(intelData.suggestions)) {
        for (const sug of (intelData.suggestions as ProactiveSuggestion[]).slice(0, 3)) {
          if (sug.priority === 'high') {
            items.push({
              id: `rem_${sug.id}`,
              title: sug.title,
              detail: sug.description,
              urgency: 'suggestion',
              suggestedPrompt: sug.suggestedPrompt,
            })
          }
        }
      }

      setReminders(items)
      fireBrowserNotificationsIfAllowed(items)
    } catch {
      // Keep UI resilient if background poll fails
    } finally {
      setIsLoading(false)
    }
  }, [fireBrowserNotificationsIfAllowed])

  useEffect(() => {
    refreshReminders()
    const interval = setInterval(refreshReminders, 60_000)
    return () => clearInterval(interval)
  }, [refreshReminders])

  const requestBrowserNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserPermission('unsupported')
      return false
    }
    const result = await Notification.requestPermission()
    setBrowserPermission(result as BrowserPermissionState)
    if (result === 'granted') {
      window.localStorage.setItem(optInKey, 'true')
      setBrowserEnabled(true)
      fireBrowserNotificationsIfAllowed(reminders)
      return true
    }
    window.localStorage.setItem(optInKey, 'false')
    setBrowserEnabled(false)
    return false
  }, [fireBrowserNotificationsIfAllowed, optInKey, reminders])

  const disableBrowserNotifications = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(optInKey, 'false')
    }
    setBrowserEnabled(false)
  }, [optInKey])

  return {
    reminders,
    isLoading,
    browserPermission,
    browserEnabled,
    refreshReminders,
    requestBrowserNotifications,
    disableBrowserNotifications,
  }
}
