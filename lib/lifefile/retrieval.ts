import type { StoredDocument, ExtractedDocumentData, DocumentCategory } from './types.ts'

export interface DocumentSourceReference {
  documentId: string
  originalFilename: string
  documentType: string
  relevantField?: string
  fileUrl: string
}

export interface MatchedDocument {
  document: StoredDocument
  score: number
  matchedFields: string[]
  confidence: 'high' | 'medium' | 'low'
  sourceReference: DocumentSourceReference
}

export interface RetrievalResult {
  query: string
  matchedDocuments: MatchedDocument[]
  hasMatches: boolean
  topMatch?: MatchedDocument
  groundedContext: string
  matchedSources: DocumentSourceReference[]
}

// Multilingual and transliteration normalization map
const TRANSLITERATION_MAP: Record<string, string> = {
  // Hindi Devanagari to English equivalents
  'बिजली': 'electricity bill bijli',
  'वाशिंग': 'washing',
  'मशीन': 'machine',
  'वाशिंग मशीन': 'washing machine',
  'मैकबुक': 'macbook',
  'लैपटॉप': 'laptop macbook',
  'वारंटी': 'warranty',
  'गारंटी': 'warranty guarantee',
  'बीमा': 'insurance policy bima',
  'पॉलिसी': 'policy insurance',
  'रिन्यू': 'renewal renew',
  'रसीद': 'receipt invoice',
  'चालान': 'invoice',
  'बिल': 'bill',
  'तारीख': 'date',
  'दिनांक': 'date',
  'अंतिम': 'due last',
  'खत्म': 'expire expiry',
  'समाप्त': 'expire expiry',
  'राशि': 'amount total',
  'रकम': 'amount total',
  'कितना': 'how much amount',
  'रुपए': 'rupees inr',
  'कंपनी': 'company issuer',
  'सीरियल': 'serial',
  'मॉडल': 'model',
  'शर्तें': 'conditions terms',
  'नियम': 'rules terms',
  'अडानी': 'adani',
  'एचडीएफसी': 'hdfc',
  'एप्पल': 'apple',
  'एलजी': 'lg',
  // Hinglish / English plurals & stems
  'bijli': 'electricity bill bijli',
  'warranties': 'warranty',
  'appliances': 'appliance',
  'policies': 'policy insurance',
  'bills': 'bill',
  'invoices': 'invoice',
  'receipts': 'receipt',
  'documents': 'document',
  'products': 'product',
  'beema': 'insurance',
  'bima': 'insurance',
  'kharid': 'purchase invoice',
  'kitna': 'amount',
  'kab': 'when date',
}

// Category keywords (strictly category concepts, not brands)
const CATEGORY_KEYWORDS: Record<DocumentCategory, string[]> = {
  Bill: ['bill', 'electricity', 'bijli', 'power', 'water', 'gas', 'utility', 'broadband', 'wifi', 'internet', 'mobile', 'recharge', 'energy'],
  Warranty: ['warranty', 'guarantee', 'warranty card', 'guarantee card', 'appliance', 'gadget', 'device'],
  Insurance: ['insurance', 'policy', 'bima', 'beema', 'mediclaim', 'health insurance', 'vehicle insurance', 'life insurance'],
  Invoice: ['invoice', 'purchase', 'order', 'buy', 'bought', 'chalan'],
  Receipt: ['receipt', 'payment', 'paid'],
  Manual: ['manual', 'user guide', 'handbook'],
  Contract: ['contract', 'agreement', 'lease'],
  Other: ['document', 'file'],
}

// Field-specific query intent detectors
const FIELD_INTENTS = [
  {
    field: 'warrantyExpiry',
    keywords: ['warranty', 'guarantee', 'expire', 'expiry', 'validity', 'valid till', 'khatam', 'समाप्त', 'खत्म'],
  },
  {
    field: 'totalAmount',
    keywords: ['amount', 'bill', 'total', 'due', 'pay', 'kitna', 'paise', 'rupees', 'rs', 'inr', '₹', 'राशि', 'रकम', 'cost', 'price'],
  },
  {
    field: 'dueDate',
    keywords: ['due date', 'due', 'pay by', 'last date', 'tarikh', 'अंतिम', 'दिनांक', 'deadline'],
  },
  {
    field: 'expiryDate',
    keywords: ['expiry date', 'expire', 'renewal date', 'renewal', 'renew', 'valid till', 'रिन्यू'],
  },
  {
    field: 'issuer',
    keywords: ['company', 'issuer', 'issued', 'who issued', 'provider', 'konsi company', 'kaunsi', 'कंपनी', 'किसने'],
  },
  {
    field: 'serialNumber',
    keywords: ['serial', 'serial number', 'serial no', 'sr no', 'सीरियल नंबर', 'सीरियल'],
  },
  {
    field: 'modelNumber',
    keywords: ['model', 'model number', 'model no', 'मॉडल'],
  },
  {
    field: 'importantConditions',
    keywords: ['condition', 'conditions', 'terms', 'clause', 'coverage', 'rules', 'exclusions', 'शर्तें', 'नियम'],
  },
]

const RECENCY_KEYWORDS = [
  'latest', 'recent', 'last', 'newest', 'naya', 'नया', 'हालिया', 'पिछला', 'अभी का'
]

/**
 * Normalizes query string and expands transliterated terms.
 */
function normalizeAndExpandText(text: string): { normalized: string; expanded: string; tokens: string[] } {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s\u0900-\u097F₹]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  let expanded = normalized
  for (const [key, val] of Object.entries(TRANSLITERATION_MAP)) {
    if (expanded.includes(key.toLowerCase())) {
      expanded += ` ${val}`
    }
  }

  const tokens = Array.from(new Set(expanded.split(' ').filter((t) => t.length > 1)))
  return { normalized, expanded, tokens }
}

/**
 * Searches and retrieves the most relevant documents from the user's LifeFile.
 */
export function searchLifeFile(
  query: string,
  storedDocuments: StoredDocument[]
): RetrievalResult {
  const { normalized: normQuery, expanded: expandedQuery, tokens: queryTokens } = normalizeAndExpandText(query)

  const isRecencyQuery = RECENCY_KEYWORDS.some((kw) => normQuery.includes(kw) || expandedQuery.includes(kw))

  // Only consider documents that have completed extraction
  const candidateDocs = storedDocuments.filter(
    (d) => d.extractionStatus === 'completed' && d.extractedData
  )

  const scoredDocs: MatchedDocument[] = []

  for (const doc of candidateDocs) {
    const data = doc.extractedData!
    let score = 0
    const matchedFields: string[] = []
    let hasEntityMatch = false

    // 1. Direct Issuer Match (e.g. "Adani", "Apple", "HDFC", "LG")
    if (data.issuer) {
      const normIssuer = data.issuer.toLowerCase()
      const issuerTokens = normIssuer
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !['of', 'in', 'on', 'by', 'to', 'is', 'my', 'or', 'co', 'the', 'and', 'pvt', 'ltd'].includes(t))
      if (
        expandedQuery.includes(normIssuer) ||
        issuerTokens.some((t) => queryTokens.includes(t))
      ) {
        score += 45
        hasEntityMatch = true
        matchedFields.push(`Issuer: ${data.issuer}`)
      }
    }

    // 2. Product Name / Model / Serial Match (e.g. "MacBook Air", "LG 8kg Washing Machine")
    if (data.productName) {
      const normProd = data.productName.toLowerCase()
      const prodTokens = normProd
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !['of', 'in', 'on', 'by', 'to', 'is', 'my', 'or', 'the', 'and'].includes(t))
      if (
        expandedQuery.includes(normProd) ||
        prodTokens.some((t) => queryTokens.includes(t))
      ) {
        score += 45
        hasEntityMatch = true
        matchedFields.push(`Product: ${data.productName}`)
      }
    }

    if (data.serialNumber) {
      const normSerial = data.serialNumber.toLowerCase()
      if (expandedQuery.includes(normSerial) || queryTokens.includes(normSerial)) {
        score += 50
        hasEntityMatch = true
        matchedFields.push(`Serial: ${data.serialNumber}`)
      }
    }

    if (data.modelNumber) {
      const normModel = data.modelNumber.toLowerCase()
      if (expandedQuery.includes(normModel) || queryTokens.includes(normModel)) {
        score += 40
        hasEntityMatch = true
        matchedFields.push(`Model: ${data.modelNumber}`)
      }
    }

    // 3. Filename match
    const normFilename = doc.originalFilename.toLowerCase()
    const filenameTokens = normFilename.split(/[\s_\-.]+/).filter((t) => t.length > 2)
    if (filenameTokens.some((t) => queryTokens.includes(t))) {
      score += 25
      hasEntityMatch = true
      matchedFields.push(`Filename: ${doc.originalFilename}`)
    }

    // 4. Document Type / Category Match
    let hasCategoryMatch = false
    const categoryKeywords = CATEGORY_KEYWORDS[data.documentType] || []
    for (const kw of categoryKeywords) {
      if (expandedQuery.includes(kw) || queryTokens.includes(kw)) {
        score += 25
        hasCategoryMatch = true
        matchedFields.push(`Category: ${data.documentType}`)
        break
      }
    }

    // Special category bridge: if a document has warranty information and user asks for warranty
    if (data.warrantyExpiry && (expandedQuery.includes('warranty') || queryTokens.includes('warranty'))) {
      score += 25
      hasCategoryMatch = true
      matchedFields.push('Warranty coverage present')
    }

    // 4b. Document Title, Supporting Details, and Form Analysis Match
    const DETAIL_STOP_WORDS = new Set(['what', 'when', 'where', 'which', 'this', 'that', 'from', 'with', 'your', 'have', 'does', 'need', 'find', 'show', 'tell', 'give'])
    const meaningfulTokens = queryTokens.filter((t) => t.length > 3 && !DETAIL_STOP_WORDS.has(t))

    if (data.documentTitle && meaningfulTokens.length > 0) {
      const titleText = data.documentTitle.toLowerCase()
      const titleMatches = meaningfulTokens.filter((t) => titleText.includes(t))
      if (titleMatches.length > 0) {
        score += 20 + Math.min(20, titleMatches.length * 10)
        hasEntityMatch = true
        matchedFields.push('Document Title match')
      }
    }

    if (data.supportingDetails && typeof data.supportingDetails === 'object' && meaningfulTokens.length > 0) {
      const detailsText = Object.entries(data.supportingDetails)
        .map(([k, v]) => `${k} ${v}`)
        .join(' ')
        .toLowerCase()
      const detailMatches = meaningfulTokens.filter((t) => detailsText.includes(t))
      if (detailMatches.length > 0) {
        score += 20 + Math.min(25, detailMatches.length * 10)
        hasEntityMatch = true
        matchedFields.push('Supporting Details match')
      }
    }

    if (data.formAnalysis?.isForm && meaningfulTokens.length > 0) {
      const formText = [
        data.formAnalysis.formTitle,
        data.formAnalysis.formPurpose,
        ...(data.formAnalysis.fields || []).map((f) => f.fieldName),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const formMatches = meaningfulTokens.filter((t) => formText.includes(t))
      if (formMatches.length > 0) {
        score += 20 + Math.min(25, formMatches.length * 10)
        hasEntityMatch = true
        matchedFields.push('Form Fields match')
      }
    }

    // 5. Field Intent Match: ONLY award field points if document has entity or category match!
    // This prevents generic words like "expiry" or "date" from falsely matching unrelated documents (e.g. passport vs health insurance)
    if (hasEntityMatch || hasCategoryMatch) {
      for (const intent of FIELD_INTENTS) {
        const hasIntentKeyword = intent.keywords.some((kw) => expandedQuery.includes(kw) || queryTokens.includes(kw))
        const hasFieldValue = Boolean((data as any)[intent.field])

        if (hasIntentKeyword && hasFieldValue) {
          score += 15
          matchedFields.push(`${intent.field}: ${(data as any)[intent.field]}`)
        }
      }

      // Summary and Conditions match
      if (data.summary) {
        const normSummary = data.summary.toLowerCase()
        if (queryTokens.some((t) => t.length > 3 && normSummary.includes(t))) {
          score += 10
          matchedFields.push('Summary match')
        }
      }

      if (data.importantConditions && Array.isArray(data.importantConditions)) {
        const conditionsText = data.importantConditions.join(' ').toLowerCase()
        if (queryTokens.some((t) => t.length > 3 && conditionsText.includes(t))) {
          score += 10
          matchedFields.push('Policy Conditions match')
        }
      }
    }

    // 6. Recency Boost
    if (isRecencyQuery && (hasEntityMatch || hasCategoryMatch)) {
      const docTime = data.documentDate
        ? new Date(data.documentDate).getTime()
        : new Date(doc.uploadTimestamp).getTime()
      if (!isNaN(docTime)) {
        const daysAgo = Math.max(0, (Date.now() - docTime) / (1000 * 60 * 60 * 24))
        score += Math.max(0, 15 - Math.min(15, Math.floor(daysAgo / 30)))
      }
    }

    // Threshold: Must have at least 25 points AND have an entity or category match
    if (score >= 25 && (hasEntityMatch || hasCategoryMatch)) {
      let relevantField: string | undefined
      if (matchedFields.some((f) => f.includes('warrantyExpiry')) && data.warrantyExpiry) {
        relevantField = `Warranty Expiry: ${data.warrantyExpiry}`
      } else if (matchedFields.some((f) => f.includes('totalAmount')) && data.totalAmount !== null) {
        relevantField = `Total Amount: ₹${data.totalAmount}`
      } else if (matchedFields.some((f) => f.includes('dueDate')) && data.dueDate) {
        relevantField = `Due Date: ${data.dueDate}`
      } else if (matchedFields.some((f) => f.includes('expiryDate')) && data.expiryDate) {
        relevantField = `Expiry Date: ${data.expiryDate}`
      } else if (matchedFields.some((f) => f.includes('serialNumber')) && data.serialNumber) {
        relevantField = `Serial Number: ${data.serialNumber}`
      } else if (data.issuer) {
        relevantField = `Issuer: ${data.issuer}`
      }

      scoredDocs.push({
        document: doc,
        score,
        matchedFields: Array.from(new Set(matchedFields)),
        confidence: score >= 50 ? 'high' : score >= 35 ? 'medium' : 'low',
        sourceReference: {
          documentId: doc.id,
          originalFilename: doc.originalFilename,
          documentType: data.documentType,
          relevantField,
          fileUrl: `/api/documents/${doc.id}/file`,
        },
      })
    }
  }

  // Sort matched documents by score descending, or by upload date if recency query
  if (isRecencyQuery) {
    scoredDocs.sort((a, b) => {
      const timeA = new Date(a.document.uploadTimestamp).getTime()
      const timeB = new Date(b.document.uploadTimestamp).getTime()
      return timeB - timeA
    })
  } else {
    scoredDocs.sort((a, b) => b.score - a.score)
  }

  const topMatches = scoredDocs.slice(0, 3)

  let groundedContext = ''
  if (topMatches.length > 0) {
    groundedContext = topMatches
      .map((match, idx) => {
        const d = match.document
        const ext = d.extractedData!
        const content = [
          `[Document ${idx + 1}: "${d.originalFilename}" (ID: ${d.id})]`,
          `- Document Type: ${ext.documentType}`,
          ext.issuer ? `- Issuer / Company: ${ext.issuer}` : null,
          ext.customerName ? `- Customer Name: ${ext.customerName}` : null,
          ext.totalAmount !== null ? `- Total Amount: ${ext.currency || '₹'}${ext.totalAmount}` : null,
          ext.dueDate ? `- Due Date: ${ext.dueDate}` : null,
          ext.documentDate ? `- Document Date: ${ext.documentDate}` : null,
          ext.expiryDate ? `- Expiry Date: ${ext.expiryDate}` : null,
          ext.productName ? `- Product Name: ${ext.productName}` : null,
          ext.modelNumber ? `- Model Number: ${ext.modelNumber}` : null,
          ext.serialNumber ? `- Serial Number: ${ext.serialNumber}` : null,
          ext.purchaseDate ? `- Purchase Date: ${ext.purchaseDate}` : null,
          ext.warrantyDuration ? `- Warranty Duration: ${ext.warrantyDuration}` : null,
          ext.warrantyExpiry ? `- Warranty Expiry: ${ext.warrantyExpiry}` : null,
          ext.policyNumber ? `- Policy Number: ${ext.policyNumber}` : null,
          ext.importantConditions && ext.importantConditions.length > 0
            ? `- Important Conditions: ${ext.importantConditions.join('; ')}`
            : null,
          ext.documentTitle ? `- Title: ${ext.documentTitle}` : null,
          ext.documentKind ? `- Document Kind: ${ext.documentKind}` : null,
          ext.supportingDetails && Object.keys(ext.supportingDetails).length > 0
            ? `- Supporting Details: ${Object.entries(ext.supportingDetails)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' | ')}`
            : null,
          ext.formAnalysis?.isForm
            ? `- Fillable Form Info: ${ext.formAnalysis.formTitle || d.originalFilename} (${ext.formAnalysis.fields?.length || 0} fields; purpose: ${ext.formAnalysis.formPurpose || 'Form'})`
            : null,
          ext.contactDetails ? `- Contact Details: ${ext.contactDetails}` : null,
          ext.summary ? `- Summary: ${ext.summary}` : null,
        ]
          .filter(Boolean)
          .join('\n')

        return content
      })
      .join('\n\n')
  }

  return {
    query,
    matchedDocuments: topMatches,
    hasMatches: topMatches.length > 0,
    topMatch: topMatches[0],
    groundedContext,
    matchedSources: topMatches.map((m) => m.sourceReference),
  }
}
