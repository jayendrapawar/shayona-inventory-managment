import type {
  DivisionBreakdownItem,
  EntryTypeItem,
  OverallStockItem,
  OverallStockStats,
  ScansByUserItem,
  ScansOverTimePoint,
  TopSKUItem,
} from '@/app/actions/dashboard'

export type Tab = 'scanned' | 'overall'
export type SubTab = 'data' | 'stats'

export interface InventoryItem {
  artNumber?: string
  colorNumber?: string
  sizeNumber?: string
  division?: string
  mrp?: number
  mfgMonth?: number
  mfgYear?: number
  scannedByName?: string
  entryType?: string
  quantity: number
  lastScanned: Date
  count: number
}

export interface Statistics {
  totalScans: number
  totalItems: number
  uniqueItems: number
  scansLast24h: number
}

export interface ScannedChartData {
  scansOverTime: ScansOverTimePoint[]
  divisionBreakdown: DivisionBreakdownItem[]
  topSKUs: TopSKUItem[]
  entryTypeBreakdown: EntryTypeItem[]
}

export interface OverallChartData extends ScannedChartData {
  scansByUser: ScansByUserItem[]
}

export type {
  DivisionBreakdownItem,
  EntryTypeItem,
  OverallStockItem,
  OverallStockStats,
  ScansByUserItem,
  ScansOverTimePoint,
  TopSKUItem,
}
