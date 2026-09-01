import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getSalesmanOrders } from '@/app/actions/orders'
import { loadCatalogue } from '@/app/actions/catalogue'
import { SalesmanDashboard } from './salesman-dashboard'

export const metadata = { title: 'Salesman — Orders | Shayona' }

export default async function SalesmanPage() {
  let sessionUser: { id: string; name?: string | null; email?: string } | null = null
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    sessionUser = session.user
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    const roles = (u?.role ?? 'user').split(',').map(r => r.trim())
    if (!roles.includes('salesman') && !roles.includes('admin')) redirect('/orders')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  // Load orders + catalogue in parallel — one round-trip total
  const [myOrders, catalogue] = await Promise.all([
    getSalesmanOrders(),
    loadCatalogue(),
  ])

  return (
    <SalesmanDashboard
      orders={myOrders}
      userName={sessionUser?.name ?? ''}
      catalogue={catalogue}
    />
  )
}
