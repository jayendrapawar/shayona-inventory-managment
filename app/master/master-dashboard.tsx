'use client'

import { useState, useTransition } from 'react'
import { RolePill, fmt, PageHeader } from '../orders/_components/shared'
import { updateUserRole } from '@/app/actions/users'
import type { AppRole } from '@/app/actions/users'
import { VendorsTab } from './vendors-tab'
import type { Vendor } from './vendors-tab'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
interface Props {
  users: { id: string; name: string | null; email: string; role: string | null; createdAt: Date }[]
  currentUserId: string
  vendors: Vendor[]
}

const ROLES: AppRole[] = ['admin', 'accountant', 'salesman', 'picker', 'dispatcher', 'user']

export function MasterDashboard({ users, currentUserId, vendors: initialVendors }: Props) {
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [vendorList, setVendorList] = useState<Vendor[]>(initialVendors)

  const filteredUsers = users.filter(u =>
    !search ||
    (u.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  function handleRoleChange(userId: string, role: string) {
    startTransition(async () => {
      await updateUserRole(userId, role as AppRole)
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <PageHeader title="Master" subtitle="User management & vendors" />
          <a href="/home" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Home</a>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          {ROLES.map(r => {
            const count = users.filter(u => (u.role ?? 'user') === r).length
            return (
              <div key={r} className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{r}</p>
                <p className="text-2xl font-bold mt-1 text-foreground">{count}</p>
              </div>
            )
          })}
        </div>

        {/* Tabs — pill style matching scanner / admin hub */}
        <Tabs defaultValue="users" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="users"   className="text-xs sm:text-sm">Users ({users.length})</TabsTrigger>
            <TabsTrigger value="vendors" className="text-xs sm:text-sm">Vendors ({vendorList.length})</TabsTrigger>
          </TabsList>

          {/* ── Users tab ── */}
          <TabsContent value="users">
            <input
              type="search"
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full mb-4 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />

            {filteredUsers.length === 0 && (
              <p className="text-center py-8 text-sm text-muted-foreground">No users found</p>
            )}

            {/* ── Mobile: card list ── */}
            <div className="sm:hidden space-y-3">
              {filteredUsers.map(u => (
                <div key={u.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm text-foreground">{u.name ?? '—'}</p>
                        {u.id === currentUserId && (
                          <span className="text-[10px] border-l-2 border-blue-400 pl-1.5 pr-1 py-px font-medium text-blue-500 dark:text-blue-400 tracking-wide">YOU</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 break-all">{u.email}</p>
                    </div>
                    <RolePill role={u.role} />
                  </div>
                  <p className="text-xs text-muted-foreground">Joined {fmt(u.createdAt)}</p>
                  <div className="pt-2 border-t border-border">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Assign Role</p>
                    <select
                      disabled={isPending}
                      defaultValue={u.role ?? 'user'}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop: table ── */}
            <div className="hidden sm:block rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Current Role</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Joined</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Assign Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredUsers.map(u => (
                      <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {u.name ?? '—'}
                          {u.id === currentUserId && (
                            <span className="ml-2 text-[10px] border-l-2 border-blue-400 pl-1.5 pr-1 py-px font-medium text-blue-500 dark:text-blue-400 tracking-wide">YOU</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                        <td className="px-4 py-3"><RolePill role={u.role} /></td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{fmt(u.createdAt)}</td>
                        <td className="px-4 py-3">
                          <select
                            disabled={isPending}
                            defaultValue={u.role ?? 'user'}
                            onChange={e => handleRoleChange(u.id, e.target.value)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                          >
                            {ROLES.map(r => (
                              <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ── Vendors tab ── */}
          <TabsContent value="vendors">
            <VendorsTab initialVendors={vendorList} onListChange={setVendorList} />
          </TabsContent>

        </Tabs>
      </div>
    </div>
  )
}
