import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

export const metadata = {
  title: 'Master - Shayona Inventory',
  description: 'Manage master data including products, categories, and suppliers',
}

export default async function MasterPage() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <h1 className="text-2xl font-bold text-foreground">Master</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming soon</p>
    </div>
  )
}
