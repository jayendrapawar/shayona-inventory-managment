'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { orders, orderItems, user } from '@/lib/db/schema'
import type { OrderStatus } from '@/lib/db/schema'
import { eq, desc, inArray, sql, and, ilike } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user
}

async function requireRole(...roles: string[]) {
  const u = await getSession()
  const dbUser = await db.select({ role: user.role }).from(user).where(eq(user.id, u.id)).limit(1)
  const role = dbUser[0]?.role ?? 'user'
  if (!roles.includes(role)) throw new Error('Forbidden')
  return { ...u, role }
}

// ── Order-number generator ────────────────────────────────────────────────────

function genOrderNumber() {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const rand = Math.floor(Math.random() * 9000) + 1000
  return `ORD-${ymd}-${rand}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrderItemInput {
  artNumber: string
  colorNumber?: string
  sizeNumber?: string
  quantityOrdered: number
}

export interface CreateOrderInput {
  shopkeeperName: string
  notes?: string
  items: OrderItemInput[]
}

// ── Salesman actions ──────────────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput) {
  const u = await requireRole('salesman', 'admin')

  if (!input.items.length) throw new Error('At least one item required')

  const [order] = await db.insert(orders).values({
    orderNumber: genOrderNumber(),
    shopkeeperName: input.shopkeeperName,
    salesmanId: u.id,
    notes: input.notes,
    status: 'pending',
  }).returning()

  await db.insert(orderItems).values(
    input.items.map((item) => ({
      orderId: order.id,
      artNumber: item.artNumber.toUpperCase(),
      colorNumber: item.colorNumber?.toUpperCase(),
      sizeNumber: item.sizeNumber?.toUpperCase(),
      quantityOrdered: item.quantityOrdered,
    }))
  )

  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/salesman')
  return order
}

export async function updateOrder(orderId: number, input: CreateOrderInput) {
  const u = await requireRole('salesman', 'admin')
  const [order] = await db.select({ salesmanId: orders.salesmanId, status: orders.status })
    .from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  if (order.salesmanId !== u.id && u.role !== 'admin') throw new Error('Forbidden')
  if (!['pending', 'assigned'].includes(order.status)) throw new Error('Only pending or assigned orders can be edited')

  // Replace shopkeeper name + notes
  await db.update(orders)
    .set({ shopkeeperName: input.shopkeeperName, notes: input.notes ?? null, updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))

  // Replace all items: delete old, insert new
  await db.delete(orderItems).where(eq(orderItems.orderId, orderId))
  await db.insert(orderItems).values(
    input.items.map(item => ({
      orderId,
      artNumber: item.artNumber.toUpperCase(),
      colorNumber: item.colorNumber?.toUpperCase(),
      sizeNumber: item.sizeNumber?.toUpperCase(),
      quantityOrdered: item.quantityOrdered,
    }))
  )

  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/salesman')
}

export async function getSalesmanOrders() {
  const u = await requireRole('salesman', 'admin')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      status: orders.status,
      notes: orders.notes,
      orderedAt: orders.orderedAt,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(eq(orders.salesmanId, u.id))
    .orderBy(desc(orders.orderedAt))
}

/** Admin-only: returns ALL orders regardless of salesmanId. */
export async function getAllSalesmanOrders() {
  await requireRole('admin')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      status: orders.status,
      notes: orders.notes,
      orderedAt: orders.orderedAt,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .orderBy(desc(orders.orderedAt))
}

export async function getSalesmanOrderWithItems(orderId: number) {
  const u = await requireRole('salesman', 'admin')
  const [order] = await db.select().from(orders)
    .where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  if (order.salesmanId !== u.id && u.role !== 'admin') throw new Error('Forbidden')
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  return { order, items }
}

export async function cancelOrder(orderId: number) {
  const u = await requireRole('salesman', 'admin')
  const [order] = await db.select({ salesmanId: orders.salesmanId, status: orders.status })
    .from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  if (order.salesmanId !== u.id && u.role !== 'admin') throw new Error('Forbidden')
  if (!['pending', 'assigned'].includes(order.status)) throw new Error('Only pending or assigned orders can be cancelled')
  await db.update(orders)
    .set({ status: 'cancelled', updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/salesman')
}

// ── Picker actions ────────────────────────────────────────────────────────────

export async function getPickerQueue() {
  await requireRole('picker', 'admin')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      status: orders.status,
      orderedAt: orders.orderedAt,
      pickerId: orders.pickerId,
      totalPairs: sql<number>`cast(coalesce(sum(${orderItems.quantityOrdered}), 0) as int)`,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(inArray(orders.status, ['pending', 'assigned']))
    .groupBy(orders.id)
    .orderBy(desc(orders.orderedAt))
}

/** Picker self-assigns a pending (unassigned) order to themselves. */
export async function selfAssignOrder(orderId: number): Promise<{ orderId: number; pickerId: string }> {
  const u = await requireRole('picker', 'admin')
  // Use a conditional UPDATE (WHERE pickerId IS NULL AND status = 'pending') to prevent
  // a race condition where two pickers claim the same order simultaneously.
  const result = await db.update(orders)
    .set({ pickerId: u.id, status: 'assigned', updatedAt: sql`now()` })
    .where(and(eq(orders.id, orderId), eq(orders.status, 'pending'), sql`${orders.pickerId} is null`))
    .returning({ id: orders.id })
  if (result.length === 0) throw new Error('Order is no longer available')
  revalidatePath('/orders')
  revalidatePath('/orders/picker')
  revalidatePath('/orders/admin')
  return { orderId, pickerId: u.id }
}

/** Picker releases an order they previously claimed back to unassigned/pending. */
export async function unassignOrder(orderId: number): Promise<{ orderId: number }> {
  const u = await requireRole('picker', 'admin')
  const [order] = await db.select({ status: orders.status, pickerId: orders.pickerId })
    .from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  if (order.status !== 'assigned') throw new Error('Only assigned orders can be released')
  if (order.pickerId !== u.id && u.role !== 'admin') throw new Error('You can only release orders assigned to you')
  await db.update(orders)
    .set({ pickerId: null, status: 'pending', updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/picker')
  revalidatePath('/orders/admin')
  return { orderId }
}

export async function getOrderWithItems(orderId: number) {
  await requireRole('picker', 'dispatcher', 'admin', 'salesman')
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  return { order, items }
}

export async function updateItemPacked(itemId: number, quantityPacked: number) {
  await requireRole('picker', 'admin')
  const [item] = await db.select().from(orderItems).where(eq(orderItems.id, itemId)).limit(1)
  if (!item) throw new Error('Item not found')

  const newStatus = quantityPacked >= item.quantityOrdered ? 'packed' : 'pending'

  await db.update(orderItems)
    .set({ quantityPacked, status: newStatus, updatedAt: sql`now()` })
    .where(eq(orderItems.id, itemId))

  revalidatePath('/orders')
  revalidatePath('/orders/admin')
}

export async function markItemOutOfStock(itemId: number) {
  await requireRole('picker', 'admin')
  await db.update(orderItems)
    .set({ status: 'out_of_stock', updatedAt: sql`now()` })
    .where(eq(orderItems.id, itemId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
}

export async function markOrderPacked(orderId: number) {
  await requireRole('picker', 'admin')
  await db.update(orders)
    .set({ status: 'packed', packedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/picker')
}

// ── Dispatcher actions ────────────────────────────────────────────────────────

export async function getPackedOrders() {
  await requireRole('dispatcher', 'admin')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      status: orders.status,
      packedAt: orders.packedAt,
    })
    .from(orders)
    .where(inArray(orders.status, ['packed', 'dispatched']))
    .orderBy(desc(orders.packedAt))
}

export async function markDispatched(orderId: number) {
  const u = await requireRole('dispatcher', 'admin')
  await db.update(orders)
    .set({ status: 'dispatched', dispatcherId: u.id, dispatchedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
}

export async function markDelivered(orderId: number) {
  await requireRole('dispatcher', 'admin')
  await db.update(orders)
    .set({ status: 'delivered', deliveredAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
}

// ── Admin actions ─────────────────────────────────────────────────────────────

export async function getAllOrders() {
  await requireRole('admin')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      status: orders.status,
      orderedAt: orders.orderedAt,
      updatedAt: orders.updatedAt,
      packedAt: orders.packedAt,
      dispatchedAt: orders.dispatchedAt,
      deliveredAt: orders.deliveredAt,
      salesmanId: orders.salesmanId,
      pickerId: orders.pickerId,
      dispatcherId: orders.dispatcherId,
    })
    .from(orders)
    .orderBy(desc(orders.orderedAt))
}

export async function adminUpdateOrderStatus(orderId: number, status: OrderStatus) {
  await requireRole('admin')
  const patch: Record<string, unknown> = { status, updatedAt: sql`now()` }
  if (status === 'packed') patch.packedAt = sql`now()`
  if (status === 'dispatched') patch.dispatchedAt = sql`now()`
  if (status === 'delivered') patch.deliveredAt = sql`now()`
  // Clear picker assignment when manually reverting to pending
  if (status === 'pending') patch.pickerId = null
  await db.update(orders).set(patch).where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/picker')
}

export async function adminAssignPicker(orderId: number, pickerId: string) {
  await requireRole('admin')
  await db.update(orders)
    .set({ pickerId, status: 'assigned', updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
}

export async function adminUnassignPicker(orderId: number) {
  await requireRole('admin')
  await db.update(orders)
    .set({ pickerId: null, status: 'pending', updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
}

/** Returns orderId → pickerId map for all non-null picker assignments. */
export async function getPickerAssignments(): Promise<Record<number, string>> {
  await requireRole('admin')
  const rows = await db
    .select({ id: orders.id, pickerId: orders.pickerId })
    .from(orders)
    .where(sql`${orders.pickerId} is not null`)
  return Object.fromEntries(rows.map(r => [r.id, r.pickerId!]))
}

export async function getOrderStats() {
  await requireRole('admin')
  const [row] = await db.execute<{
    total: string; pending: string; packed: string; dispatched: string; delivered: string; cancelled: string
  }>(sql`
    SELECT
      count(*)::int AS total,
      count(*) filter (where status = 'pending')::int   AS pending,
      count(*) filter (where status = 'packed')::int    AS packed,
      count(*) filter (where status = 'dispatched')::int AS dispatched,
      count(*) filter (where status = 'delivered')::int AS delivered,
      count(*) filter (where status = 'cancelled')::int AS cancelled
    FROM orders
  `).then(r => r.rows)
  return {
    total:      Number(row?.total ?? 0),
    pending:    Number(row?.pending ?? 0),
    packed:     Number(row?.packed ?? 0),
    dispatched: Number(row?.dispatched ?? 0),
    delivered:  Number(row?.delivered ?? 0),
    cancelled:  Number(row?.cancelled ?? 0),
  }
}

// ── Procurement summary ───────────────────────────────────────────────────────

export interface ProcurementRow {
  artNumber: string
  colorNumber: string
  vendorName: string
  totalPairs: number
  orderCount: number
}

/**
 * Returns one row per (artNumber, colorNumber, vendorName / shopkeeperName)
 * for orders whose status matches the given filter (default: pending).
 * Optionally narrow by artNumber or colorNumber prefix.
 */
export async function getProcurementSummary(opts?: {
  status?: string
  artNumber?: string
  colorNumber?: string
}): Promise<ProcurementRow[]> {
  await requireRole('admin', 'salesman')

  const status      = opts?.status      || 'pending'
  const artFilter   = opts?.artNumber?.trim().toUpperCase()   || ''
  const colorFilter = opts?.colorNumber?.trim().toUpperCase() || ''

  const conditions = [eq(orders.status, status as OrderStatus)]
  if (artFilter)   conditions.push(ilike(orderItems.artNumber,   `${artFilter}%`))
  if (colorFilter) conditions.push(ilike(orderItems.colorNumber, `${colorFilter}%`))

  const rows = await db
    .select({
      artNumber:   orderItems.artNumber,
      colorNumber: orderItems.colorNumber,
      vendorName:  orders.shopkeeperName,
      totalPairs:  sql<number>`cast(sum(${orderItems.quantityOrdered}) as int)`,
      orderCount:  sql<number>`cast(count(distinct ${orders.id}) as int)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(...conditions))
    .groupBy(orderItems.artNumber, orderItems.colorNumber, orders.shopkeeperName)
    .orderBy(orderItems.artNumber, orderItems.colorNumber, orders.shopkeeperName)

  return rows.map(r => ({
    artNumber:   r.artNumber,
    colorNumber: r.colorNumber ?? '—',
    vendorName:  r.vendorName,
    totalPairs:  r.totalPairs,
    orderCount:  r.orderCount,
  }))
}
