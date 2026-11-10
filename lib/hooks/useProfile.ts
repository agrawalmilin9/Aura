'use client'

import { useState, useEffect, useCallback } from 'react'
import type { PublicUser } from '../auth/types.ts'

export interface UserProfile {
  name: string
  phone: string
  email: string
  photoDataUrl: string | null
  isCustom: boolean
  updatedAt?: string
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: '',
  phone: '',
  email: '',
  photoDataUrl: null,
  isCustom: false,
}

export const PROFILE_STORAGE_KEY = 'aura_user_profile_v1'

export interface ProfileValidationResult {
  valid: boolean
  errors: {
    name?: string
    phone?: string
    email?: string
  }
}

/**
 * Validates user-entered profile name, phone, and email fields cleanly.
 */
export function validateProfileInput(input: {
  name: string
  phone: string
  email: string
}): ProfileValidationResult {
  const errors: ProfileValidationResult['errors'] = {}
  const trimmedName = input.name.trim()
  const trimmedPhone = input.phone.trim()
  const trimmedEmail = input.email.trim()

  if (!trimmedName || trimmedName.length < 2) {
    errors.name = 'Please enter your name (at least 2 characters).'
  } else if (trimmedName.length > 80) {
    errors.name = 'Name must be 80 characters or fewer.'
  }

  if (trimmedPhone) {
    const cleanedCharsOk = /^[+\d\s\-()]+$/.test(trimmedPhone)
    const digitCount = trimmedPhone.replace(/\D/g, '').length
    if (!cleanedCharsOk || digitCount < 7 || digitCount > 15) {
      errors.phone = 'Enter a valid phone number (7 to 15 digits).'
    }
  }

  if (trimmedEmail) {
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmedEmail)) {
      errors.email = 'Enter a valid email address (e.g. name@example.com).'
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

export function getProfileInitials(name: string | null | undefined): string {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'U'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function useProfile(initialUser?: PublicUser | null) {
  const [profile, setProfile] = useState<UserProfile>(() =>
    initialUser
      ? {
          name: initialUser.name || '',
          phone: initialUser.phone || '',
          email: initialUser.email || '',
          photoDataUrl: initialUser.photoDataUrl || null,
          isCustom: true,
        }
      : DEFAULT_USER_PROFILE
  )
  const [isLoaded, setIsLoaded] = useState(Boolean(initialUser))

  useEffect(() => {
    if (!initialUser) return
    setProfile({
      name: initialUser.name || '',
      phone: initialUser.phone || '',
      email: initialUser.email || '',
      photoDataUrl: initialUser.photoDataUrl || null,
      isCustom: true,
    })
    setIsLoaded(true)
  }, [initialUser])

  const saveProfile = useCallback(
    async (next: { name: string; phone: string; email: string; photoDataUrl: string | null }) => {
      const updated: UserProfile = {
        name: next.name.trim(),
        phone: next.phone.trim(),
        email: next.email.trim(),
        photoDataUrl: next.photoDataUrl,
        isCustom: true,
        updatedAt: new Date().toISOString(),
      }
      setProfile(updated)
      try {
        const res = await fetch('/api/auth/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: updated.name,
            phone: updated.phone || null,
            photoDataUrl: updated.photoDataUrl,
          }),
        })
        const data = await res.json().catch(() => null)
        if (res.ok && data?.success && data.user) {
          setProfile({
            name: data.user.name || updated.name,
            phone: data.user.phone || '',
            email: data.user.email || updated.email,
            photoDataUrl: data.user.photoDataUrl || null,
            isCustom: true,
            updatedAt: new Date().toISOString(),
          })
        }
      } catch {
        // Ignore transient offline error cleanly while keeping local display synced
      }
      return updated
    },
    []
  )

  const clearProfile = useCallback(async () => {
    const resetName = initialUser?.name || ''
    const resetEmail = initialUser?.email || ''
    setProfile({
      name: resetName,
      phone: '',
      email: resetEmail,
      photoDataUrl: null,
      isCustom: Boolean(initialUser),
    })
    try {
      await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: null, photoDataUrl: null }),
      })
    } catch {}
  }, [initialUser])

  return {
    profile,
    isLoaded,
    saveProfile,
    clearProfile,
  }
}
