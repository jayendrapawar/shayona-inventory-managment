import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

export const metadata = {
  title: 'Reports - Shayona Inventory',
  description: 'Inventory analytics and business reports',
}

export default async function ReportsPage() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    const roles = (u?.role ?? 'user').split(',').map(r => r.trim())
    if (!roles.includes('admin') && !roles.includes('accountant')) redirect('/home')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <h1 className="text-2xl font-bold text-foreground">Reports</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming soon</p>
    </div>
  )
}
