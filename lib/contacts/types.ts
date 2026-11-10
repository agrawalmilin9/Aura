export interface StoredContact {
  id: string
  companyName: string
  phone: string | null
  email: string | null
  website: string | null
  linkedProductIds: string[]
  linkedDocumentIds: string[]
  notes?: string | null
  source: 'auto' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface ParsedContactFields {
  phone: string | null
  email: string | null
  website: string | null
}
