import { betterAuth } from 'better-auth'
import { pool } from '@/lib/db'

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET environment variable is required')
}

const baseURL =
  process.env.BETTER_AUTH_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.V0_RUNTIME_URL ?? 'http://localhost:3000')

// In development, allow any localhost origin
// In production, strictly validate origins
const trustedOrigins =
  process.env.NODE_ENV === 'development'
    ? [
        baseURL,
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        process.env.V0_RUNTIME_URL || '',
      ]
        .filter(Boolean)
        .concat(
          process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : [],
          process.env.VERCEL_PROJECT_PRODUCTION_URL
            ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
            : []
        )
    : [
        baseURL,
        ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
        ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
        ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
          : []),
      ]

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 8,
  },
  trustedOrigins,
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
})
