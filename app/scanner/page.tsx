import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { ScannerPage } from '@/components/scanner-page'

export const metadata = {
  title: 'Scanner - Shayona Inventory',
  description: 'Scan warehouse inventory items',
}

export default async function Scanner() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user) {
    redirect('/sign-in')
  }

  return <ScannerPage />
}
