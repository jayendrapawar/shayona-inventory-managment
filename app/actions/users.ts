'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

export type AppRole = 'admin' | 'accountant' | 'salesman' | 'picker' | 'dispatcher' | 'user'

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
  if (u?.role !== 'admin') throw new Error('Forbidden')
  return session.user
}

export async function getAllUsers() {
  await requireAdmin()
  return db
    .select({ id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt })
    .from(user)
    .orderBy(user.createdAt)
}

export async function getUsersByRole(role: AppRole) {
  await requireAdmin()
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.role, role))
}

export async function updateUserRole(userId: string, role: AppRole) {
  await requireAdmin()
  await db.update(user).set({ role }).where(eq(user.id, userId))
  revalidatePath('/master')
  revalidatePath('/orders/admin')
}

export async function getPickersList() {
  // Used by admin to assign pickers to orders
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.role, 'picker'))
}

export async function getCurrentUserRole(): Promise<AppRole> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return 'user'
  const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id)).limit(1)
  return (u?.role as AppRole) ?? 'user'
}
