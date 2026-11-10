'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Trash2, Upload, UserRound } from 'lucide-react'
import {
  getProfileInitials,
  validateProfileInput,
  type UserProfile,
} from '@/lib/hooks/useProfile.ts'

async function resizeAvatarToDataUrl(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Please choose a PNG, JPG, or WEBP image.')
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Profile photo must be smaller than 5 MB.')
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(String(reader.result))
          return
        }
        const minSide = Math.min(img.width, img.height)
        const sx = Math.floor((img.width - minSide) / 2)
        const sy = Math.floor((img.height - minSide) / 2)
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', 0.86))
      }
      img.onerror = () => reject(new Error('Could not read the selected image file.'))
      img.src = String(reader.result)
    }
    reader.onerror = () => reject(new Error('Failed to load the selected file.'))
    reader.readAsDataURL(file)
  })
}

export function ProfileSection({
  profile,
  onSaveProfile,
  onResetProfile,
}: {
  profile: UserProfile
  onSaveProfile: (next: {
    name: string
    phone: string
    email: string
    photoDataUrl: string | null
  }) => Promise<unknown> | void
  onResetProfile: () => Promise<unknown> | void
}) {
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone)
  const [email, setEmail] = useState(profile.email)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(profile.photoDataUrl)
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string; photo?: string }>({})
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setName(profile.name)
    setPhone(profile.phone)
    setEmail(profile.email)
    setPhotoDataUrl(profile.photoDataUrl)
  }, [profile])

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSavedNotice(null)
    try {
      const dataUrl = await resizeAvatarToDataUrl(file)
      setPhotoDataUrl(dataUrl)
      setErrors((prev) => ({ ...prev, photo: undefined }))
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, photo: err?.message || 'Invalid image file.' }))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavedNotice(null)
    const validation = validateProfileInput({ name, phone, email })
    if (!validation.valid) {
      setErrors(validation.errors)
      return
    }
    setErrors({})
    await onSaveProfile({
      name,
      phone,
      email,
      photoDataUrl,
    })
    setSavedNotice('Profile saved to your AURA account.')
  }

  const handleRemovePhoto = async () => {
    setPhotoDataUrl(null)
    setSavedNotice(null)
    if (profile.isCustom) {
      await onSaveProfile({
        name: name.trim() || profile.name,
        phone,
        email,
        photoDataUrl: null,
      })
      setSavedNotice('Profile photo removed. Switched to initials avatar.')
    }
  }

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <span className="section-kicker">PERSONAL PROFILE</span>
          <h2>Your profile</h2>
          <p className="subcopy">Manage your display name, contact number, and avatar for your AURA account.</p>
        </div>
      </div>

      <div
        className="panel"
        style={{
          marginBottom: '16px',
          padding: '12px 16px',
          background: profile.isCustom ? '#edf5ee' : '#f8efe9',
          borderColor: profile.isCustom ? '#d5e6d7' : '#f0dfd5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
          fontSize: '12px',
        }}
      >
        <span>
          {profile.isCustom ? (
            <>
              <Check size={14} style={{ display: 'inline', marginRight: '6px', color: '#456f51' }} />
              <strong>Verified Account Profile</strong> — scoped exclusively to your signed-in account.
            </>
          ) : (
            <>
              <UserRound size={14} style={{ display: 'inline', marginRight: '6px', color: 'var(--coral)' }} />
              <strong>Default Profile</strong> — enter and save your details below.
            </>
          )}
        </span>
        {profile.isCustom && (
          <button
            type="button"
            className="outline-button"
            style={{ padding: '5px 10px', fontSize: '11px' }}
            onClick={() => {
              onResetProfile()
              setSavedNotice('Profile reset to default placeholder state.')
            }}
          >
            Reset to Default
          </button>
        )}
      </div>

      {savedNotice && (
        <div
          role="status"
          style={{
            padding: '11px 14px',
            background: '#edf5ee',
            border: '1px solid #cce2cf',
            color: '#456f51',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ✓ {savedNotice}
        </div>
      )}

      <div className="overview-grid">
        <div className="panel">
          <span className="section-kicker">PROFILE PHOTO</span>
          <h3 style={{ marginBottom: '14px' }}>Avatar</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
            <div
              style={{
                width: '76px',
                height: '76px',
                borderRadius: '50%',
                overflow: 'hidden',
                background: '#d9beb1',
                color: '#573f36',
                display: 'grid',
                placeItems: 'center',
                fontSize: '22px',
                fontWeight: 700,
                flexShrink: 0,
                border: '1px solid var(--border)',
              }}
            >
              {photoDataUrl ? (
                <img
                  src={photoDataUrl}
                  alt="Profile preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                getProfileInitials(name || profile.name)
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="file"
                ref={fileRef}
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                onChange={handlePhotoChange}
                style={{ display: 'none' }}
              />
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} /> {photoDataUrl ? 'Change Photo' : 'Upload Photo'}
                </button>
                {photoDataUrl && (
                  <button
                    type="button"
                    className="outline-button"
                    style={{ color: '#c96656', borderColor: '#f0d4cc' }}
                    onClick={handleRemovePhoto}
                  >
                    <Trash2 size={14} /> Remove Photo
                  </button>
                )}
              </div>
              <span className="muted" style={{ fontSize: '11px' }}>
                PNG, JPG, or WEBP up to 5 MB. Stored with your private AURA account.
              </span>
              {errors.photo && (
                <span style={{ fontSize: '11px', color: '#c96656' }}>
                  <AlertCircle size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  {errors.photo}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <span className="section-kicker">IDENTITY DETAILS</span>
          <h3 style={{ marginBottom: '14px' }}>Personal information</h3>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} noValidate>
            <div>
              <label htmlFor="profile-name" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Full Name *
              </label>
              <input
                id="profile-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: '7px' }}
              />
              {errors.name && <span style={{ fontSize: '11px', color: '#c96656' }}>{errors.name}</span>}
            </div>

            <div>
              <label htmlFor="profile-phone" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Phone Number
              </label>
              <input
                id="profile-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: '7px' }}
              />
              {errors.phone && <span style={{ fontSize: '11px', color: '#c96656' }}>{errors.phone}</span>}
            </div>

            <div>
              <label htmlFor="profile-email" style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Email Address
              </label>
              <input
                id="profile-email"
                type="email"
                value={email}
                readOnly
                disabled={Boolean(email)}
                placeholder="you@example.com"
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: '7px', background: email ? '#f7f5f0' : '#fff', color: '#6b675f' }}
              />
              {errors.email && <span style={{ fontSize: '11px', color: '#c96656' }}>{errors.email}</span>}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button type="submit" className="primary-button">
                Save Profile
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
