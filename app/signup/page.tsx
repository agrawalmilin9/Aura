import { redirect } from 'next/navigation'
import { getAuthenticatedUserFromCookies } from '@/lib/auth/session.ts'
import { AuthFormCard } from '@/components/aura/AuthFormCard.tsx'

export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  const user = await getAuthenticatedUserFromCookies()
  if (user) {
    redirect('/')
  }
  return <AuthFormCard mode="signup" />
}
