import { pgTable, text, timestamp, boolean, serial, integer, jsonb, numeric, unique, pgEnum, index } from 'drizzle-orm/pg-core'

// --- Better Auth required tables -------------------------------------------
// Column names are camelCase to match Better Auth's defaults. Do not rename.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  role: text('role').default('user'),
  banned: boolean('banned').default(false),
  banReason: text('banReason'),
  banExpires: timestamp('banExpires'),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

// --- Master data tables ---

export const shopkeepers = pgTable('shopkeepers', {
  id:        serial('id').primaryKey(),
  name:      text('name').notNull(),
  code:      text('code'),
  phone:     text('phone'),
  address:   text('address'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  index('shopkeepers_name_idx').on(t.name),
])

export const articles = pgTable('articles', {
  id:        serial('id').primaryKey(),
  artNumber: text('artNumber').notNull().unique(),
  mrp:       numeric('mrp'),
  rate:      numeric('rate'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [
  index('articles_art_number_idx').on(t.artNumber),
])

export const articleColors = pgTable('article_colors', {
  id:          serial('id').primaryKey(),
  articleId:   integer('articleId').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  colorName:   text('colorName').notNull(),
  colorHex:    text('colorHex'),
  createdAt:   timestamp('createdAt').notNull().defaultNow(),
})

export const articleSizes = pgTable('article_sizes', {
  id:          serial('id').primaryKey(),
  articleId:   integer('articleId').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  sizeLabel:   text('sizeLabel').notNull(),
  sortOrder:   integer('sortOrder').notNull().default(0),
  createdAt:   timestamp('createdAt').notNull().defaultNow(),
})

export type Shopkeeper = typeof shopkeepers.$inferSelect
export type Article    = typeof articles.$inferSelect
export type ArticleColor = typeof articleColors.$inferSelect
export type ArticleSize  = typeof articleSizes.$inferSelect

// --- App tables: Inventory Management ---

// entryType: 'scan' = camera/image scan, 'manual' = manually entered
export const scans = pgTable('scans', {
  id: serial('id').primaryKey(),
  entryType: text('entryType').notNull().default('scan'), // 'scan' | 'manual'
  rawQrCode: text('rawQrCode'),  // All rawQrCodes that have been merged into this row (one per physical box scanned)
  boxCodes: jsonb('boxCodes').$type<string[]>().default([]),
  artNumber: text('artNumber'),
  colorNumber: text('colorNumber'),
  sizeNumber: text('sizeNumber'),
  division: text('division'),
  mrp: numeric('mrp'),
  mfgMonth: integer('mfgMonth'),
  mfgYear: integer('mfgYear'),
  scannedByName: text('scannedByName'),
  notes: text('notes'),
  quantity: integer('quantity').notNull().default(1),
  scannedAt: timestamp('scannedAt').notNull().defaultNow(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Scan grouping flags — shared across all users, list displayed in scanner UI
export const flags = pgTable('flags', {
  id:        serial('id').primaryKey(),
  name:      text('name').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (t) => [unique('flags_name_unique').on(t.name)])

// --- Order Management ---

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'assigned',
  'packed',
  'dispatched',
  'delivered',
  'cancelled',
])

export const orderItemStatusEnum = pgEnum('order_item_status', [
  'pending',
  'packed',
  'out_of_stock',
])

export const orders = pgTable('orders', {
  id:                serial('id').primaryKey(),
  orderNumber:       text('orderNumber').notNull().unique(),
  shopkeeperName:    text('shopkeeperName').notNull(),
  shopkeeperPhone:   text('shopkeeperPhone'),
  shopkeeperAddress: text('shopkeeperAddress'),
  salesmanId:        text('salesmanId').references(() => user.id, { onDelete: 'set null' }),
  pickerId:          text('pickerId').references(() => user.id, { onDelete: 'set null' }),
  dispatcherId:      text('dispatcherId').references(() => user.id, { onDelete: 'set null' }),
  status:            orderStatusEnum('status').notNull().default('pending'),
  notes:             text('notes'),
  orderedAt:         timestamp('orderedAt').notNull().defaultNow(),
  packedAt:          timestamp('packedAt'),
  dispatchedAt:      timestamp('dispatchedAt'),
  deliveredAt:       timestamp('deliveredAt'),
  createdAt:         timestamp('createdAt').notNull().defaultNow(),
  updatedAt:         timestamp('updatedAt').notNull().defaultNow(),
})

export const orderItems = pgTable('order_items', {
  id:               serial('id').primaryKey(),
  orderId:          integer('orderId').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  artNumber:        text('artNumber').notNull(),
  colorNumber:      text('colorNumber'),
  sizeNumber:       text('sizeNumber'),
  quantityOrdered:  integer('quantityOrdered').notNull().default(1),
  quantityPacked:   integer('quantityPacked').notNull().default(0),
  status:           orderItemStatusEnum('status').notNull().default('pending'),
  createdAt:        timestamp('createdAt').notNull().defaultNow(),
  updatedAt:        timestamp('updatedAt').notNull().defaultNow(),
})

export type Order = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
export type OrderItem = typeof orderItems.$inferSelect
export type NewOrderItem = typeof orderItems.$inferInsert
export type OrderStatus = typeof orderStatusEnum.enumValues[number]
export type OrderItemStatus = typeof orderItemStatusEnum.enumValues[number]
