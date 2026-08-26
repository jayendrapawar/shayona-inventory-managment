import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getAllUsers } from '@/app/actions/users'
import { MasterDashboard } from './master-dashboard'
import type { Vendor } from './vendors-tab'
import type { Supplier } from './suppliers-tab'
import { readFile } from 'fs/promises'
import path from 'path'

export const metadata = {
  title: 'Master - Shayona Inventory',
  description: 'User management, role assignment & master data',
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const abs = path.join(process.cwd(), filePath)
    const raw = await readFile(abs, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export default async function MasterPage() {
  let currentUserId = ''
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    currentUserId = session.user.id
    const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
    const role = u?.role ?? 'user'
    if (role !== 'admin' && role !== 'accountant') redirect('/home')
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const [allUsers, vendors, suppliers] = await Promise.all([
    getAllUsers(),
    readJson<Vendor[]>('data/vendors.json', []),
    readJson<Supplier[]>('data/suppliers.json', []),
  ])

  return (
    <MasterDashboard
      users={allUsers}
      currentUserId={currentUserId}
      vendors={vendors}
      suppliers={suppliers}
    />
  )
}
