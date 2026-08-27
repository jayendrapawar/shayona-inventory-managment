import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user, vendors } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getPackedOrders } from '@/app/actions/orders'
import { DispatcherDashboard } from './dispatcher-dashboard'

export const metadata = { title: 'Dispatcher — Orders | Shayona' }

async function loadVendorMap(): Promise<Map<string, { phone: string | null; address: string | null }>> {
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

export default async function DispatcherPage() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    const roles = (u?.role ?? 'user').split(',').map(r => r.trim())
    if (!roles.includes('dispatcher') && !roles.includes('admin')) redirect('/orders')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const [packedOrders, vendorMap] = await Promise.all([getPackedOrders(), loadVendorMap()])

  const enriched = packedOrders.map(o => {
    const v = vendorMap.get(o.shopkeeperName)
    return { ...o, shopkeeperPhone: v?.phone ?? null, shopkeeperAddress: v?.address ?? null }
  })

  return <DispatcherDashboard orders={enriched} />
}
