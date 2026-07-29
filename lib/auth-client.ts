'use client'

import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL:
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : undefined,
})

export const { signIn, signUp, signOut, useSession } = authClient
