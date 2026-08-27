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
  let currentPickerId = ''
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role, id: user.id }).from(user).where(eq(user.id, session.user.id)).limit(1)
    const roles = (u?.role ?? 'user').split(',').map(r => r.trim())
    if (!roles.includes('picker') && !roles.includes('admin')) redirect('/orders')
    currentPickerId = u?.id ?? session.user.id
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const queue = await getPickerQueue()
  return <PickerDashboard queue={queue} currentPickerId={currentPickerId} />
}
