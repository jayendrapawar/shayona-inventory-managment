import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user, vendors } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { BillingScannerPage, type BillingVendor } from '@/components/billing-scanner-page'

export const metadata = {
  title: 'Billing - Shayona Inventory',
  description: 'Scan boxes and generate vendor bills',
}

export default async function BillingPage() {
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

  // Fetch all active vendors — same data shape as CatalogueVendor used in salesman dashboard
  const vendorRows = await db
    .select()
    .from(vendors)
    .where(eq(vendors.status, 'active'))
    .orderBy(asc(vendors.partyName))

  const billingVendors: BillingVendor[] = vendorRows.map(v => ({
    id:      v.id,
    name:    v.partyName,
    code:    v.area   || null,
    phone:   v.phone  || null,
    address: [v.address, v.city].filter(Boolean).join(', ') || null,
  }))

  return <BillingScannerPage vendors={billingVendors} />
}
