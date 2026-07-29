'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user as userTable, account } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { v4 as uuid } from 'uuid'

export async function createUserAccountDirectly(
  email: string,
  password: string,
  name: string
) {
  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user - only set required fields to avoid default value issues
    const userId = uuid()
    const newUser: any[] = []
    try {
      const result = await db
        .insert(userTable)
        .values({
          id: userId,
          email,
          name,
          emailVerified: false,
        })
        .returning({
          id: userTable.id,
          name: userTable.name,
          email: userTable.email,
        })
      newUser.push(...result)
    } catch (err) {
      console.error('[v0] User insert error:', err)
      throw err
    }

    // Create account with password
    await db
      .insert(account)
      .values({
        id: uuid(),
        accountId: uuid(),
        providerId: 'credential',
        userId,
        password: hashedPassword,
      })
      .returning()

    return {
      success: true,
      data: { user: newUser[0] },
    }
  } catch (error) {
    console.error('[v0] Create user error:', error)
    const errorMessage = error instanceof Error ? error.message : 'An error occurred'
    
    // Check if it's a duplicate key error
    if (errorMessage.includes('duplicate') || errorMessage.includes('unique')) {
      return {
        success: false,
        error: 'This email is already registered',
      }
    }
    
    return {
      success: false,
      error: errorMessage,
    }
  }
}
