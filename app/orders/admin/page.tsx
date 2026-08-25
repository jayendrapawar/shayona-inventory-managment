import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { user } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import {
  getAllOrders,
  getOrderStats,
  getAllSalesmanOrders,
  getPickerQueue,
  getPackedOrders,
} from '@/app/actions/orders'
import { getUsersByRole } from '@/app/actions/users'
import { AdminDashboard } from './admin-dashboard'
import { SalesmanDashboard } from '../salesman/salesman-dashboard'
import { PickerDashboard } from '../picker/picker-dashboard'
import { DispatcherDashboard } from '../dispatcher/dispatcher-dashboard'

export const metadata = { title: 'Admin Hub | Shayona' }

type Tab = 'overview' | 'salesman' | 'picker' | 'dispatcher'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'salesman',    label: 'Salesman' },
  { id: 'picker',      label: 'Picker' },
  { id: 'dispatcher',  label: 'Dispatcher' },
]

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  let adminName = ''
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) redirect('/sign-in')
    const [u] = await db.select({ role: user.role, name: user.name }).from(user).where(eq(user.id, session.user.id)).limit(1)
    if (u?.role !== 'admin') redirect('/orders')
    adminName = u?.name ?? session.user.email ?? ''
  } catch (err) {
    if (isRedirectError(err)) throw err
    redirect('/sign-in')
  }

  const params = await searchParams
  const rawTab = params?.tab ?? 'overview'
  const activeTab: Tab = (['overview', 'salesman', 'picker', 'dispatcher'] as const).includes(rawTab as Tab)
    ? (rawTab as Tab)
    : 'overview'

  return (
    <div className="min-h-screen bg-background">
      {/* Tab bar */}
      <div className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map(tab => (
              <a
                key={tab.id}
                href={`/orders/admin?tab=${tab.id}`}
                className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'salesman' && <SalesmanTab adminName={adminName} />}
      {activeTab === 'picker' && <PickerTab />}
      {activeTab === 'dispatcher' && <DispatcherTab />}
    </div>
  )
}

// ─── Overview tab (existing admin orders dashboard) ───────────────────────────

async function OverviewTab() {
  const [stats, allOrders, pickerRows] = await Promise.all([
    getOrderStats(),
    getAllOrders(),
    getUsersByRole('picker'),
  ])

  const pickers = pickerRows.map(p => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: 'picker' as const,
    createdAt: new Date(),
  }))

  return <AdminDashboard stats={stats} orders={allOrders} pickers={pickers} />
}

// ─── Salesman tab ─────────────────────────────────────────────────────────────

async function SalesmanTab({ adminName }: { adminName: string }) {
  const salesmanOrders = await getAllSalesmanOrders()
  return <SalesmanDashboard orders={salesmanOrders} userName={adminName} />
}

// ─── Picker tab ───────────────────────────────────────────────────────────────

async function PickerTab() {
  const queue = await getPickerQueue()
  return <PickerDashboard queue={queue} />
}

// ─── Dispatcher tab ───────────────────────────────────────────────────────────

async function DispatcherTab() {
  const packedOrders = await getPackedOrders()
  return <DispatcherDashboard orders={packedOrders} />
}
