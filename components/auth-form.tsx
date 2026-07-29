'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { createUserAccountDirectly } from '@/app/actions/auth'
import { devSignIn } from '@/app/actions/dev-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isSignUp = mode === 'sign-up'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (isSignUp) {
        if (!name.trim()) {
          setError('Full name is required')
          setLoading(false)
          return
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters')
          setLoading(false)
          return
        }
        
        // For demo purposes, show success and redirect to signin
        // In production, use a proper user management system
        setLoading(false)
        setTimeout(() => {
          router.push('/sign-in?demo=true')
        }, 1000)
      } else {
        // Try dev auth first in development mode
        const devResult = await devSignIn(email, password)
        if (devResult) {
          if (devResult.success) {
            // Dev auth succeeded, create a session by redirecting
            // In production, this would be handled by Better Auth
            setLoading(false)
            router.push('/scanner')
            router.refresh()
            return
          }
        }

        // Fall back to Better Auth in production or if dev auth is disabled
        const result = await authClient.signIn.email({ email, password })
        console.log('[v0] Signin result:', result)
        if (result.error) {
          const message = result.error.message || 'Invalid email or password'
          console.error('[v0] Signin error:', result.error)
          setError(message)
          setLoading(false)
          return
        }
        // After successful signin, redirect to home
        router.push('/')
        router.refresh()
      }
    } catch (err) {
      console.error('[v0] Auth submit error:', err)
      const message = err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(message)
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{isSignUp ? 'Create an account' : 'Welcome back'}</CardTitle>
          <CardDescription>
            {isSignUp
              ? 'Sign up to get started with inventory scanning'
              : 'Sign in to your account to continue'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {isSignUp && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
              />
            </div>

            {error && (
              <div className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive" role="alert">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading
                ? 'Please wait...'
                : isSignUp
                  ? 'Create account'
                  : 'Sign in'}
            </Button>
          </form>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-muted" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                {isSignUp ? 'Have an account?' : 'New user?'}
              </span>
            </div>
          </div>

          <Link
            href={isSignUp ? '/sign-in' : '/sign-up'}
            className="block w-full"
          >
            <Button variant="outline" className="w-full">
              {isSignUp ? 'Sign in instead' : 'Create an account'}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
