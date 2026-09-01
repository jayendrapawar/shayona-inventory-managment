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
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {!hideHome && (
        <a
          href="/home"
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
          aria-label="Home"
        >
          <span aria-hidden>←</span>
          <span className="hidden sm:inline ml-1">Home</span>
        </a>
      )}
      <LanguageToggle />
      <button
        onClick={handleSignOut}
        disabled={isPending}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
        aria-label="Sign out"
      >
        {isPending
          ? <span className="hidden sm:inline">Signing out…</span>
          : (
            <>
              {/* Icon always; label hidden on very small screens */}
              <svg className="inline w-3.5 h-3.5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Sign Out</span>
            </>
          )
        }
      </button>
    </div>
  )
}
