'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans, divisionConfig } from '@/lib/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

// Normalize QR code by removing spaces and converting to uppercase
export function normalizeQrCode(qr: string): string {
  return qr.trim().toUpperCase()
}

// Parse QR code based on user's division config or default parsing
export async function parseQrCode(
  qrCode: string,
  userId: string
): Promise<{ artNumber?: string; colorNumber?: string; sizeNumber?: string }> {
  // Get user's division config
  const config = await db
    .select()
    .from(divisionConfig)
    .where(eq(divisionConfig.userId, userId))
    .limit(1)

  // Default parsing: assume format like ART-COLOR-SIZE
  // e.g., "12345-67-40"
  const parts = qrCode.split('-')

  if (parts.length >= 3) {
    return {
      artNumber: parts[0] || undefined,
      colorNumber: parts[1] || undefined,
      sizeNumber: parts[2] || undefined,
    }
  }

  // Fallback: try to parse based on fixed positions if config exists
  if (config[0]) {
    const cfg = config[0]
    const parsed: Record<string, string | undefined> = {}

    if (cfg.artNumberStart && cfg.artNumberEnd) {
      parsed.artNumber = qrCode.substring(cfg.artNumberStart, cfg.artNumberEnd)
    }
    if (cfg.colorNumberStart && cfg.colorNumberEnd) {
      parsed.colorNumber = qrCode.substring(cfg.colorNumberStart, cfg.colorNumberEnd)
    }
    if (cfg.sizeNumberStart && cfg.sizeNumberEnd) {
      parsed.sizeNumber = qrCode.substring(cfg.sizeNumberStart, cfg.sizeNumberEnd)
    }

    return parsed
  }

  // If no clear format, return the whole code as artNumber
  return { artNumber: qrCode }
}

export async function recordScan(rawQrCode: string) {
  const userId = await getUserId()
  const normalizedQr = normalizeQrCode(rawQrCode)
  const parsed = await parseQrCode(normalizedQr, userId)

  const result = await db
    .insert(scans)
    .values({
      userId,
      rawQrCode,
      normalizedQrCode: normalizedQr,
      artNumber: parsed.artNumber,
      colorNumber: parsed.colorNumber,
      sizeNumber: parsed.sizeNumber,
      quantity: 1,
    })
    .returning()

  revalidatePath('/scanner')
  return result[0]
}

export async function getRecentScans(limit = 20) {
  const userId = await getUserId()
  return db
    .select()
    .from(scans)
    .where(eq(scans.userId, userId))
    .orderBy(desc(scans.scannedAt))
    .limit(limit)
}

export async function updateScanQuantity(scanId: number, quantity: number) {
  const userId = await getUserId()
  const result = await db
    .update(scans)
    .set({ quantity })
    .where(and(eq(scans.id, scanId), eq(scans.userId, userId)))
    .returning()

  revalidatePath('/scanner')
  revalidatePath('/dashboard')
  return result[0]
}

export async function deleteScan(scanId: number) {
  const userId = await getUserId()
  await db
    .delete(scans)
    .where(and(eq(scans.id, scanId), eq(scans.userId, userId)))

  revalidatePath('/scanner')
  revalidatePath('/dashboard')
}

export async function getAllScans() {
  const userId = await getUserId()
  return db
    .select()
    .from(scans)
    .where(eq(scans.userId, userId))
    .orderBy(desc(scans.createdAt))
}
