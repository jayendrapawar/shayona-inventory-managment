'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { orders, orderItems, billLines, user } from '@/lib/db/schema'
import type { OrderStatus } from '@/lib/db/schema'
import { eq, desc, inArray, sql, and, ilike, gte, lte } from 'drizzle-orm'
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
  const userRoles = role.split(',').map(r => r.trim())
  if (!roles.some(r => userRoles.includes(r))) throw new Error('Forbidden')
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
  const userRoles = u.role.split(',').map(r => r.trim())
  if (order.salesmanId !== u.id && !userRoles.includes('admin')) throw new Error('Forbidden')
  if (!['pending', 'assigned', 'packed', 'billed'].includes(order.status)) throw new Error('Only pending, assigned, packed, or billed orders can be edited')

  // Reset order to pending so it re-enters the picker queue
  const statusPatch: Record<string, unknown> = {
    shopkeeperName: input.shopkeeperName,
    notes: input.notes ?? null,
    updatedAt: sql`now()`,
  }
  if (['packed', 'billed'].includes(order.status)) {
    // Send back to pending — clear picker/biller assignment so it re-queues
    statusPatch.status = 'pending'
    statusPatch.pickerId = null
    statusPatch.billerId = null
    statusPatch.packedAt = null
    statusPatch.billedAt = null
  }
  // Replace shopkeeper name + notes + reset if needed
  await db.update(orders)
    .set(statusPatch)
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
  await requireRole('salesman', 'admin', 'picker', 'dispatcher', 'accountant')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      shopkeeperAddress: orders.shopkeeperAddress,
      status: orders.status,
      notes: orders.notes,
      orderedAt: orders.orderedAt,
      updatedAt: orders.updatedAt,
      salesmanName: user.name,
    })
    .from(orders)
    .leftJoin(user, eq(orders.salesmanId, user.id))
    .orderBy(desc(orders.orderedAt))
}

/** Admin/accountant: returns ALL orders regardless of salesmanId. */
export async function getAllSalesmanOrders() {
  await requireRole('admin', 'accountant')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      shopkeeperAddress: orders.shopkeeperAddress,
      status: orders.status,
      notes: orders.notes,
      orderedAt: orders.orderedAt,
      updatedAt: orders.updatedAt,
      salesmanName: user.name,
    })
    .from(orders)
    .leftJoin(user, eq(orders.salesmanId, user.id))
    .orderBy(desc(orders.orderedAt))
}

export async function getSalesmanOrderWithItems(orderId: number) {
  await requireRole('salesman', 'admin', 'picker', 'dispatcher', 'accountant')
  const [order] = await db.select().from(orders)
    .where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  return { order, items }
}

export async function cancelOrder(orderId: number) {
  const u = await requireRole('salesman', 'admin', 'accountant')
  const [order] = await db.select({ salesmanId: orders.salesmanId, status: orders.status })
    .from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  const userRoles = u.role.split(',').map(r => r.trim())
  if (order.salesmanId !== u.id && !userRoles.includes('admin') && !userRoles.includes('accountant')) throw new Error('Forbidden')
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
  await requireRole('picker', 'admin', 'accountant')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      status: orders.status,
      orderedAt: orders.orderedAt,
      pickerId: orders.pickerId,
      totalPairs:  sql<number>`cast(coalesce(sum(${orderItems.quantityOrdered}), 0) as int)`,
      packedPairs: sql<number>`cast(coalesce(sum(${orderItems.quantityPacked}),  0) as int)`,
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
  const userRoles = u.role.split(',').map(r => r.trim())
  if (order.pickerId !== u.id && !userRoles.includes('admin')) throw new Error('You can only release orders assigned to you')
  await db.update(orders)
    .set({ pickerId: null, status: 'pending', updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/picker')
  revalidatePath('/orders/admin')
  return { orderId }
}

// ── Bill lines ────────────────────────────────────────────────────────────────

/** Persist MRP lines for a billed order. Replaces any existing lines. */
export async function saveBillLines(
  orderId: number,
  lines: { artNumber: string; mrp: number; qty: number }[],
  lineDiscPct: number,
) {
  await requireRole('biller', 'admin')
  // Delete existing lines then re-insert (idempotent re-save)
  await db.delete(billLines).where(eq(billLines.orderId, orderId))
  if (lines.length > 0) {
    await db.insert(billLines).values(
      lines.map(l => ({
        orderId,
        artNumber:   l.artNumber,
        mrp:         String(l.mrp),
        qty:         l.qty,
        lineDiscPct: String(lineDiscPct),
      }))
    )
  }
}

/** Fetch persisted MRP lines for a billed order. */
export async function getBillLines(orderId: number) {
  await requireRole('biller', 'admin', 'accountant')
  const rows = await db
    .select()
    .from(billLines)
    .where(eq(billLines.orderId, orderId))
  return rows.map(r => ({
    artNumber:   r.artNumber,
    mrp:         parseFloat(r.mrp as string),
    qty:         r.qty,
    lineDiscPct: parseFloat(r.lineDiscPct as string),
  }))
}

export async function getOrderWithItems(orderId: number) {
  await requireRole('picker', 'dispatcher', 'admin', 'salesman', 'accountant', 'biller')
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

// Save all item quantities/statuses in one round-trip, then mark the order packed.
// Called once when the picker taps "Pack Order" — replaces the per-item saves.
export async function bulkSaveAndPackOrder(
  orderId: number,
  items: { id: number; quantityPacked: number; status: 'packed' | 'out_of_stock' | 'pending' }[]
) {
  await requireRole('picker', 'admin')

  // Update all items in parallel
  await Promise.all(
    items.map(item =>
      db.update(orderItems)
        .set({ quantityPacked: item.quantityPacked, status: item.status, updatedAt: sql`now()` })
        .where(eq(orderItems.id, item.id))
    )
  )

  // Mark the order packed
  await db.update(orders)
    .set({ status: 'packed', packedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(orders.id, orderId))

  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/picker')
}

// ── Biller actions ────────────────────────────────────────────────────────────

/** Returns all orders the biller can verify (status = packed) */
export async function getBillerQueue() {
  await requireRole('biller', 'admin', 'accountant')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      shopkeeperPhone: orders.shopkeeperPhone,
      shopkeeperAddress: orders.shopkeeperAddress,
      status: orders.status,
      packedAt: orders.packedAt,
      billedAt: orders.billedAt,
      billerId: orders.billerId,
      salesmanId: orders.salesmanId,
      isEmergency: orders.isEmergency,
    })
    .from(orders)
    .where(inArray(orders.status, ['packed', 'billed']))
    .orderBy(desc(orders.packedAt))
}

/** Biller marks an order as billed — moves it to the dispatcher queue */
export async function markBilled(orderId: number, isEmergency = false) {
  const u = await requireRole('biller', 'admin')
  await db.update(orders)
    .set({
      status: 'billed',
      billerId: u.id,
      billedAt: sql`now()`,
      isEmergency,
      updatedAt: sql`now()`,
    })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/biller')
  revalidatePath('/orders/dispatcher')
}

/**
 * Create a standalone emergency bill from the Billing Scanner.
 * Creates a new order (status=billed, isEmergency=true) + bill_lines in one shot.
 * Returns the new order id + orderNumber so the caller can refresh the Receipts tab.
 */
export async function createEmergencyBill(input: {
  shopkeeperName: string
  shopkeeperPhone: string | null
  shopkeeperAddress: string | null
  lines: { artNumber: string; mrp: number; qty: number }[]
  lineDiscPct: number
}) {
  const u = await requireRole('biller', 'admin')
  const orderNumber = genOrderNumber()
  const [order] = await db.insert(orders).values({
    orderNumber,
    shopkeeperName: input.shopkeeperName,
    shopkeeperPhone: input.shopkeeperPhone,
    shopkeeperAddress: input.shopkeeperAddress,
    billerId: u.id,
    status: 'billed',
    isEmergency: true,
    billedAt: sql`now()`,
  }).returning()

  if (input.lines.length > 0) {
    await db.insert(billLines).values(
      input.lines.map(l => ({
        orderId: order.id,
        artNumber: l.artNumber,
        mrp: String(l.mrp),
        qty: l.qty,
        lineDiscPct: String(input.lineDiscPct),
      }))
    )
  }

  revalidatePath('/orders/biller')
  revalidatePath('/orders/admin')
  return { id: order.id, orderNumber: order.orderNumber }
}

/** Biller sends order back to salesman for editing (resets to pending) */
export async function sendBackToEdit(orderId: number) {
  await requireRole('biller', 'admin')
  await db.update(orders)
    .set({
      status: 'pending',
      pickerId: null,
      billerId: null,
      packedAt: null,
      billedAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/biller')
  revalidatePath('/orders/picker')
}

// ── Dispatcher actions ────────────────────────────────────────────────────────

/** Returns all orders ready for dispatch (status = billed or dispatched) */
export async function getPackedOrders() {
  await requireRole('dispatcher', 'admin', 'accountant')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      status: orders.status,
      packedAt: orders.packedAt,
      totalBundles: orders.totalBundles,
      dispatcherId: orders.dispatcherId,
    })
    .from(orders)
    .where(inArray(orders.status, ['billed', 'dispatched']))
    .orderBy(desc(orders.packedAt))
}

export async function markDispatched(orderId: number, totalBundles: number, deliveryAgentName: string) {
  const u = await requireRole('dispatcher', 'admin')
  await db.update(orders)
    .set({
      status: 'dispatched',
      dispatcherId: u.id,
      dispatchedAt: sql`now()`,
      updatedAt: sql`now()`,
      totalBundles,
      deliveryAgentName,
    })
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

export async function deleteOrder(orderId: number) {
  await requireRole('admin')
  await db.delete(orders).where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
}

/** Biller can delete emergency-tagged orders they generated */
export async function deleteEmergencyBill(orderId: number) {
  await requireRole('biller', 'admin')
  await db.delete(orders).where(and(eq(orders.id, orderId), eq(orders.isEmergency, true)))
  revalidatePath('/orders/biller')
  revalidatePath('/orders/admin')
}



export async function getAllOrders() {
  await requireRole('admin', 'accountant')
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      shopkeeperName: orders.shopkeeperName,
      status: orders.status,
      orderedAt: orders.orderedAt,
      updatedAt: orders.updatedAt,
      packedAt: orders.packedAt,
      billedAt: orders.billedAt,
      dispatchedAt: orders.dispatchedAt,
      deliveredAt: orders.deliveredAt,
      salesmanId: orders.salesmanId,
      pickerId: orders.pickerId,
      billerId: orders.billerId,
      dispatcherId: orders.dispatcherId,
    })
    .from(orders)
    .orderBy(desc(orders.orderedAt))
}

export async function adminUpdateOrderStatus(orderId: number, status: OrderStatus) {
  await requireRole('admin')
  const patch: Record<string, unknown> = { status, updatedAt: sql`now()` }
  if (status === 'packed') patch.packedAt = sql`now()`
  if (status === 'billed') patch.billedAt = sql`now()`
  if (status === 'dispatched') patch.dispatchedAt = sql`now()`
  if (status === 'delivered') patch.deliveredAt = sql`now()`
  // Clear picker/biller assignment when manually reverting to pending
  if (status === 'pending') { patch.pickerId = null; patch.billerId = null }
  await db.update(orders).set(patch).where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/picker')
  revalidatePath('/orders/biller')
}

export async function salesmanAssignPicker(orderId: number, pickerId: string) {
  await requireRole('salesman', 'admin')
  const [order] = await db.select({ status: orders.status })
    .from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  const patch: Record<string, unknown> = { pickerId, updatedAt: sql`now()` }
  if (order.status === 'pending') patch.status = 'assigned'
  await db.update(orders).set(patch).where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/picker')
}

export async function adminAssignPicker(orderId: number, pickerId: string) {
  await requireRole('admin')
  // Fetch current status so we only advance to 'assigned' from 'pending'.
  // If already 'packed', 'dispatched', etc., just update the pickerId without
  // changing status — the order is already progressing through the pipeline.
  const [order] = await db.select({ status: orders.status })
    .from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  const patch: Record<string, unknown> = { pickerId, updatedAt: sql`now()` }
  if (order.status === 'pending') patch.status = 'assigned'
  await db.update(orders).set(patch).where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/picker')
}

export async function adminUnassignPicker(orderId: number) {
  await requireRole('admin')
  // Only revert to pending if still in picker hands (pending/assigned).
  // A packed/dispatched/delivered order keeps its status when unassigning.
  const [order] = await db.select({ status: orders.status })
    .from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new Error('Order not found')
  const patch: Record<string, unknown> = { pickerId: null, updatedAt: sql`now()` }
  if (order.status === 'assigned') patch.status = 'pending'
  await db.update(orders).set(patch).where(eq(orders.id, orderId))
  revalidatePath('/orders')
  revalidatePath('/orders/admin')
  revalidatePath('/orders/picker')
}

/** Returns orderId → pickerId map for all non-null picker assignments. */
export async function getPickerAssignments(): Promise<Record<number, string>> {
  await requireRole('admin', 'accountant')
  const rows = await db
    .select({ id: orders.id, pickerId: orders.pickerId })
    .from(orders)
    .where(sql`${orders.pickerId} is not null`)
  return Object.fromEntries(rows.map(r => [r.id, r.pickerId!]))
}

export async function getOrderStats() {
  await requireRole('admin', 'accountant')
  const [row] = await db.execute<{
    total: string; pending: string; packed: string; dispatched: string; delivered: string; cancelled: string
  }>(sql`
    SELECT
      count(*) filter (where status NOT IN ('delivered', 'cancelled'))::int AS total,
      count(*) filter (where status = 'pending')::int    AS pending,
      count(*) filter (where status = 'packed')::int     AS packed,
      count(*) filter (where status = 'dispatched')::int AS dispatched,
      count(*) filter (where status = 'delivered')::int  AS delivered,
      count(*) filter (where status = 'cancelled')::int  AS cancelled
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
  dateFrom?: string
  dateTo?: string
}): Promise<ProcurementRow[]> {
  await requireRole('admin', 'salesman', 'accountant')

  const status      = opts?.status      || 'pending'
  const artFilter   = opts?.artNumber?.trim().toUpperCase()   || ''
  const colorFilter = opts?.colorNumber?.trim().toUpperCase() || ''

  const conditions = [eq(orders.status, status as OrderStatus)]
  if (artFilter)   conditions.push(ilike(orderItems.artNumber,   `${artFilter}%`))
  if (colorFilter) conditions.push(ilike(orderItems.colorNumber, `${colorFilter}%`))
  if (opts?.dateFrom) conditions.push(gte(orders.orderedAt, new Date(opts.dateFrom)))
  if (opts?.dateTo) {
    const to = new Date(opts.dateTo)
    to.setHours(23, 59, 59, 999)
    conditions.push(lte(orders.orderedAt, to))
  }

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

export interface ShortfallRow {
  artNumber: string
  colorNumber: string
  sizeNumber: string
  vendorName: string
  shortfall: number
}

/**
 * Returns one row per (artNumber, colorNumber, sizeNumber, shopkeeperName)
 * where sum(quantityOrdered - quantityPacked) > 0, for orders in the given
 * statuses (default: packed + dispatched + delivered — i.e. already being
 * fulfilled but with gaps the picker couldn't fill).
 */
export async function getProcurementShortfall(opts?: {
  statuses?: string[]
  artNumber?: string
  colorNumber?: string
}): Promise<ShortfallRow[]> {
  await requireRole('admin', 'salesman')

  const statuses    = opts?.statuses ?? ['packed', 'dispatched', 'delivered']
  const artFilter   = opts?.artNumber?.trim().toUpperCase()   || ''
  const colorFilter = opts?.colorNumber?.trim().toUpperCase() || ''

  const conditions = [inArray(orders.status, statuses as OrderStatus[])]
  if (artFilter)   conditions.push(ilike(orderItems.artNumber,   `${artFilter}%`))
  if (colorFilter) conditions.push(ilike(orderItems.colorNumber, `${colorFilter}%`))

  const rows = await db
    .select({
      artNumber:   orderItems.artNumber,
      colorNumber: orderItems.colorNumber,
      sizeNumber:  orderItems.sizeNumber,
      vendorName:  orders.shopkeeperName,
      shortfall:   sql<number>`cast(sum(${orderItems.quantityOrdered} - ${orderItems.quantityPacked}) as int)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(...conditions))
    .groupBy(orderItems.artNumber, orderItems.colorNumber, orderItems.sizeNumber, orders.shopkeeperName)
    .having(sql`sum(${orderItems.quantityOrdered} - ${orderItems.quantityPacked}) > 0`)
    .orderBy(orderItems.artNumber, orderItems.colorNumber, orderItems.sizeNumber, orders.shopkeeperName)

  return rows.map(r => ({
    artNumber:   r.artNumber,
    colorNumber: r.colorNumber ?? '—',
    sizeNumber:  r.sizeNumber  ?? '—',
    vendorName:  r.vendorName,
    shortfall:   r.shortfall,
  }))
}
