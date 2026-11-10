import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getAllProducts,
  saveProduct,
  syncProductsFromLifeFile,
} from '@/lib/products/storage.ts'
import { getAllDocuments, validateDocumentId } from '@/lib/lifefile/storage.ts'
import { syncContactsFromLifeFile } from '@/lib/contacts/storage.ts'

/**
 * GET /api/products
 * Lists all persistent product records.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { searchParams } = new URL(req.url)
    const refDate = searchParams.get('refDate') || undefined
    const products = await getAllProducts(refDate, auth.user.id)
    return NextResponse.json({ success: true, products }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to retrieve products: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

/**
 * POST /api/products
 * Creates a manual product record (with duplicate detection) or syncs products from LifeFile documents.
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

    if (body.action === 'sync') {
      const documents = await getAllDocuments(userId)
      const syncResult = await syncProductsFromLifeFile(documents, undefined, userId)
      // Also sync contacts associated with those documents and products
      await syncContactsFromLifeFile(documents, syncResult.allProducts, undefined, userId)
      const products = await getAllProducts(undefined, userId)

      return NextResponse.json(
        {
          success: true,
          action: 'sync',
          addedCount: syncResult.added.length,
          updatedCount: syncResult.updated.length,
          skippedCount: syncResult.skippedCount,
          products,
        },
        { status: 200 }
      )
    }

    const productName = typeof body.productName === 'string' ? body.productName.trim() : ''
    if (!productName) {
      return NextResponse.json(
        { success: false, error: 'Product name is required.' },
        { status: 400 }
      )
    }

    const rawDocIds = Array.isArray(body.linkedDocumentIds) ? body.linkedDocumentIds : []
    const validDocIds = rawDocIds.filter(
      (id: unknown): id is string => typeof id === 'string' && validateDocumentId(id)
    )
    if (rawDocIds.length !== validDocIds.length) {
      return NextResponse.json(
        { success: false, error: 'One or more linkedDocumentIds have an invalid format.' },
        { status: 400 }
      )
    }

    const { product, duplicateFound } = await saveProduct({
      productName,
      brand: typeof body.brand === 'string' ? body.brand : null,
      modelNumber: typeof body.modelNumber === 'string' ? body.modelNumber : null,
      serialNumber: typeof body.serialNumber === 'string' ? body.serialNumber : null,
      purchaseDate: typeof body.purchaseDate === 'string' ? body.purchaseDate : null,
      warrantyExpiry: typeof body.warrantyExpiry === 'string' ? body.warrantyExpiry : null,
      warrantyDuration: typeof body.warrantyDuration === 'string' ? body.warrantyDuration : null,
      linkedDocumentIds: validDocIds,
      notes: typeof body.notes === 'string' ? body.notes : null,
      source: 'manual',
    }, userId)

    return NextResponse.json(
      { success: true, product, mergedDuplicate: duplicateFound },
      { status: duplicateFound ? 200 : 201 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to save product: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
