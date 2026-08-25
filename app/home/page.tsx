import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { HomeMenuPage } from '@/components/home-menu-page'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

export const metadata = {
  title: 'Home - Shayona Inventory',
  description: 'Select a module to manage your warehouse inventory',
}

export default async function Home() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  return <HomeMenuPage />
}
