'use server'

import { db } from '@/lib/db'
import { globalNotes } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export type NoteRow = {
  id: number
  content: string
  authorName: string | null
  pinned: boolean
  createdAt: Date
}

export async function getGlobalNotes(): Promise<NoteRow[]> {
  const rows = await db
    .select({
      id:         globalNotes.id,
      content:    globalNotes.content,
      authorName: globalNotes.authorName,
      pinned:     globalNotes.pinned,
      createdAt:  globalNotes.createdAt,
    })
    .from(globalNotes)
    .orderBy(desc(globalNotes.pinned), desc(globalNotes.createdAt))
    .limit(200)
  return rows
}

export async function addGlobalNote(content: string): Promise<NoteRow> {
  const session = await auth.api.getSession({ headers: await headers() })
  const authorId   = session?.user?.id   ?? null
  const authorName = session?.user?.name ?? session?.user?.email ?? null

  const trimmed = content.trim()
  if (!trimmed) throw new Error('Note cannot be empty')
  if (trimmed.length > 1000) throw new Error('Note too long (max 1000 chars)')

  const [row] = await db
    .insert(globalNotes)
    .values({ content: trimmed, authorId, authorName })
    .returning({
      id:         globalNotes.id,
      content:    globalNotes.content,
      authorName: globalNotes.authorName,
      pinned:     globalNotes.pinned,
      createdAt:  globalNotes.createdAt,
    })
  return row
}

export async function deleteGlobalNote(id: number): Promise<void> {
  await db.delete(globalNotes).where(eq(globalNotes.id, id))
}

export async function togglePinGlobalNote(id: number, pinned: boolean): Promise<void> {
  await db
    .update(globalNotes)
    .set({ pinned, updatedAt: new Date() })
    .where(eq(globalNotes.id, id))
}
