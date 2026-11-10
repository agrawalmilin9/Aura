import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { getAllDocuments } from '@/lib/lifefile/storage.ts'
import { getAllProducts, getProductById, validateProductId } from '@/lib/products/storage.ts'
import { getAllTasks } from '@/lib/tasks/storage.ts'
import { getAllContacts } from '@/lib/contacts/storage.ts'
import { getAllMemories } from '@/lib/memory/storage.ts'
import { generateProactiveSuggestions } from '@/lib/intelligence/proactive-suggestions.ts'
import {
  buildProductAssistanceReport,
  type AssistanceMode,
} from '@/lib/intelligence/connected-intelligence.ts'

const VALID_ASSISTANCE_MODES: AssistanceMode[] = [
  'warranty_checklist',
  'support_email_draft',
  'warranty_coverage',
  'service_request_draft',
]

/**
 * GET /api/intelligence
 * Returns connected stats and proactive non-executing suggestions across LifeFile, Products, Contacts, Tasks & Memory.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const { searchParams } = new URL(req.url)
    const refDate = searchParams.get('refDate') || undefined

    const [documents, products, tasks, contacts, memories] = await Promise.all([
      getAllDocuments(userId),
      getAllProducts(refDate, userId),
      getAllTasks(userId),
      getAllContacts(userId),
      getAllMemories(userId),
    ])

    const suggestions = generateProactiveSuggestions({
      documents,
      products,
      tasks,
      contacts,
      referenceDate: refDate,
    })

    const activeWarrantyCount = products.filter(
      (p) => p.warrantyStatus === 'active' || p.warrantyStatus === 'expiring_soon'
    ).length
    const expiringSoonCount = products.filter((p) => p.warrantyStatus === 'expiring_soon').length
    const pendingTaskCount = tasks.filter((t) => t.status === 'pending').length
    const totalStorageBytes = documents.reduce((acc, d) => acc + (d.fileSize || 0), 0)

    return NextResponse.json(
      {
        success: true,
        stats: {
          documentsCount: documents.length,
          productsCount: products.length,
          activeWarrantyCount,
          expiringSoonCount,
          pendingTaskCount,
          contactsCount: contacts.length,
          memoriesCount: memories.length,
          totalStorageBytes,
        },
        suggestions,
      },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to compute connected intelligence: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

/**
 * POST /api/intelligence
 * Generates document-grounded assistance (claim checklist, email draft, service draft, coverage explanation)
 * for a given product without executing any external action.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid JSON request body.' }, { status: 400 })
    }

    const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
    if (!validateProductId(productId)) {
      return NextResponse.json({ success: false, error: 'Valid productId is required.' }, { status: 400 })
    }

    const mode: AssistanceMode = VALID_ASSISTANCE_MODES.includes(body.mode)
      ? body.mode
      : 'warranty_checklist'

    const [product, documents, contacts] = await Promise.all([
      getProductById(productId, undefined, userId),
      getAllDocuments(userId),
      getAllContacts(userId),
    ])

    if (!product) {
      return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 })
    }

    const report = buildProductAssistanceReport({
      product,
      documents,
      contacts,
      mode,
      issueSummary: typeof body.issueSummary === 'string' ? body.issueSummary.trim() : undefined,
    })

    return NextResponse.json({ success: true, report }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to build document assistance report: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
