import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user, vendors } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getSalesmanOrders, getPickerQueue, getBillerQueue, getPackedOrders } from '@/app/actions/orders'
import { loadCatalogue } from '@/app/actions/catalogue'
import { MultiRoleOrdersHub } from './_components/multi-role-hub'
import type { BillingVendor } from '@/components/billing-scanner-page'

export const metadata = {
  title: 'Orders - Shayona Inventory',
  description: 'Order management portal',
}

async function loadVendorMap() {
  const rows = await db.select({
    partyName: vendors.partyName,
    phone: vendors.phone,
    address: vendors.address,
    city: vendors.city,
  }).from(vendors)
  return new Map(rows.map(v => [
    v.partyName,
    {
      phone: v.phone || null,
      address: [v.address, v.city].filter(Boolean).join(', ') || null,
    },
  ]))
}

export default async function OrdersPage() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')

    const [u] = await db
      .select({ role: user.role, id: user.id })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    const roles = (u?.role ?? 'user').split(',').map(r => r.trim())

    if (roles.includes('admin') || roles.includes('accountant')) {
      redirect('/orders/admin')
    }

    const orderRoles = roles.filter(r => ['salesman', 'picker', 'biller', 'dispatcher'].includes(r))

    if (orderRoles.length === 0) {
      redirect('/orders/pending-role')
    }

    // Load data for all assigned order roles and render the multi-tab Order Hub
    let salesmanOrders: any[] = []
    let pickerQueue: any[] = []
    let billerOrders: any[] = []
    let dispatcherOrders: any[] = []

    const promises: Promise<any>[] = []

    if (orderRoles.includes('salesman')) {
      promises.push(getSalesmanOrders().then(res => { salesmanOrders = res }))
    }
    if (orderRoles.includes('picker')) {
      promises.push(getPickerQueue().then(res => { pickerQueue = res }))
    }
    if (orderRoles.includes('biller')) {
      promises.push(getBillerQueue().then(res => { billerOrders = res }))
    }
    if (orderRoles.includes('dispatcher')) {
      promises.push(
        Promise.all([getPackedOrders(), loadVendorMap()]).then(([packed, vendorMap]) => {
          dispatcherOrders = packed.map(o => {
            const v = vendorMap.get(o.shopkeeperName)
            return { ...o, shopkeeperPhone: v?.phone ?? null, shopkeeperAddress: v?.address ?? null }
          })
        })
      )
    }

    const [catalogue, vendorRows] = await Promise.all([
      loadCatalogue(),
      db.select().from(vendors).where(eq(vendors.status, 'active')).orderBy(asc(vendors.partyName)),
      ...promises,
    ])

    const billingVendors: BillingVendor[] = vendorRows.map(v => ({
      id:      v.id,
      name:    v.partyName,
      code:    v.area   || null,
      phone:   v.phone  || null,
      address: [v.address, v.city].filter(Boolean).join(', ') || null,
    }))

    return (
      <MultiRoleOrdersHub
        roles={roles}
        salesmanOrders={salesmanOrders}
        userName={session.user.name ?? ''}
        pickerQueue={pickerQueue}
        currentPickerId={u?.id ?? session.user.id}
        billerOrders={billerOrders}
        currentBillerId={u?.id ?? session.user.id}
        dispatcherOrders={dispatcherOrders}
        catalogue={catalogue}
        billingVendors={billingVendors}
      />
    )
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }
}
