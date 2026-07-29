import { pgTable, text, timestamp, boolean, serial, integer, jsonb } from 'drizzle-orm/pg-core'

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

// --- App tables: Inventory Management ---

export const scans = pgTable('scans', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  rawQrCode: text('rawQrCode').notNull(),
  normalizedQrCode: text('normalizedQrCode').notNull(),
  artNumber: text('artNumber'),
  colorNumber: text('colorNumber'),
  sizeNumber: text('sizeNumber'),
  quantity: integer('quantity').notNull().default(1),
  scannedAt: timestamp('scannedAt').notNull().defaultNow(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const manualEntries = pgTable('manual_entries', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  artNumber: text('artNumber').notNull(),
  colorNumber: text('colorNumber').notNull(),
  sizeNumber: text('sizeNumber').notNull(),
  quantity: integer('quantity').notNull().default(1),
  notes: text('notes'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const duplicateReviews = pgTable('duplicate_reviews', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  scan1Id: integer('scan1Id').notNull(),
  scan2Id: integer('scan2Id').notNull(),
  status: text('status').notNull().default('pending'), // pending, approved, rejected
  reviewedBy: text('reviewedBy'),
  reviewedAt: timestamp('reviewedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const divisionConfig = pgTable('division_config', {
  id: serial('id').primaryKey(),
  userId: text('userId').notNull(),
  qrPattern: text('qrPattern').notNull(), // description of pattern
  artNumberStart: integer('artNumberStart'),
  artNumberEnd: integer('artNumberEnd'),
  artNumberLength: integer('artNumberLength'),
  colorNumberStart: integer('colorNumberStart'),
  colorNumberEnd: integer('colorNumberEnd'),
  colorNumberLength: integer('colorNumberLength'),
  sizeNumberStart: integer('sizeNumberStart'),
  sizeNumberEnd: integer('sizeNumberEnd'),
  sizeNumberLength: integer('sizeNumberLength'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})
