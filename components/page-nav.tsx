'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from '@/lib/auth-client'
import { LanguageToggle } from '@/components/language-toggle'

interface PageNavProps {
  /** Hide the Home button on the /home page itself */
  hideHome?: boolean
}

export function PageNav({ hideHome }: PageNavProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleSignOut() {
    startTransition(async () => {
      await signOut()
      router.push('/sign-in')
    })
  }

  return (
    <div className="flex items-center gap-2">
      {!hideHome && (
        <a
          href="/home"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
        >
          ← Home
        </a>
      )}
      <LanguageToggle />
      <button
        onClick={handleSignOut}
        disabled={isPending}
        className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
      >
        {isPending ? 'Signing out…' : 'Sign Out'}
      </button>
    </div>
  )
}
