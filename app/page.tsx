import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export const metadata = {
  title: 'Shayona Inventory Management',
  description: 'Warehouse inventory scanning and management system',
}

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    redirect('/sign-in')
  }

  // Redirect to scanner (main interface for all users)
  redirect('/scanner')
}
