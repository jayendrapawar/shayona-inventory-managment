'use server'

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import type { Vendor } from '@/app/master/vendors-tab'

const VENDORS_PATH = path.join(process.cwd(), 'data/vendors.json')

async function readVendors(): Promise<Vendor[]> {
  try {
    const raw = await readFile(VENDORS_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function writeVendors(vendors: Vendor[]): Promise<void> {
  await writeFile(VENDORS_PATH, JSON.stringify(vendors, null, 2), 'utf-8')
}

export async function saveVendor(vendor: Vendor): Promise<Vendor[]> {
  const vendors = await readVendors()
  const idx = vendors.findIndex(v => v.id === vendor.id)
  if (idx >= 0) {
    vendors[idx] = vendor
  } else {
    vendors.push(vendor)
  }
  await writeVendors(vendors)
  return vendors
}
