import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { HomeMenuPage } from '@/components/home-menu-page'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import type { AppRole } from '@/app/actions/users'

export const metadata = {
  title: 'Home - Shayona Inventory',
  description: 'Select a module to manage your warehouse inventory',
}

export default async function Home() {
  let role: AppRole = 'user'
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    role = (u?.role as AppRole) ?? 'user'
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  return <HomeMenuPage role={role} />
}
