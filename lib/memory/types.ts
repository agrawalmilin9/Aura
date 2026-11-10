export type MemoryCategory = 'preference' | 'family' | 'home' | 'reminder_rule' | 'other'

export interface StoredMemory {
  id: string
  content: string
  category: MemoryCategory
  approvedByUser: boolean
  createdAt: string
  updatedAt: string
}

export interface MemoryProposal {
  proposedContent: string
  category: MemoryCategory
  reason: string
}
