import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user, vendors } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getSalesmanOrders, getPickerQueue, getPackedOrders } from '@/app/actions/orders'
import { MultiRoleOrdersHub } from './_components/multi-role-hub'

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

    const orderRoles = roles.filter(r => ['salesman', 'picker', 'dispatcher'].includes(r))

    if (orderRoles.length === 0) {
      redirect('/orders/pending-role')
    }

    // If they have only ONE role, redirect directly to their standalone workflow as before.
    if (orderRoles.length === 1) {
      const singleRole = orderRoles[0]
      redirect(`/orders/${singleRole}`)
    }

    // If they have MULTIPLE order roles, load all needed data in parallel and show the multi-role tab layout!
    let salesmanOrders: any[] = []
    let pickerQueue: any[] = []
    let dispatcherOrders: any[] = []

    const promises: Promise<any>[] = []

    if (orderRoles.includes('salesman')) {
      promises.push(getSalesmanOrders().then(res => { salesmanOrders = res }))
    }
    if (orderRoles.includes('picker')) {
      promises.push(getPickerQueue().then(res => { pickerQueue = res }))
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

    await Promise.all(promises)

    return (
      <MultiRoleOrdersHub
        roles={roles}
        salesmanOrders={salesmanOrders}
        userName={session.user.name ?? ''}
        pickerQueue={pickerQueue}
        currentPickerId={u?.id ?? session.user.id}
        dispatcherOrders={dispatcherOrders}
      />
    )
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }
}
