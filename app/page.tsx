import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

export const metadata = {
  title: 'Shayona Inventory Management',
  description: 'Warehouse inventory scanning and management system',
}

export default async function Home() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    redirect('/scanner')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }
}
