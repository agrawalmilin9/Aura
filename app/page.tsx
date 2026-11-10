import { redirect } from 'next/navigation'
import { getAuthenticatedUserFromCookies } from '@/lib/auth/session.ts'
import { AuraWorkspaceClient } from '@/components/aura/AuraWorkspaceClient.tsx'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const user = await getAuthenticatedUserFromCookies()
  if (!user) {
    redirect('/login')
  }

  return <AuraWorkspaceClient initialUser={user} />
}
