import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user, vendors } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import type { BillingVendor } from '@/components/billing-scanner-page'
import {
  getAllOrders,
  getOrderStats,
  getAllSalesmanOrders,
  getPickerQueue,
  getBillerQueue,
  getPackedOrders,
  getProcurementSummary,
} from '@/app/actions/orders'
import { getUsersByRole } from '@/app/actions/users'
import { loadCatalogue } from '@/app/actions/catalogue'
import { getSets } from '@/app/actions/sets'
import { AdminHub } from './admin-hub'

export const metadata = { title: 'Admin Hub | Shayona' }

export default async function AdminPage() {
  let adminName = ''
  let adminId   = ''
  let isAccountant = false
  let userRoles: string[] = []
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role, name: user.name, id: user.id }).from(user).where(eq(user.id, session.user.id)).limit(1)
    userRoles = (u?.role ?? 'user').split(',').map(r => r.trim())
    if (!userRoles.includes('admin') && !userRoles.includes('accountant')) redirect('/orders')
    isAccountant = !userRoles.includes('admin') && userRoles.includes('accountant')
    adminName = u?.name ?? session.user.email ?? ''
    adminId   = u?.id   ?? session.user.id    ?? ''
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const [stats, allOrders, pickerRows, adminRows, salesmanOrders, pickerQueue, billerOrders, packedOrders, vendorRows, procurementRows, catalogue, sets] = await Promise.all([
    getOrderStats(),
    getAllOrders(),
    getUsersByRole('picker'),
    getUsersByRole('admin'),
    getAllSalesmanOrders(),
    getPickerQueue(),
    getBillerQueue(),
    getPackedOrders(),
    db.select().from(vendors).where(eq(vendors.status, 'active')).orderBy(asc(vendors.partyName)),
    getProcurementSummary({ status: 'pending' }),
    loadCatalogue(),
    getSets(),
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

  const billingVendors: BillingVendor[] = vendorRows.map(v => ({
    id:      v.id,
    name:    v.partyName,
    code:    v.area   || null,
    phone:   v.phone  || null,
    address: [v.address, v.city].filter(Boolean).join(', ') || null,
  }))

  const dispatchOrders = packedOrders.map(o => {
    const v = vendorMap.get(o.shopkeeperName)
    return { ...o, shopkeeperPhone: v?.phone ?? null, shopkeeperAddress: v?.address ?? null }
  })

  return (
    <AdminHub
      adminName={adminName}
      adminId={adminId}
      isAccountant={isAccountant}
      userRoles={userRoles}
      stats={stats}
      allOrders={allOrders}
      pickers={pickers}
      salesmanOrders={salesmanOrders}
      pickerQueue={pickerQueue}
      billerOrders={billerOrders}
      dispatchOrders={dispatchOrders}
      procurementRows={procurementRows}
      catalogue={catalogue}
      sets={sets}
      billingVendors={billingVendors}
    />
  )
}
