'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { useLanguage } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'
import { useOnline } from '@/lib/use-online'

export function GoogleSignIn() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useLanguage()
  const isOnline = useOnline()

  async function handleGoogleSignIn() {
    setError(null)
    setLoading(true)
    try {
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
      setLoading(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 16px',
        background: 'var(--background, #fff)',
      }}
    >
      {/* Language toggle — top-right corner */}
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <LanguageToggle />
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 360,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 'clamp(20px, 5vw, 32px)',
          background: 'var(--card, #fff)',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(17px, 5vw, 20px)', fontWeight: 600 }}>
            {t('appName')}
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>
            {t('signInSubtitle')}
          </p>
          {!isOnline && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              marginTop: 14, padding: '10px 14px',
              background: '#fefce8', border: '1px solid #fde047',
              borderRadius: 8, fontSize: 13, color: '#854d0e', textAlign: 'left',
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }}>
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
              <span>You are offline. Sign-in requires an internet connection.</span>
            </div>
          )}
        </div>

        {/* Only show auth errors when online — offline errors are shown via the banner */}
        {error && isOnline && (
          <div
            style={{
              marginBottom: 16,
              padding: '8px 12px',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: 8,
              fontSize: 13,
              color: '#dc2626',
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={loading || !isOnline}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            height: 42,
            borderRadius: 8,
            border: '1px solid #d1d5db',
            background: (loading || !isOnline) ? '#f9fafb' : '#fff',
            color: (loading || !isOnline) ? '#9ca3af' : '#374151',
            fontSize: 15,
            fontWeight: 500,
            cursor: (loading || !isOnline) ? 'not-allowed' : 'pointer',
            opacity: (loading || !isOnline) ? 0.6 : 1,
          }}
        >
          {!loading && (
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-21 0-1.3-.2-2.7-.5-4z"
              />
              <path
                fill="#34A853"
                d="M6.3 14.7l7 5.1C15 16.1 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 6.4 6.3 14.7z"
              />
              <path
                fill="#FBBC05"
                d="M24 46c5.5 0 10.5-1.9 14.3-5l-6.6-5.4C29.8 37.3 27 38 24 38c-6 0-11.1-3.9-13-9.4l-7 5.4C7.5 41.8 15.2 46 24 46z"
              />
              <path
                fill="#EA4335"
                d="M44.5 20H24v8.5h11.8c-.8 2.4-2.4 4.4-4.5 5.8l6.6 5.4C41.8 36.8 45 31 45 24c0-1.4-.2-2.7-.5-4z"
              />
            </svg>
          )}
          {loading ? t('redirectingToGoogle') : t('continueWithGoogle')}
        </button>
      </div>
    </main>
  )
}
