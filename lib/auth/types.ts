export interface StoredUser {
  id: string
  email: string
  name: string
  passwordHash?: string
  phone: string | null
  photoDataUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface PublicUser {
  id: string
  email: string
  name: string
  phone: string | null
  photoDataUrl: string | null
  createdAt: string
}

export interface SessionRecord {
  id: string
  userId: string
  createdAt: number
  expiresAt: number
  revoked: boolean
}
