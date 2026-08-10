import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { DashboardPage } from '@/components/dashboard-page'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

export const metadata = {
  title: 'Dashboard - Shayona Inventory',
  description: 'Manage and view your warehouse inventory',
}

export default async function Dashboard() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/scanner')
  }

  return <DashboardPage />
}
