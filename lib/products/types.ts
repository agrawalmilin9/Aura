export type WarrantyStatus = 'active' | 'expiring_soon' | 'expired' | 'unknown'

export type ProductDocumentRole = 'invoice' | 'warranty' | 'manual' | 'service' | 'other'

export interface StoredProduct {
  id: string
  productName: string
  brand: string | null
  modelNumber: string | null
  serialNumber: string | null
  purchaseDate: string | null
  warrantyExpiry: string | null
  warrantyDuration: string | null
  warrantyStatus: WarrantyStatus
  linkedDocumentIds: string[]
  documentRoles: Record<string, ProductDocumentRole>
  source: 'auto' | 'manual'
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductValidationResult {
  valid: boolean
  error?: string
}
