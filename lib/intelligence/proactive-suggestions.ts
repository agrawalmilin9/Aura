import type { StoredDocument } from '../lifefile/types.ts'
import type { StoredProduct } from '../products/types.ts'
import type { StoredTask } from '../tasks/types.ts'
import type { StoredContact } from '../contacts/types.ts'
import { computeWarrantyStatus } from '../products/storage.ts'

export interface ProactiveSuggestion {
  id: string
  type: 'warranty_check' | 'insurance_checklist' | 'contact_support' | 'missing_claim_info'
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  suggestedPrompt: string
  linkedProductId?: string
  linkedDocumentId?: string
  linkedTaskId?: string
  linkedContactId?: string
  sourceLabel?: string
  requiresConfirmation: true // Suggestions never auto-execute actions
}

/**
 * Generates proactive, non-executing suggestions from real LifeFile documents, products, tasks, and contacts.
 */
export function generateProactiveSuggestions(params: {
  documents: StoredDocument[]
  products: StoredProduct[]
  tasks: StoredTask[]
  contacts: StoredContact[]
  referenceDate?: string
}): ProactiveSuggestion[] {
  const { documents, products, tasks, contacts, referenceDate } = params
  const refStr = referenceDate || new Date().toISOString().split('T')[0]
  const refTime = new Date(refStr).getTime()
  const suggestions: ProactiveSuggestion[] = []

  // 1. Check expiring or recently expired product warranties
  for (const prod of products) {
    const status = computeWarrantyStatus(prod.warrantyExpiry, refStr)
    const primaryDocId = prod.linkedDocumentIds[0]
    const primaryDoc = primaryDocId ? documents.find((d) => d.id === primaryDocId) : undefined

    if (status === 'expiring_soon' && prod.warrantyExpiry) {
      const daysLeft = Math.ceil(
        (new Date(prod.warrantyExpiry).getTime() - refTime) / (1000 * 60 * 60 * 24)
      )
      suggestions.push({
        id: `sug_warranty_${prod.id}`,
        type: 'warranty_check',
        title: `Check expiring warranty for ${prod.productName}`,
        description: `Warranty expires on ${prod.warrantyExpiry} (${daysLeft} day(s) left). Review coverage or prepare a claim checklist before it ends.`,
        priority: daysLeft <= 15 ? 'high' : 'medium',
        suggestedPrompt: `Prepare a warranty claim checklist for ${prod.productName}`,
        linkedProductId: prod.id,
        linkedDocumentId: primaryDocId,
        sourceLabel: primaryDoc?.originalFilename,
        requiresConfirmation: true,
      })
    }

    // 2. Identify missing information required for a warranty claim
    const missingFields: string[] = []
    if (!prod.serialNumber) missingFields.push('serial number')
    if (!prod.purchaseDate) missingFields.push('purchase date')
    const hasInvoice = Object.values(prod.documentRoles || {}).includes('invoice')
    if (!hasInvoice && prod.linkedDocumentIds.length > 0) missingFields.push('purchase invoice')

    const matchingContact = contacts.find(
      (c) =>
        c.linkedProductIds.includes(prod.id) ||
        (prod.brand && c.companyName.toLowerCase().includes(prod.brand.toLowerCase()))
    )
    if (!matchingContact) missingFields.push('customer support contact')

    if (missingFields.length > 0 && (prod.warrantyExpiry || prod.linkedDocumentIds.length > 0)) {
      suggestions.push({
        id: `sug_missing_${prod.id}`,
        type: 'missing_claim_info',
        title: `Complete warranty claim details for ${prod.productName}`,
        description: `Missing ${missingFields.join(', ')}. Adding these ensures faster warranty or service support.`,
        priority: 'low',
        suggestedPrompt: `What information is missing for a warranty claim on ${prod.productName}?`,
        linkedProductId: prod.id,
        linkedDocumentId: primaryDocId,
        sourceLabel: primaryDoc?.originalFilename,
        requiresConfirmation: true,
      })
    }
  }

  // 3. Prepare insurance renewal checklists before upcoming insurance deadlines
  const insuranceTasks = tasks.filter(
    (t) => t.status === 'pending' && t.category === 'insurance'
  )
  for (const task of insuranceTasks) {
    const daysLeft = Math.ceil(
      (new Date(task.dueDate).getTime() - refTime) / (1000 * 60 * 60 * 24)
    )
    if (daysLeft <= 60) {
      suggestions.push({
        id: `sug_ins_${task.id}`,
        type: 'insurance_checklist',
        title: `Prepare insurance renewal checklist`,
        description: `"${task.title}" is due on ${task.dueDate}. Gather policy terms and renewal premium details in advance.`,
        priority: daysLeft <= 14 ? 'high' : 'medium',
        suggestedPrompt: `Prepare a renewal checklist for my insurance task "${task.title}"`,
        linkedTaskId: task.id,
        linkedDocumentId: task.linkedDocumentId || undefined,
        sourceLabel: task.linkedDocumentName || undefined,
        requiresConfirmation: true,
      })
    }
  }

  // 4. Suggest contacting customer support before urgent deadlines when a contact exists
  const urgentTasks = tasks.filter((t) => {
    if (t.status !== 'pending') return false
    const daysLeft = Math.ceil(
      (new Date(t.dueDate).getTime() - refTime) / (1000 * 60 * 60 * 24)
    )
    return daysLeft <= 21
  })

  for (const task of urgentTasks) {
    const contact = contacts.find((c) => {
      if (task.linkedDocumentId && c.linkedDocumentIds.includes(task.linkedDocumentId)) {
        return true
      }
      const companyToken = c.companyName.toLowerCase().split(/\s+/)[0]
      return companyToken.length > 2 && task.title.toLowerCase().includes(companyToken)
    })

    if (contact && (contact.phone || contact.email)) {
      const channelInfo = [contact.phone, contact.email].filter(Boolean).join(' · ')
      suggestions.push({
        id: `sug_contact_${task.id}_${contact.id}`,
        type: 'contact_support',
        title: `Contact ${contact.companyName} support before ${task.dueDate}`,
        description: `For "${task.title}", support details are on file (${channelInfo}). Ask AURA to draft a message first — nothing is sent without your approval.`,
        priority: 'medium',
        suggestedPrompt: `Draft a customer support email to ${contact.companyName} regarding "${task.title}"`,
        linkedTaskId: task.id,
        linkedContactId: contact.id,
        linkedDocumentId: task.linkedDocumentId || undefined,
        sourceLabel: task.linkedDocumentName || undefined,
        requiresConfirmation: true,
      })
    }
  }

  // Sort high priority first and cap list cleanly
  const priorityRank: Record<'high' | 'medium' | 'low', number> = {
    high: 0,
    medium: 1,
    low: 2,
  }

  return suggestions
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
    .slice(0, 8)
}
