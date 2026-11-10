import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getProductById,
  updateProduct,
  deleteProduct,
  validateProductId,
} from '@/lib/products/storage.ts'
import { handleProductDeletedForContacts } from '@/lib/contacts/storage.ts'
import { validateDocumentId } from '@/lib/lifefile/storage.ts'
import type { ProductDocumentRole } from '@/lib/products/types.ts'

const VALID_ROLES: ProductDocumentRole[] = ['invoice', 'warranty', 'manual', 'service', 'other']

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateProductId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid product ID format.' }, { status: 400 })
    }
    const product = await getProductById(id, undefined, auth.user.id)
    if (!product) {
      return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, product }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to retrieve product: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateProductId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid product ID format.' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid JSON request body.' }, { status: 400 })
    }

    const updates: any = {}
    if (typeof body.productName === 'string' && body.productName.trim()) {
      updates.productName = body.productName.trim()
    }
    if (body.brand !== undefined) updates.brand = typeof body.brand === 'string' ? body.brand.trim() || null : null
    if (body.modelNumber !== undefined) updates.modelNumber = typeof body.modelNumber === 'string' ? body.modelNumber.trim() || null : null
    if (body.serialNumber !== undefined) updates.serialNumber = typeof body.serialNumber === 'string' ? body.serialNumber.trim() || null : null
    if (body.purchaseDate !== undefined) updates.purchaseDate = typeof body.purchaseDate === 'string' ? body.purchaseDate.trim() || null : null
    if (body.warrantyExpiry !== undefined) updates.warrantyExpiry = typeof body.warrantyExpiry === 'string' ? body.warrantyExpiry.trim() || null : null
    if (body.warrantyDuration !== undefined) updates.warrantyDuration = typeof body.warrantyDuration === 'string' ? body.warrantyDuration.trim() || null : null
    if (body.notes !== undefined) updates.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    if (Array.isArray(body.linkedDocumentIds)) {
      const validIds = body.linkedDocumentIds.filter(
        (docId: unknown): docId is string => typeof docId === 'string' && validateDocumentId(docId)
      )
      if (validIds.length !== body.linkedDocumentIds.length) {
        return NextResponse.json(
          { success: false, error: 'Invalid document ID inside linkedDocumentIds.' },
          { status: 400 }
        )
      }
      updates.linkedDocumentIds = validIds
    }
    if (body.documentRoles && typeof body.documentRoles === 'object') {
      const sanitizedRoles: Record<string, ProductDocumentRole> = {}
      for (const [docId, role] of Object.entries(body.documentRoles)) {
        if (validateDocumentId(docId) && VALID_ROLES.includes(role as ProductDocumentRole)) {
          sanitizedRoles[docId] = role as ProductDocumentRole
        }
      }
      updates.documentRoles = sanitizedRoles
    }

    const updated = await updateProduct(id, updates, auth.user.id)
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, product: updated }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to update product: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const { id } = await context.params
    if (!validateProductId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid product ID format.' }, { status: 400 })
    }
    const deleted = await deleteProduct(id, userId)
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Product not found.' }, { status: 404 })
    }
    try {
      await handleProductDeletedForContacts(id, userId)
    } catch {}
    return NextResponse.json({ success: true, deletedId: id }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to delete product: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
