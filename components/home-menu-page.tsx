'use client'

import { useRouter } from 'next/navigation'
import { ScanBarcode, ShoppingCart, Receipt, Package } from 'lucide-react'

interface MenuItem {
  label: string
  description: string
  href: string
  icon: React.ElementType
  color: string
  border: string
  badge?: string
}

const MENU_ITEMS: MenuItem[] = [
  {
    label: 'Scanner',
    description: 'Scan warehouse inventory items',
    href: '/scanner',
    icon: ScanBarcode,
    color: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
  },
  {
    label: 'Orders',
    description: 'Manage sales, packing & dispatch',
    href: '/orders',
    icon: ShoppingCart,
    color: 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800',
    badge: 'New',
  },
  {
    label: 'Billing',
    description: 'Invoices and payment records',
    href: '/billing',
    icon: Receipt,
    color: 'bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800',
  },
  {
    label: 'Purchases',
    description: 'Track stock purchases and suppliers',
    href: '/purchases',
    icon: Package,
    color: 'bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800',
  },
]

export function HomeMenuPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Shayona Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">Select a module to get started</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {MENU_ITEMS.map(({ label, description, href, icon: Icon, color, border, badge }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className={`relative flex flex-col items-center gap-3 rounded-2xl border ${border} bg-card p-6 text-center shadow-sm transition-all duration-150 hover:shadow-md active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              {badge && (
                <span className="absolute top-2.5 right-2.5 rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] font-semibold text-white leading-none">
                  {badge}
                </span>
              )}
              <span className={`flex h-14 w-14 items-center justify-center rounded-xl ${color}`}>
                <Icon className="h-7 w-7" />
              </span>
              <span className="font-semibold text-foreground text-sm">{label}</span>
              <span className="text-xs text-muted-foreground leading-snug">{description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
