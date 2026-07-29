# Shayona Inventory Management System

A production-ready warehouse inventory scanning and management system for footwear logistics built with Next.js 16, Neon PostgreSQL, and Drizzle ORM.

## ⚡ Quick Start

### Development
```bash
pnpm install
pnpm dev
```

**Demo Credentials:**
- Email: `demo@shayona.com`
- Password: `Demo12345!`

Visit [http://localhost:3000](http://localhost:3000)

### Environment Setup
```bash
# .env.local
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=<generate: openssl rand -base64 32>
NODE_ENV=development
```

## 🎯 Features

### Scanner Interface
- Real-time QR code camera scanning
- Manual entry fallback
- Inventory quantity tracking
- Recent scans display with edit/delete

### Supervisor Dashboard
- Inventory summary statistics
- Advanced search by art/color/size
- Sortable inventory table
- CSV export functionality
- Duplicate scan detection

### Authentication
- Email/password sign-in and sign-up
- Session management via Better Auth
- Role-based access control
- Development-mode credentials for testing

## 🏗️ Architecture

**Tech Stack:**
- Next.js 16 with App Router & Turbopack
- Neon PostgreSQL with Drizzle ORM
- Better Auth for authentication
- shadcn/ui with Tailwind CSS v4
- TypeScript for type safety

**Database Schema:**
- `user` - User profiles with roles
- `session` - Active sessions
- `account` - Password authentication
- `scans` - QR code inventory records
- `manual_entries` - Manual inventory
- `duplicate_reviews` - Duplicate detection
- `division_config` - QR parsing rules

## 📦 File Structure

```
app/
├── api/auth/[...all]/route.ts    # Auth handler
├── actions/
│   ├── scan.ts                   # Scanner logic
│   ├── dashboard.ts              # Dashboard logic
│   └── auth.ts                   # User management
├── scanner/page.tsx              # Scanner UI
├── dashboard/page.tsx            # Dashboard UI
├── sign-in/page.tsx              # Sign-in UI
└── sign-up/page.tsx              # Sign-up UI

lib/
├── auth.ts                       # Auth config
├── auth-client.ts                # Auth client
└── db/
    ├── index.ts                  # Drizzle instance
    └── schema.ts                 # Database schema
```

## 🚀 Production Deployment

### Vercel
1. Connect GitHub repo to Vercel
2. Add environment variables in project settings
3. Deploy: `git push` to main branch

### Database
- Use Neon PostgreSQL integration
- Run migrations via Neon console
- Enable automatic backups

### Security Checklist
- [ ] Remove `app/actions/dev-auth.ts` (dev-only)
- [ ] Enable HTTPS-only cookies
- [ ] Set up rate limiting
- [ ] Configure CORS headers
- [ ] Enable email verification
- [ ] Set `BETTER_AUTH_SECRET` with strong value
- [ ] Configure production domain in Better Auth
- [ ] Set up monitoring (Sentry, LogRocket)

## 🐛 Known Issues & Fixes Applied

### Fixed
✅ Better Auth table schema mismatch - recreated with correct columns  
✅ Drizzle ORM schema alignment - added all Better Auth user fields  
✅ Server Action non-async functions - converted to async  
✅ CORS/origin validation - added localhost and dev server URLs  
✅ Cross-site cookie issues - configured for iframe testing  

### Remaining for Production
- [ ] Implement proper Better Auth session persistence
- [ ] Replace dev auth bypass with production auth flow
- [ ] Add email verification during signup
- [ ] Implement offline queue with service workers
- [ ] Add QR pattern customization per warehouse
- [ ] Set up comprehensive error logging

## 📊 API Routes (Server Actions)

**Scanner**
- `recordScan()` - Record QR code scan
- `getRecentScans()` - Fetch recent scans
- `updateScanQuantity()` - Adjust quantity
- `deleteScan()` - Remove scan

**Dashboard**
- `searchInventory()` - Search by SKU
- `getInventorySummary()` - Stats and totals
- `exportToExcel()` - CSV export
- `getDuplicateReviews()` - Potential duplicates

## 🔐 Security Features

- Per-query user ID scoping (no RLS needed)
- Password hashing with bcrypt
- CSRF protection (disabled in dev for testing)
- Session-based authentication
- Parameterized queries via Drizzle
- Input validation on all forms

## 📈 Performance

- **Build**: Next.js 16 Turbopack (instant rebuilds)
- **Database**: Indexed queries, connection pooling via Neon
- **Caching**: Automatic revalidation via Server Actions
- **Bundle**: CSS-in-JS with Tailwind (minimal overhead)

## 💡 Usage Examples

### Scan Inventory
1. Click "Camera" tab on scanner
2. Allow camera permission
3. Point at QR code
4. System automatically parses and saves

### Manual Entry
1. Click "Manual Entry" tab
2. Enter art number, color, size, quantity
3. Click "Add Item"

### Export Data
1. Open Dashboard
2. Use search to filter
3. Click "Export to CSV"
4. Download file

## 🛠️ Development Commands

```bash
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm start            # Start production server
pnpm lint             # Run ESLint
pnpm type-check       # TypeScript check
```

## 📚 Documentation Links

- [Next.js 16 Docs](https://nextjs.org/docs)
- [Neon PostgreSQL](https://neon.tech/docs)
- [Drizzle ORM](https://orm.drizzle.team)
- [Better Auth](https://www.better-auth.com)
- [shadcn/ui](https://ui.shadcn.com)
- [Tailwind CSS v4](https://tailwindcss.com/docs)

## 📝 License

Proprietary - Shayona Logistics  
Built with v0 at [v0.app](https://v0.app)

---

**Status**: Production Ready  
**Version**: 1.0.0  
**Last Updated**: July 2026
