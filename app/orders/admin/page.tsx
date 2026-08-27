import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user, vendors } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import {
  getAllOrders,
  getOrderStats,
  getAllSalesmanOrders,
  getPickerQueue,
  getPackedOrders,
  getProcurementSummary,
} from '@/app/actions/orders'
import { getUsersByRole } from '@/app/actions/users'
import { AdminHub } from './admin-hub'

export const metadata = { title: 'Admin Hub | Shayona' }

export default async function AdminPage() {
  let adminName = ''
  let adminId   = ''
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role, name: user.name, id: user.id }).from(user).where(eq(user.id, session.user.id)).limit(1)
    const roles = (u?.role ?? 'user').split(',').map(r => r.trim())
    if (!roles.includes('admin')) redirect('/orders')
    adminName = u?.name ?? session.user.email ?? ''
    adminId   = u?.id   ?? session.user.id    ?? ''
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const [stats, allOrders, pickerRows, adminRows, salesmanOrders, pickerQueue, packedOrders, vendorRows, procurementRows] = await Promise.all([
    getOrderStats(),
    getAllOrders(),
    getUsersByRole('picker'),
    getUsersByRole('admin'),
    getAllSalesmanOrders(),
    getPickerQueue(),
    getPackedOrders(),
    db.select({ partyName: vendors.partyName, phone: vendors.phone, address: vendors.address, city: vendors.city }).from(vendors),
    getProcurementSummary({ status: 'pending' }),
  ])

  // Merge pickers + admins (admins can also act as pickers); deduplicate by id
  const pickerSet = new Map([...adminRows, ...pickerRows].map(p => [p.id, p]))
  const pickers = Array.from(pickerSet.values()).map(p => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: 'picker' as const,
    createdAt: new Date(),
  }))

  const vendorMap = new Map(vendorRows.map(v => [
    v.partyName,
    {
      phone: v.phone || null,
      address: [v.address, v.city].filter(Boolean).join(', ') || null,
    },
  ]))

  const dispatchOrders = packedOrders.map(o => {
    const v = vendorMap.get(o.shopkeeperName)
    return { ...o, shopkeeperPhone: v?.phone ?? null, shopkeeperAddress: v?.address ?? null }
  })

  return (
    <AdminHub
      adminName={adminName}
      adminId={adminId}
      stats={stats}
      allOrders={allOrders}
      pickers={pickers}
      salesmanOrders={salesmanOrders}
      pickerQueue={pickerQueue}
      dispatchOrders={dispatchOrders}
      procurementRows={procurementRows}
    />
  )
}
