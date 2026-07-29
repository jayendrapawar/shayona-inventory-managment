'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isSignUp = mode === 'sign-up'

  async function handleClick() {
    setError(null)
    setStatus('Submitting...')
    setLoading(true)

    try {
      if (isSignUp) {
        if (!name.trim()) { setError('Full name is required'); setLoading(false); setStatus(null); return }
        if (password.length < 8) { setError('Password must be at least 8 characters'); setLoading(false); setStatus(null); return }

        setStatus('Creating account...')
        const res = await fetch('/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        })
        const data = await res.json()
        if (!res.ok || data.code) {
          setError(data.message || 'Could not create account')
          setLoading(false)
          setStatus(null)
          return
        }
        setStatus('Account created! Redirecting...')
        router.push('/sign-in')
      } else {
        if (!email || !password) { setError('Email and password are required'); setLoading(false); setStatus(null); return }

        setStatus('Signing in...')
        const res = await fetch('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const data = await res.json()
        if (!res.ok || data.code) {
          setError(data.message || 'Invalid email or password')
          setLoading(false)
          setStatus(null)
          return
        }
        setStatus('Signed in! Redirecting...')
        router.push('/')
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setLoading(false)
      setStatus(null)
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', background: 'var(--background, #fff)' }}>
      <div style={{ width: '100%', maxWidth: 360, border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, background: 'var(--card, #fff)' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
          {isSignUp ? 'Create an account' : 'Welcome back'}
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: '#6b7280' }}>
          {isSignUp ? 'Sign up to get started with inventory scanning' : 'Sign in to your account to continue'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isSignUp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label htmlFor="name" style={{ fontSize: 14, fontWeight: 500 }}>Full Name</label>
              <input
                id="name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={loading}
                style={inputStyle}
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="email" style={{ fontSize: 14, fontWeight: 500 }}>Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="password" style={{ fontSize: 14, fontWeight: 500 }}>Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, color: '#dc2626' }}>
              {error}
            </div>
          )}

          {status && (
            <div style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontSize: 13, color: '#16a34a' }}>
              {status}
            </div>
          )}

          <button
            onClick={handleClick}
            disabled={loading}
            style={loading ? { ...btnStyle, opacity: 0.6, cursor: 'not-allowed' } : btnStyle}
          >
            {loading ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </div>

        <div style={{ margin: '16px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
          {isSignUp ? 'Have an account?' : 'New user?'}
        </div>

        <Link href={isSignUp ? '/sign-in' : '/sign-up'} style={{ display: 'block', width: '100%', textDecoration: 'none' }}>
          <button style={{ ...btnStyle, background: '#fff', color: '#374151', border: '1px solid #d1d5db', width: '100%' }}>
            {isSignUp ? 'Sign in instead' : 'Create an account'}
          </button>
        </Link>
      </div>
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  height: 36,
  width: '100%',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  padding: '0 10px',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  background: 'transparent',
}

const btnStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  borderRadius: 8,
  border: 'none',
  background: '#111827',
  color: '#fff',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
}
