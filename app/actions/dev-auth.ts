// Development-only authentication for quick testing
// This is only active in development mode - remove for production

const DEV_USERS: Record<string, { password: string; name: string }> = {
  'demo@shayona.com': { password: 'Demo12345!', name: 'Demo User' },
  'test@example.com': { password: 'Test12345!', name: 'Test User' },
  'admin@shayona.com': { password: 'Admin12345!', name: 'Admin User' },
}

export function devSignIn(email: string, password: string) {
  if (process.env.NODE_ENV !== 'development') {
    return null
  }

  const user = DEV_USERS[email]
  if (user && user.password === password) {
    return {
      success: true,
      user: {
        id: 'dev-' + email.replace(/[^a-z0-9]/g, ''),
        email,
        name: user.name,
      },
    }
  }

  return null
}
