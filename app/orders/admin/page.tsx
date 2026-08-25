import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getAllOrders, getOrderStats } from '@/app/actions/orders'
import { getUsersByRole } from '@/app/actions/users'
import { AdminDashboard } from './admin-dashboard'

export const metadata = { title: 'Orders Dashboard | Shayona' }

export default async function AdminPage() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    if (u?.role !== 'admin') redirect('/orders')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const [stats, allOrders, pickerRows] = await Promise.all([
    getOrderStats(),
    getAllOrders(),
    getUsersByRole('picker'),
  ])

  // Map picker rows to the shape AdminDashboard expects
  const pickers = pickerRows.map(p => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: 'picker' as const,
    createdAt: new Date(),
  }))

  return <AdminDashboard stats={stats} orders={allOrders} pickers={pickers} />
}
