'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

export function GoogleSignIn() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 32,
          background: 'var(--card, #fff)',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>
            Shayona Inventory
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>
            Sign in to manage your inventory
          </p>
        </div>

        {error && (
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
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            height: 42,
            borderRadius: 8,
            border: '1px solid #d1d5db',
            background: loading ? '#f9fafb' : '#fff',
            color: '#374151',
            fontSize: 15,
            fontWeight: 500,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
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
          {loading ? 'Redirecting to Google...' : 'Continue with Google'}
        </button>
      </div>
    </main>
  )
}
