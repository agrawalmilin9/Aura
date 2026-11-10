import type { StoredDocument } from '../lifefile/types.ts'
import type { DocumentSourceReference } from '../lifefile/retrieval.ts'
import type { StoredProduct } from '../products/types.ts'
import type { StoredContact } from '../contacts/types.ts'
import type { StoredTask } from '../tasks/types.ts'
import type { MemoryCategory, MemoryProposal, StoredMemory } from '../memory/types.ts'
import { computeWarrantyStatus } from '../products/storage.ts'
import { detectSensitiveMemoryContent } from '../memory/storage.ts'

export type AssistanceMode =
  | 'warranty_checklist'
  | 'support_email_draft'
  | 'warranty_coverage'
  | 'service_request_draft'

export interface ProductAssistanceReport {
  mode: AssistanceMode
  productName: string
  extractedFacts: string[]
  missingInformation: string[]
  suggestionsAndDraft: string
  sources: DocumentSourceReference[]
}

export interface ConnectedIntelligenceResult {
  isConnectedQuery: boolean
  isAssistanceRequest: boolean
  assistanceMode?: AssistanceMode
  connectedContext: string
  additionalSources: DocumentSourceReference[]
  memoryProposal: MemoryProposal | null
  memoryBlockedReason?: string | null
  memoryContext: string
}

const QUERY_SYNONYMS: Record<string, string> = {
  'वाशिंग मशीन': 'washing machine',
  'मैकबुक': 'macbook',
  'लैपटॉप': 'laptop macbook',
  'वारंटी': 'warranty',
  'बीमा': 'insurance',
  'कंपनी': 'company contact',
  'संपर्क': 'contact',
  'बिल': 'bill invoice',
  'दस्तावेज': 'document documents',
  'प्रोडक्ट': 'product products',
}

function normalizeQuery(text: string): string {
  let cleaned = text.toLowerCase().replace(/[^\w\s\u0900-\u097F]/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [hi, en] of Object.entries(QUERY_SYNONYMS)) {
    if (cleaned.includes(hi)) {
      cleaned += ` ${en}`
    }
  }
  return cleaned
}

function docToSourceRef(doc: StoredDocument, relevantField?: string): DocumentSourceReference {
  return {
    documentId: doc.id,
    originalFilename: doc.originalFilename,
    documentType: doc.extractedData?.documentType || 'Other',
    relevantField,
    fileUrl: `/api/documents/${doc.id}/file`,
  }
}

function dedupeSources(sources: DocumentSourceReference[]): DocumentSourceReference[] {
  const seen = new Set<string>()
  const result: DocumentSourceReference[] = []
  for (const s of sources) {
    if (!seen.has(s.documentId)) {
      seen.add(s.documentId)
      result.push(s)
    }
  }
  return result
}

function findMatchingProducts(query: string, products: StoredProduct[]): StoredProduct[] {
  const norm = normalizeQuery(query)
  const tokens = norm.split(' ').filter((t) => t.length > 2)

  return products.filter((p) => {
    const prodText = `${p.productName} ${p.brand || ''} ${p.modelNumber || ''} ${p.serialNumber || ''}`.toLowerCase()
    const prodTokens = prodText.split(/\s+/).filter((t) => t.length > 2)
    return prodTokens.some((pt) => tokens.includes(pt)) || norm.includes(p.productName.toLowerCase())
  })
}

/**
 * Identifies missing facts needed for a smooth warranty claim or service request.
 */
export function identifyMissingClaimInfo(
  product: StoredProduct,
  linkedDocs: StoredDocument[],
  contacts: StoredContact[]
): string[] {
  const missing: string[] = []
  if (!product.serialNumber) missing.push('Serial number (not found in extracted documents)')
  if (!product.modelNumber) missing.push('Model number')
  if (!product.purchaseDate) missing.push('Purchase date')
  if (!product.warrantyExpiry) missing.push('Warranty expiry date')

  const hasInvoice = linkedDocs.some(
    (d) =>
      product.documentRoles?.[d.id] === 'invoice' ||
      d.extractedData?.documentType === 'Invoice' ||
      d.extractedData?.documentType === 'Receipt'
  )
  if (!hasInvoice) missing.push('Original purchase invoice / receipt document')

  const hasContact = contacts.some(
    (c) =>
      c.linkedProductIds.includes(product.id) ||
      (product.brand && c.companyName.toLowerCase().includes(product.brand.toLowerCase()))
  )
  if (!hasContact) missing.push('Customer-care phone or email contact')

  return missing
}

/**
 * Generates a structured document-based assistance report strictly separating extracted facts, missing fields, and suggestions/drafts.
 */
export function buildProductAssistanceReport(params: {
  product: StoredProduct
  documents: StoredDocument[]
  contacts: StoredContact[]
  mode: AssistanceMode
  issueSummary?: string
}): ProductAssistanceReport {
  const { product, documents, contacts, mode, issueSummary } = params
  const linkedDocs = documents.filter((d) => product.linkedDocumentIds.includes(d.id))
  const relatedContacts = contacts.filter(
    (c) =>
      c.linkedProductIds.includes(product.id) ||
      (product.brand && c.companyName.toLowerCase().includes(product.brand.toLowerCase())) ||
      linkedDocs.some((d) => c.linkedDocumentIds.includes(d.id))
  )

  const extractedFacts: string[] = [
    `Product: ${product.productName}`,
    product.brand ? `Brand / Issuer: ${product.brand}` : null,
    product.modelNumber ? `Model Number: ${product.modelNumber}` : null,
    product.serialNumber ? `Serial Number: ${product.serialNumber}` : null,
    product.purchaseDate ? `Purchase Date: ${product.purchaseDate}` : null,
    product.warrantyExpiry ? `Warranty Expiry: ${product.warrantyExpiry}` : null,
    product.warrantyDuration ? `Warranty Duration: ${product.warrantyDuration}` : null,
  ].filter(Boolean) as string[]

  for (const d of linkedDocs) {
    const role = product.documentRoles?.[d.id] || d.extractedData?.documentType || 'document'
    extractedFacts.push(`Linked ${role}: ${d.originalFilename}`)
    if (d.extractedData?.importantConditions?.length) {
      extractedFacts.push(
        `Document Conditions (${d.originalFilename}): ${d.extractedData.importantConditions.join('; ')}`
      )
    }
  }

  for (const c of relatedContacts) {
    const contactStr = [c.phone, c.email, c.website].filter(Boolean).join(' | ')
    if (contactStr) {
      extractedFacts.push(`Support Contact (${c.companyName}): ${contactStr}`)
    }
  }

  const missingInformation = identifyMissingClaimInfo(product, linkedDocs, contacts)
  const primaryContact = relatedContacts[0]
  const recipientLabel = primaryContact?.email || primaryContact?.companyName || product.brand || 'Customer Support'

  let suggestionsAndDraft = ''
  if (mode === 'warranty_checklist') {
    suggestionsAndDraft = [
      `Suggested Warranty Claim Checklist for ${product.productName}:`,
      `1. Keep ready: ${linkedDocs.length > 0 ? linkedDocs.map((d) => d.originalFilename).join(', ') : 'Purchase invoice & warranty card'}.`,
      `2. Verify product identifiers: Model ${product.modelNumber || '[Missing — add before filing]'}, Serial ${product.serialNumber || '[Missing — check device label]'}.`,
      `3. Reach out to ${primaryContact?.companyName || product.brand || 'manufacturer support'}${primaryContact?.phone ? ` (${primaryContact.phone})` : ''}${primaryContact?.email ? ` or ${primaryContact.email}` : ''} — note: AURA does not place calls or send emails automatically.`,
    ].join('\n')
  } else if (mode === 'support_email_draft') {
    suggestionsAndDraft = [
      `Draft Support Email (Requires Your Review & Approval Before Sending):`,
      `To: ${recipientLabel}`,
      `Subject: Support / Warranty Request — ${product.productName}${product.serialNumber ? ` (Serial: ${product.serialNumber})` : ''}`,
      `Body:`,
      `Hello ${primaryContact?.companyName || product.brand || 'Support'} Team,`,
      `I am writing regarding my ${product.productName}${product.modelNumber ? ` (Model: ${product.modelNumber})` : ''}${product.serialNumber ? `, Serial No: ${product.serialNumber}` : ''}${product.purchaseDate ? `, purchased on ${product.purchaseDate}` : ''}.`,
      `${issueSummary || 'Please assist with warranty verification / service inspection.'}`,
      `Attached reference: ${linkedDocs[0]?.originalFilename || '[Attach purchase invoice]'}.`,
      `Thank you.`,
    ].join('\n')
  } else if (mode === 'service_request_draft') {
    suggestionsAndDraft = [
      `Draft Service Request Summary (Not Submitted Automatically):`,
      `- Appliance / Product: ${product.productName}`,
      `- Brand: ${product.brand || 'Not specified'} | Model: ${product.modelNumber || 'Missing'} | Serial: ${product.serialNumber || 'Missing'}`,
      `- Warranty Status: ${product.warrantyStatus}${product.warrantyExpiry ? ` (until ${product.warrantyExpiry})` : ''}`,
      `- Recommended Support Channel: ${primaryContact ? `${primaryContact.companyName} (${[primaryContact.phone, primaryContact.email, primaryContact.website].filter(Boolean).join(', ')})` : 'Check brand website'}`,
    ].join('\n')
  } else {
    const conditions = linkedDocs.flatMap((d) => d.extractedData?.importantConditions || [])
    suggestionsAndDraft = [
      `Warranty Coverage Summary for ${product.productName}:`,
      conditions.length > 0
        ? `Extracted Terms: ${conditions.join('; ')}`
        : `No detailed policy conditions were extracted in the uploaded documents; refer to the original warranty card/manual.`,
    ].join('\n')
  }

  return {
    mode,
    productName: product.productName,
    extractedFacts,
    missingInformation,
    suggestionsAndDraft,
    sources: dedupeSources(linkedDocs.map((d) => docToSourceRef(d, `Product: ${product.productName}`))),
  }
}

/**
 * Checks whether the user explicitly asked AURA to save a personal memory,
 * and proposes it for confirmation WITHOUT silently saving.
 */
function detectExplicitMemoryRequest(query: string): {
  proposal: MemoryProposal | null
  blockedReason: string | null
} {
  const trimmed = query.trim()
  const patterns = [
    /^(?:please\s+)?remember\s+(?:that\s+)?(.+)/i,
    /^(?:please\s+)?save\s+(?:this\s+)?(?:to|in)\s+(?:my\s+)?memory[:\s]+(.+)/i,
    /^(?:please\s+)?add\s+(?:to\s+)?(?:my\s+)?memory[:\s]+(.+)/i,
    /^याद\s+रखो\s+(?:कि\s+)?(.+)/i,
    /^मेमोरी\s+में\s+सेव\s+करो[:\s]+(.+)/i,
  ]

  let extractedContent: string | null = null
  for (const p of patterns) {
    const m = trimmed.match(p)
    if (m && m[1]?.trim()) {
      extractedContent = m[1].trim()
      break
    }
  }

  if (!extractedContent) {
    return { proposal: null, blockedReason: null }
  }

  const sensitivity = detectSensitiveMemoryContent(extractedContent)
  if (sensitivity.isSensitive) {
    return {
      proposal: null,
      blockedReason: `Blocked for your privacy: ${sensitivity.reason}`,
    }
  }

  let category: MemoryCategory = 'preference'
  const lower = extractedContent.toLowerCase()
  if (lower.includes('family') || lower.includes('wife') || lower.includes('husband') || lower.includes('parents')) {
    category = 'family'
  } else if (lower.includes('home') || lower.includes('address') || lower.includes('apartment') || lower.includes('service centre')) {
    category = 'home'
  } else if (lower.includes('remind') || lower.includes('before') || lower.includes('days')) {
    category = 'reminder_rule'
  }

  return {
    proposal: {
      proposedContent: extractedContent,
      category,
      reason: 'User explicitly requested saving this personal preference/note.',
    },
    blockedReason: null,
  }
}

/**
 * Evaluates cross-module connected queries (Products + Documents + Contacts + Tasks + Approved Memories)
 * and document-based assistance workflows.
 */
export function processConnectedIntelligence(params: {
  query: string
  documents: StoredDocument[]
  products: StoredProduct[]
  contacts: StoredContact[]
  tasks: StoredTask[]
  memories: StoredMemory[]
  referenceDate?: string
}): ConnectedIntelligenceResult {
  const { query, documents, products, contacts, tasks, memories, referenceDate } = params
  const norm = normalizeQuery(query)
  const refStr = referenceDate || new Date().toISOString().split('T')[0]

  const { proposal: memoryProposal, blockedReason: memoryBlockedReason } =
    detectExplicitMemoryRequest(query)

  // Approved personal memory context (kept strictly separate from extracted document facts)
  const approvedMemories = memories.filter((m) => m.approvedByUser === true)
  const memoryContext =
    approvedMemories.length > 0
      ? `USER-APPROVED PERSONAL MEMORIES (User notes only — separate from extracted document facts):\n${approvedMemories
          .map((m, i) => `${i + 1}. [${m.category}] ${m.content}`)
          .join('\n')}`
      : ''

  const contextSections: string[] = []
  const collectedSources: DocumentSourceReference[] = []
  let isConnectedQuery = false
  let isAssistanceRequest = false
  let assistanceMode: AssistanceMode | undefined

  // A. "Which products have warranties expiring soon?"
  const asksExpiringWarranty =
    (norm.includes('product') || norm.includes('appliance') || norm.includes('warrant')) &&
    (norm.includes('expir') || norm.includes('soon') || norm.includes('ending') || norm.includes('renew'))

  if (asksExpiringWarranty) {
    isConnectedQuery = true
    const expiringProducts = products.filter((p) => {
      const status = computeWarrantyStatus(p.warrantyExpiry, refStr)
      if (status === 'expiring_soon' || status === 'expired') return true
      if (p.warrantyExpiry) {
        const diffDays = Math.ceil(
          (new Date(p.warrantyExpiry).getTime() - new Date(refStr).getTime()) / (1000 * 60 * 60 * 24)
        )
        return diffDays <= 120
      }
      return false
    })

    if (expiringProducts.length > 0) {
      const lines = expiringProducts.map((p) => {
        const status = computeWarrantyStatus(p.warrantyExpiry, refStr)
        const linked = documents.filter((d) => p.linkedDocumentIds.includes(d.id))
        linked.forEach((d) => collectedSources.push(docToSourceRef(d, `Warranty Expiry: ${p.warrantyExpiry}`)))
        return `- ${p.productName} (${p.brand || 'Unknown brand'}, Serial: ${p.serialNumber || 'N/A'}) — Warranty Expiry: ${p.warrantyExpiry} [Status: ${status}] — Docs: ${linked.map((d) => d.originalFilename).join(', ') || 'None'}`
      })
      contextSections.push(`CONNECTED PRODUCT WARRANTY QUERY (Reference Date: ${refStr}):\n${lines.join('\n')}`)
    } else {
      contextSections.push(
        `CONNECTED PRODUCT WARRANTY QUERY (Reference Date: ${refStr}):\nNone of the user's ${products.length} stored product(s) have warranties expiring soon.`
      )
    }
  }

  // B. "Show my products with their invoices and manuals" OR "Show all documents associated with [product]"
  const asksProductsAndDocs =
    (norm.includes('product') || norm.includes('document') || norm.includes('invoice') || norm.includes('manual') || norm.includes('associated')) &&
    (norm.includes('show') || norm.includes('list') || norm.includes('with') || norm.includes('associated') || norm.includes('all'))

  if (asksProductsAndDocs && products.length > 0) {
    const matchedProds = findMatchingProducts(query, products)
    const targetProducts = matchedProds.length > 0 ? matchedProds : products

    isConnectedQuery = true
    const lines = targetProducts.map((p) => {
      const linked = documents.filter((d) => p.linkedDocumentIds.includes(d.id))
      const docDescriptions = linked.map((d) => {
        const role = p.documentRoles?.[d.id] || d.extractedData?.documentType || 'document'
        collectedSources.push(docToSourceRef(d, `Product (${role}): ${p.productName}`))
        return `${d.originalFilename} [${role}]`
      })
      return `- Product: ${p.productName} (${p.brand || 'Brand N/A'}, Model: ${p.modelNumber || 'N/A'}, Serial: ${p.serialNumber || 'N/A'}, Warranty Expiry: ${p.warrantyExpiry || 'N/A'})\n  Associated Documents (${linked.length}): ${docDescriptions.join(', ') || 'None linked'}`
    })
    contextSections.push(`CONNECTED PRODUCTS & LINKED DOCUMENTS:\n${lines.join('\n')}`)
  }

  // C. "Which company should I contact for my [product]?"
  const asksSupportContact =
    norm.includes('contact') ||
    norm.includes('company') ||
    norm.includes('customer care') ||
    norm.includes('helpline') ||
    norm.includes('phone') ||
    norm.includes('support') ||
    norm.includes('email') ||
    norm.includes('संपर्क') ||
    norm.includes('कंपनी')

  if (asksSupportContact) {
    const matchedProds = findMatchingProducts(query, products)
    const relevantContacts = contacts.filter((c) => {
      if (matchedProds.some((p) => c.linkedProductIds.includes(p.id) || (p.brand && c.companyName.toLowerCase().includes(p.brand.toLowerCase())))) {
        return true
      }
      const companyTokens = c.companyName.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
      return companyTokens.some((t) => norm.includes(t))
    })

    if (matchedProds.length > 0 || relevantContacts.length > 0) {
      isConnectedQuery = true
      const lines: string[] = []
      for (const p of matchedProds) {
        const pDocs = documents.filter((d) => p.linkedDocumentIds.includes(d.id))
        pDocs.forEach((d) => collectedSources.push(docToSourceRef(d, `Product: ${p.productName}`)))
        lines.push(`Product: ${p.productName} (Brand/Manufacturer: ${p.brand || 'Not extracted'})`)
      }
      for (const c of relevantContacts) {
        const cDocs = documents.filter((d) => c.linkedDocumentIds.includes(d.id))
        cDocs.forEach((d) => collectedSources.push(docToSourceRef(d, `Support Contact: ${c.companyName}`)))
        lines.push(
          `Support Contact: ${c.companyName} | Phone: ${c.phone || 'Not available'} | Email: ${c.email || 'Not available'} | Website: ${c.website || 'Not available'}`
        )
      }
      contextSections.push(`CONNECTED CUSTOMER SUPPORT LOOKUP:\n${lines.join('\n')}`)
    }
  }

  // D. "Which upcoming tasks are linked to my insurance documents?" (or bill/warranty linked tasks)
  const asksLinkedTasks =
    (norm.includes('task') || norm.includes('upcoming') || norm.includes('deadline')) &&
    (norm.includes('linked') || norm.includes('document') || norm.includes('insurance') || norm.includes('warranty') || norm.includes('bill'))

  if (asksLinkedTasks) {
    isConnectedQuery = true
    const wantsInsurance = norm.includes('insurance') || norm.includes('policy')
    const wantsWarranty = norm.includes('warranty')
    const wantsBill = norm.includes('bill')

    const matchingTasks = tasks.filter((t) => {
      if (t.status !== 'pending') return false
      const linkedDoc = t.linkedDocumentId ? documents.find((d) => d.id === t.linkedDocumentId) : undefined
      if (wantsInsurance) {
        return t.category === 'insurance' || linkedDoc?.extractedData?.documentType === 'Insurance'
      }
      if (wantsWarranty) {
        return t.category === 'warranty' || linkedDoc?.extractedData?.documentType === 'Warranty'
      }
      if (wantsBill) {
        return t.category === 'bill' || linkedDoc?.extractedData?.documentType === 'Bill'
      }
      return Boolean(t.linkedDocumentId)
    })

    if (matchingTasks.length > 0) {
      const lines = matchingTasks.map((t) => {
        const linkedDoc = t.linkedDocumentId ? documents.find((d) => d.id === t.linkedDocumentId) : undefined
        if (linkedDoc) {
          collectedSources.push(docToSourceRef(linkedDoc, `Linked Task: ${t.title}`))
        }
        return `- Task: "${t.title}" (Due: ${t.dueDate}, Category: ${t.category}, Priority: ${t.priority}) -> Linked Document: ${linkedDoc?.originalFilename || t.linkedDocumentName || 'None'}`
      })
      contextSections.push(`CONNECTED TASKS & LINKED DOCUMENTS:\n${lines.join('\n')}`)
    } else {
      contextSections.push(`CONNECTED TASKS & LINKED DOCUMENTS:\nNo pending tasks linked to matching documents were found.`)
    }
  }

  // E. Document-Based Assistance (Claim Checklist, Support Email Draft, Coverage Explanation, Service Request Draft, Missing Info)
  if (norm.includes('checklist') || (norm.includes('claim') && norm.includes('warranty'))) {
    isAssistanceRequest = true
    assistanceMode = 'warranty_checklist'
  } else if (norm.includes('draft') && (norm.includes('email') || norm.includes('mail') || norm.includes('support'))) {
    isAssistanceRequest = true
    assistanceMode = 'support_email_draft'
  } else if (norm.includes('service request') || (norm.includes('draft') && norm.includes('service'))) {
    isAssistanceRequest = true
    assistanceMode = 'service_request_draft'
  } else if ((norm.includes('explain') || norm.includes('coverage') || norm.includes('missing')) && (norm.includes('warranty') || norm.includes('claim'))) {
    isAssistanceRequest = true
    assistanceMode = 'warranty_coverage'
  }

  if (isAssistanceRequest && assistanceMode) {
    const matchedProds = findMatchingProducts(query, products)
    const targetProduct = matchedProds[0] || products[0]
    if (targetProduct) {
      const report = buildProductAssistanceReport({
        product: targetProduct,
        documents,
        contacts,
        mode: assistanceMode,
      })
      report.sources.forEach((s) => collectedSources.push(s))
      contextSections.push(
        [
          `DOCUMENT-BASED ASSISTANCE (${assistanceMode.toUpperCase()}):`,
          `VERIFIED EXTRACTED FACTS:\n${report.extractedFacts.map((f) => `- ${f}`).join('\n')}`,
          report.missingInformation.length > 0
            ? `MISSING REQUIRED INFORMATION:\n${report.missingInformation.map((m) => `- ${m}`).join('\n')}`
            : `MISSING REQUIRED INFORMATION:\n- None detected from available fields.`,
          `SUGGESTION / DRAFT (NEVER AUTO-SENT):\n${report.suggestionsAndDraft}`,
          `STRICT INSTRUCTION: Clearly distinguish between "Extracted Facts" from uploaded documents, "Missing Information", and "Suggestions / Draft". Cite exact source filenames.`,
        ].join('\n\n')
      )
    }
  }

  return {
    isConnectedQuery,
    isAssistanceRequest,
    assistanceMode,
    connectedContext: contextSections.join('\n\n'),
    additionalSources: dedupeSources(collectedSources),
    memoryProposal,
    memoryBlockedReason,
    memoryContext,
  }
}
