import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getBillerQueue } from '@/app/actions/orders'
import { BillerDashboard } from './biller-dashboard'

export const metadata = { title: 'Biller — Orders | Shayona' }

export default async function BillerPage() {
  let currentBillerId = ''
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    currentBillerId = session.user.id
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    const roles = (u?.role ?? 'user').split(',').map(r => r.trim())
    if (!roles.includes('biller') && !roles.includes('admin')) redirect('/orders')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const billerOrders = await getBillerQueue()

  return <BillerDashboard orders={billerOrders} currentBillerId={currentBillerId} />
}
