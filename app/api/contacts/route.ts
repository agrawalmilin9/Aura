import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getAllContacts,
  saveContact,
  syncContactsFromLifeFile,
} from '@/lib/contacts/storage.ts'
import { getAllDocuments, validateDocumentId } from '@/lib/lifefile/storage.ts'
import { getAllProducts, validateProductId } from '@/lib/products/storage.ts'

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const contacts = await getAllContacts(auth.user.id)
    return NextResponse.json({ success: true, contacts }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to retrieve contacts: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid JSON request body.' }, { status: 400 })
    }

    if (body.action === 'sync') {
      const [documents, products] = await Promise.all([
        getAllDocuments(userId),
        getAllProducts(undefined, userId),
      ])
      const syncResult = await syncContactsFromLifeFile(documents, products, undefined, userId)
      const contacts = await getAllContacts(userId)
      return NextResponse.json(
        {
          success: true,
          action: 'sync',
          addedCount: syncResult.added.length,
          updatedCount: syncResult.updated.length,
          contacts,
        },
        { status: 200 }
      )
    }

    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''
    if (!companyName) {
      return NextResponse.json(
        { success: false, error: 'Company name is required.' },
        { status: 400 }
      )
    }

    const rawProdIds = Array.isArray(body.linkedProductIds) ? body.linkedProductIds : []
    const validProdIds = rawProdIds.filter(
      (pid: unknown): pid is string => typeof pid === 'string' && validateProductId(pid)
    )
    const rawDocIds = Array.isArray(body.linkedDocumentIds) ? body.linkedDocumentIds : []
    const validDocIds = rawDocIds.filter(
      (did: unknown): did is string => typeof did === 'string' && validateDocumentId(did)
    )
    if (rawProdIds.length !== validProdIds.length || rawDocIds.length !== validDocIds.length) {
      return NextResponse.json(
        { success: false, error: 'Invalid product or document ID in linked fields.' },
        { status: 400 }
      )
    }

    const { contact, duplicateFound } = await saveContact({
      companyName,
      phone: typeof body.phone === 'string' ? body.phone : null,
      email: typeof body.email === 'string' ? body.email : null,
      website: typeof body.website === 'string' ? body.website : null,
      linkedProductIds: validProdIds,
      linkedDocumentIds: validDocIds,
      notes: typeof body.notes === 'string' ? body.notes : null,
      source: 'manual',
    }, userId)

    return NextResponse.json(
      { success: true, contact, mergedDuplicate: duplicateFound },
      { status: duplicateFound ? 200 : 201 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to save contact: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
