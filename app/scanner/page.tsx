import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { ScannerPage } from '@/components/scanner-page'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

export const metadata = {
  title: 'Scanner - Shayona Inventory',
  description: 'Scan warehouse inventory items',
}

export default async function Scanner() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
  } catch (err) {
    if (isRedirectError(err)) throw err
  }

  return <ScannerPage />
}
