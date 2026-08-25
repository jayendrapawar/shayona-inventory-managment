import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getPackedOrders } from '@/app/actions/orders'
import { DispatcherDashboard } from './dispatcher-dashboard'

export const metadata = { title: 'Dispatcher — Orders | Shayona' }

export default async function DispatcherPage() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    if (u?.role !== 'dispatcher' && u?.role !== 'admin') redirect('/orders')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const packedOrders = await getPackedOrders()
  return <DispatcherDashboard orders={packedOrders} />
}
