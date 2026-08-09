import { betterAuth } from 'better-auth'
import { pool } from '@/lib/db'

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET environment variable is required')
}

// In production use the explicit URL; in dev fall back to localhost
const baseURL =
  process.env.BETTER_AUTH_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000')

// Static trusted origins — always include both known Vercel domains
const staticTrustedOrigins: string[] = [
  baseURL,
  'https://shayona-footwear.vercel.app',
  'https://shayona-inventory-managment.vercel.app',
]
if (process.env.VERCEL_URL)
  staticTrustedOrigins.push(`https://${process.env.VERCEL_URL}`)
if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
  staticTrustedOrigins.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)

// In development accept any origin — covers localhost, LAN IPs (192.168.x.x),
// phones on the same WiFi, etc. In production the static list is used.
const trustedOrigins =
  process.env.NODE_ENV === 'development'
    ? (request?: Request) => {
        const origin = request?.headers.get('origin') || ''
        return origin ? [origin] : []
      }
    : staticTrustedOrigins

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  trustedOrigins,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      // Trust Google's verified email — safe because Google only returns
      // verified emails in the OAuth response.
      trustedProviders: ['google'],
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,       // rolling — extends 1 day on each visit
  },
})
