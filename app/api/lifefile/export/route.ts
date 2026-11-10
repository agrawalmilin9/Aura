import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { getAllDocuments } from '@/lib/lifefile/storage.ts'
import { getAllProducts } from '@/lib/products/storage.ts'
import { getAllContacts } from '@/lib/contacts/storage.ts'
import { getAllTasks } from '@/lib/tasks/storage.ts'
import { getAllMemories } from '@/lib/memory/storage.ts'

/**
 * GET /api/lifefile/export
 * Exports a portable JSON backup of the authenticated user's LifeFile metadata, extracted facts,
 * products, support contacts, tasks, and user-approved personal memories.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const [documents, products, contacts, tasks, memories] = await Promise.all([
      getAllDocuments(userId),
      getAllProducts(undefined, userId),
      getAllContacts(userId),
      getAllTasks(userId),
      getAllMemories(userId),
    ])

    const sanitizedDocuments = documents.map(({ storageFilename: _internal, ...rest }) => ({
      ...rest,
      fileDownloadUrl: `/api/documents/${rest.id}/file?download=1`,
    }))

    const backupPayload = {
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      workspaceNote: 'AURA Local Personal Backup (excludes API secrets and raw binary blobs)',
      counts: {
        documents: sanitizedDocuments.length,
        products: products.length,
        contacts: contacts.length,
        tasks: tasks.length,
        memories: memories.length,
      },
      documents: sanitizedDocuments,
      products,
      contacts,
      tasks,
      memories,
    }

    const dateTag = new Date().toISOString().split('T')[0]
    const body = JSON.stringify(backupPayload, null, 2)

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="aura-lifefile-backup-${dateTag}.json"`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to export LifeFile backup: ${err?.message || err}` },
      { status: 500 }
    )
  }
}
