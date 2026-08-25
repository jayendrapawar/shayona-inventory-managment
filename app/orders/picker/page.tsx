import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getPickerQueue } from '@/app/actions/orders'
import { PickerDashboard } from './picker-dashboard'

export const metadata = { title: 'Picker — Orders | Shayona' }

export default async function PickerPage() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    if (u?.role !== 'picker' && u?.role !== 'admin') redirect('/orders')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const queue = await getPickerQueue()
  return <PickerDashboard queue={queue} />
}
