import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

export const metadata = {
  title: 'Orders - Shayona Inventory',
  description: 'Order management portal',
}

export default async function OrdersPage() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')

    const [u] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    const role = u?.role ?? 'user'

    if (role === 'admin')      redirect('/orders/admin')
    if (role === 'salesman')   redirect('/orders/salesman')
    if (role === 'picker')     redirect('/orders/picker')
    if (role === 'dispatcher') redirect('/orders/dispatcher')

    // No role assigned yet
    redirect('/orders/pending-role')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }
}
