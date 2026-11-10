import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getContactById,
  updateContact,
  deleteContact,
  validateContactId,
} from '@/lib/contacts/storage.ts'
import { validateProductId } from '@/lib/products/storage.ts'
import { validateDocumentId } from '@/lib/lifefile/storage.ts'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateContactId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid contact ID format.' }, { status: 400 })
    }
    const contact = await getContactById(id, auth.user.id)
    if (!contact) {
      return NextResponse.json({ success: false, error: 'Contact not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, contact }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to retrieve contact: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateContactId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid contact ID format.' }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid JSON request body.' }, { status: 400 })
    }

    const updates: any = {}
    if (typeof body.companyName === 'string' && body.companyName.trim()) {
      updates.companyName = body.companyName.trim()
    }
    if (body.phone !== undefined) updates.phone = typeof body.phone === 'string' ? body.phone : null
    if (body.email !== undefined) updates.email = typeof body.email === 'string' ? body.email : null
    if (body.website !== undefined) updates.website = typeof body.website === 'string' ? body.website : null
    if (body.notes !== undefined) updates.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    if (Array.isArray(body.linkedProductIds)) {
      const validProdIds = body.linkedProductIds.filter(
        (pid: unknown): pid is string => typeof pid === 'string' && validateProductId(pid)
      )
      if (validProdIds.length !== body.linkedProductIds.length) {
        return NextResponse.json({ success: false, error: 'Invalid product ID in linkedProductIds.' }, { status: 400 })
      }
      updates.linkedProductIds = validProdIds
    }
    if (Array.isArray(body.linkedDocumentIds)) {
      const validDocIds = body.linkedDocumentIds.filter(
        (did: unknown): did is string => typeof did === 'string' && validateDocumentId(did)
      )
      if (validDocIds.length !== body.linkedDocumentIds.length) {
        return NextResponse.json({ success: false, error: 'Invalid document ID in linkedDocumentIds.' }, { status: 400 })
      }
      updates.linkedDocumentIds = validDocIds
    }

    const updated = await updateContact(id, updates, auth.user.id)
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Contact not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, contact: updated }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to update contact: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateContactId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid contact ID format.' }, { status: 400 })
    }
    const deleted = await deleteContact(id, auth.user.id)
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Contact not found.' }, { status: 404 })
    }
    return NextResponse.json({ success: true, deletedId: id }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to delete contact: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
