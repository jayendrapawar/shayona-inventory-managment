'use client'

import { useState, useTransition } from 'react'
import { RolePill, fmt, PageHeader } from '../orders/_components/shared'
import { updateUserRole } from '@/app/actions/users'
import type { AppRole } from '@/app/actions/users'

interface Props {
  users: { id: string; name: string | null; email: string; role: string | null; createdAt: Date }[]
  currentUserId: string
}

const ROLES: AppRole[] = ['admin', 'accountant', 'salesman', 'picker', 'dispatcher', 'user']

const ROLE_SUMMARY: { role: AppRole; description: string; access: string }[] = [
  { role: 'admin',      description: 'Full access to all modules',            access: 'Scanner, Orders, Billing, Purchases, Master, Reports' },
  { role: 'accountant', description: 'Finance & privileged data access',      access: 'Billing, Purchases, Master (read), Reports' },
  { role: 'salesman',   description: 'Create and manage sales orders',        access: 'Scanner, Orders' },
  { role: 'picker',     description: 'Pack warehouse orders',                 access: 'Scanner, Orders' },
  { role: 'dispatcher', description: 'Dispatch packed orders',                access: 'Scanner, Orders' },
  { role: 'user',       description: 'Default — awaiting role assignment',    access: 'Scanner only' },
]

export function MasterDashboard({ users, currentUserId }: Props) {
  const [tab, setTab] = useState<'users' | 'roles'>('users')
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')

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
          <PageHeader title="Master" subtitle="User management & role assignment" />
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

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border mb-4">
          {(['users', 'roles'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch('') }}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t === 'users' ? `Users (${users.length})` : 'Role Reference'}
            </button>
          ))}
        </div>

        {/* Users tab */}
        {tab === 'users' && (
          <>
            <input
              type="search"
              placeholder="Search by name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full mb-4 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="rounded-xl border border-border overflow-hidden">
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
                    {filteredUsers.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No users found</td></tr>
                    )}
                    {filteredUsers.map(u => (
                      <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {u.name ?? '—'}
                          {u.id === currentUserId && (
                            <span className="ml-2 text-[10px] rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 font-semibold">you</span>
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
          </>
        )}

        {/* Role reference tab */}
        {tab === 'roles' && (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Module Access</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Users</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ROLE_SUMMARY.map(({ role, description, access }) => (
                  <tr key={role} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3"><RolePill role={role} /></td>
                    <td className="px-4 py-3 text-muted-foreground">{description}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{access}</td>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {users.filter(u => (u.role ?? 'user') === role).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
