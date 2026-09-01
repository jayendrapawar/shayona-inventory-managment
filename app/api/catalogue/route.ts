import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { loadCatalogue } from '@/app/actions/catalogue'

// GET /api/catalogue
// Returns the full catalogue (vendors + articles) as JSON.
// Used by:
//   1. The SW stale-while-revalidate strategy — response is cached in
//      `shayona-catalogue-v4` with a 30-min TTL.
//   2. The useCatalogueCache client hook — reads from Cache API or fetches here.
//
// Cache-Control: revalidate every 5 min at the CDN/browser level; SW adds
// its own 30-min stale-while-revalidate on top.
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const catalogue = await loadCatalogue()

    return NextResponse.json(catalogue, {
      headers: {
        // Allow browser + CDN to cache for 5 min; SW will serve stale for 30 min
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=1800',
      },
    })
  } catch (err) {
    console.error('[/api/catalogue]', err)
    return NextResponse.json({ error: 'Failed to load catalogue' }, { status: 500 })
  }
}
