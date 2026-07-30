import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { DashboardPage } from '@/components/dashboard-page'

export const metadata = {
  title: 'Dashboard - Shayona Inventory',
  description: 'Manage and view your warehouse inventory',
}

export default async function Dashboard() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    redirect('/sign-in')
  }

  return (
    <DashboardPage
      userName={session.user.name ?? session.user.email ?? 'You'}
    />
  )
}
