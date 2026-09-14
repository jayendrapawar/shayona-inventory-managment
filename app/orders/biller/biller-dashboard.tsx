'use client'

import { useState, useTransition, useRef, useCallback, useEffect } from 'react'
import jsQR from 'jsqr'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { markBilled, getOrderWithItems } from '@/app/actions/orders'
import { PageNav } from '@/components/page-nav'
import { parseQr, isValidWarehouseQr } from '@/lib/qr-parser'
import { SCAN_INTERVAL_MS } from '@/components/scanner/constants'
import { articlesMatch } from '@/lib/billing-verification'
import { printInvoices, type MrpLine } from '@/lib/bill-html'

type BillerTab = 'verify' | 'generated'

interface BillerOrder {
  id: number
  orderNumber: string
  shopkeeperName: string
  status: string
  packedAt: Date | null
  billedAt: Date | null
  billerId: string | null
  salesmanId: string | null
}

interface Props {
  orders: BillerOrder[]
  currentBillerId?: string
  embedded?: boolean
}

interface DetailItem {
  id: number
  artNumber: string
  colorNumber: string | null
  sizeNumber: string | null
  quantityOrdered: number
  quantityPacked: number
  status: string
}

// Per-item scan tally key: artNumber|sizeNumber
function itemKey(artNumber: string, sizeNumber: string | null) {
  return `${artNumber}|${sizeNumber ?? ''}`
}

export function BillerDashboard({ orders: initialOrders, currentBillerId = '', embedded }: Props) {
  const [orders, setOrders] = useState(initialOrders)
  const [isPending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<number | null>(null)

  // ── Tab state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<BillerTab>('verify')

  // ── Print Bills state ────────────────────────────────────────────────────────
  const [printSelectedIds, setPrintSelectedIds] = useState<Set<number>>(new Set())
  const [printItemsMap, setPrintItemsMap] = useState<Record<number, DetailItem[]>>({})
  const [printLoadingIds, setPrintLoadingIds] = useState<Set<number>>(new Set())
  // mrpLinesMap: orderId → MrpLine[] built from scannedQrs at save time
  const [mrpLinesMap, setMrpLinesMap] = useState<Record<number, MrpLine[]>>({})
  // Per-bill line discount % (configurable in scanner, used at print time)
  const [lineDiscPct, setLineDiscPct] = useState<number | ''>(30)

  // Detail panel state
  const [detailOrder, setDetailOrder] = useState<BillerOrder | null>(null)
  const [detailItems, setDetailItems] = useState<DetailItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  // ── Scanner modal ────────────────────────────────────────────────────────────
  const [scanOrder, setScanOrder] = useState<BillerOrder | null>(null)
  const [scanItems, setScanItems] = useState<DetailItem[]>([])
  // scannedMap: itemKey → scanned count
  const [scannedMap, setScannedMap] = useState<Record<string, number>>({})
  const [scannedQrs, setScannedQrs] = useState<string[]>([])
  const [showDevTracking, setShowDevTracking] = useState(false)
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null)
  const [scanMsg, setScanMsg] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const [lastScannedMsg, setLastScannedMsg] = useState<string | null>(null)
  const scanMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const videoRef            = useRef<HTMLVideoElement>(null)
  const canvasRef           = useRef<HTMLCanvasElement>(null)
  const scanCanvasRef       = useRef<HTMLCanvasElement | null>(null)
  const streamRef           = useRef<MediaStream | null>(null)
  const flashlightStreamRef = useRef<MediaStream | null>(null)
  const lastScanTimeRef     = useRef<number>(0)
  const scanningRef         = useRef(false)
  const scanPausedRef       = useRef(false)
  const fileInputRef        = useRef<HTMLInputElement>(null)

  // Scanner states refs to bypass Next.js/React stale closure issues inside startCamera/scanLoop callbacks
  const scanItemsRef        = useRef<DetailItem[]>([])
  const scannedMapRef       = useRef<Record<string, number>>({})
  const scannedQrsRef       = useRef<string[]>([])
  const showDevTrackingRef  = useRef<boolean>(false)

  // Synchronize refs with the latest state values across render cycles
  useEffect(() => { scanItemsRef.current = scanItems }, [scanItems])
  useEffect(() => { scannedMapRef.current = scannedMap }, [scannedMap])
  useEffect(() => { scannedQrsRef.current = scannedQrs }, [scannedQrs])
  useEffect(() => { showDevTrackingRef.current = showDevTracking }, [showDevTracking])

  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isFlashlightOn, setIsFlashlightOn] = useState(false)
  const [qrDetected, setQrDetected]         = useState(false)
  const [uploadProcessing, setUploadProcessing] = useState(false)

  // cleanup on unmount
  useEffect(() => () => {
    scanningRef.current = false
    if (scanMsgTimer.current) clearTimeout(scanMsgTimer.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    flashlightStreamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  // ── LocalStorage State Restoration on Mount ──
  useEffect(() => {
    try {
      const savedDetailOrder = localStorage.getItem('biller_detailOrder')
      if (savedDetailOrder) {
        const parsed = JSON.parse(savedDetailOrder)
        setDetailOrder(parsed)
        setDetailLoading(true)
        getOrderWithItems(parsed.id).then(({ items }) => {
          setDetailItems(items as DetailItem[])
        }).catch(() => {}).finally(() => setDetailLoading(false))
      }

      const savedScanOrder = localStorage.getItem('biller_scanOrder')
      if (savedScanOrder) {
        const parsed = JSON.parse(savedScanOrder)
        setScanOrder(parsed)

        const savedScanItems = localStorage.getItem('biller_scanItems')
        if (savedScanItems) setScanItems(JSON.parse(savedScanItems))

        const savedScannedMap = localStorage.getItem('biller_scannedMap')
        if (savedScannedMap) setScannedMap(JSON.parse(savedScannedMap))

        const savedScannedQrs = localStorage.getItem('biller_scannedQrs')
        if (savedScannedQrs) setScannedQrs(JSON.parse(savedScannedQrs))

        const savedExpandedArticle = localStorage.getItem('biller_expandedArticle')
        if (savedExpandedArticle) setExpandedArticle(savedExpandedArticle)

        const savedShowDev = localStorage.getItem('biller_showDevTracking')
        if (savedShowDev) setShowDevTracking(savedShowDev === 'true')

        const savedLastScan = localStorage.getItem('biller_lastScannedMsg')
        if (savedLastScan) setLastScannedMsg(savedLastScan)
      }

      // Restore saved MRP lines map (built at save-bill time)
      const savedMrpLines = localStorage.getItem('biller_mrpLinesMap')
      if (savedMrpLines) setMrpLinesMap(JSON.parse(savedMrpLines))

      // Restore discount %
      const savedDisc = localStorage.getItem('biller_lineDiscPct')
      if (savedDisc) setLineDiscPct(parseFloat(savedDisc))
    } catch (e) {
      console.error('Failed to restore biller local storage state', e)
    }
  }, [])

  // ── LocalStorage State Syncing on Change ──
  useEffect(() => {
    if (detailOrder) {
      localStorage.setItem('biller_detailOrder', JSON.stringify(detailOrder))
    } else {
      localStorage.removeItem('biller_detailOrder')
    }
  }, [detailOrder])

  useEffect(() => {
    if (scanOrder) {
      localStorage.setItem('biller_scanOrder', JSON.stringify(scanOrder))
      localStorage.setItem('biller_scanItems', JSON.stringify(scanItems))
      localStorage.setItem('biller_scannedMap', JSON.stringify(scannedMap))
      localStorage.setItem('biller_scannedQrs', JSON.stringify(scannedQrs))
      if (expandedArticle) {
        localStorage.setItem('biller_expandedArticle', expandedArticle)
      } else {
        localStorage.removeItem('biller_expandedArticle')
      }
      localStorage.setItem('biller_showDevTracking', String(showDevTracking))
      if (lastScannedMsg) {
        localStorage.setItem('biller_lastScannedMsg', lastScannedMsg)
      } else {
        localStorage.removeItem('biller_lastScannedMsg')
      }
    } else {
      localStorage.removeItem('biller_scanOrder')
      localStorage.removeItem('biller_scanItems')
      localStorage.removeItem('biller_scannedMap')
      localStorage.removeItem('biller_scannedQrs')
      localStorage.removeItem('biller_expandedArticle')
      localStorage.removeItem('biller_showDevTracking')
      localStorage.removeItem('biller_lastScannedMsg')
    }
  }, [scanOrder, scanItems, scannedMap, scannedQrs, expandedArticle, showDevTracking, lastScannedMsg])

  useEffect(() => {
    localStorage.setItem('biller_mrpLinesMap', JSON.stringify(mrpLinesMap))
  }, [mrpLinesMap])

  useEffect(() => {
    localStorage.setItem('biller_lineDiscPct', String(lineDiscPct === '' ? 30 : lineDiscPct))
  }, [lineDiscPct])

  // ── banner helpers ───────────────────────────────────────────────────────────
  function showMsg(type: 'ok' | 'warn' | 'err', text: string) {
    if (scanMsgTimer.current) clearTimeout(scanMsgTimer.current)
    setScanMsg({ type, text })
    scanMsgTimer.current = setTimeout(() => setScanMsg(null), 3000)
  }

  // ── audio / haptic ───────────────────────────────────────────────────────────
  function triggerFeedback() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'; osc.frequency.setValueAtTime(1046, ctx.currentTime)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15)
      osc.onended = () => ctx.close()
    } catch { /* ignore */ }
    try { if (navigator.vibrate) navigator.vibrate(60) } catch { /* ignore */ }
  }

  // ── handle a decoded QR string ───────────────────────────────────────────────
  function handleQrDecode(raw: string) {
    const devSuffix = showDevTrackingRef.current ? ` (${raw})` : ''
    
    if (!isValidWarehouseQr(raw)) {
      showMsg('warn', 'Unrecognised QR code format' + devSuffix)
      return
    }
    const parsed = parseQr(raw)
    const art    = parsed.articleCode.toUpperCase()
    const size   = String(parsed.size).toUpperCase()

    // TODO: Add color code validation once color codes are stored on order items.
    // Currently colorNumber on DetailItem is not reliably populated, so we only
    // validate article + size. The fix below ensures that when multiple items share
    // the same article + size (e.g. one in-stock and one OOS variant), we always
    // prefer the item that still has scan capacity rather than blindly taking the
    // first match (which could be the OOS variant, causing false "not in order" alerts).

    // Collect all candidates matching article + size
    const candidates = scanItemsRef.current.filter(i => {
      const iArt  = i.artNumber.toUpperCase()
      const iSize = (i.sizeNumber ?? '').toUpperCase()
      return articlesMatch(iArt, art) && iSize === size
    })

    if (candidates.length === 0) {
      showMsg('warn', `${art} Sz ${size} — Not in this order` + devSuffix)
      return
    }

    // Duplicate QR check — same physical box already scanned in this session
    const boxCode = raw.split('-').pop() ?? raw
    const alreadyScanned = scannedQrsRef.current.some(
      q => (q.split('-').pop() ?? q) === boxCode
    )
    if (alreadyScanned) {
      showMsg('warn', `${art} Sz ${size} — Duplicate QR, already scanned` + devSuffix)
      return
    }

    // TODO: Add color code validation once color codes are stored on order items.
    // When colorNumber is reliably populated, narrow candidates by color here so
    // each color slot is verified independently.

    // Without color validation, all same-article+size candidates share the same
    // itemKey (artNumber|sizeNumber), so scannedMap[key] is already a pooled
    // counter for all of them. Compute total packed capacity across the pool so
    // that e.g. FL02 RED sz:7 (packed=1) + FL02 GREY sz:7 (packed=1) allows 2
    // scans total — color is irrelevant until color validation is added.
    const sharedKey  = itemKey(candidates[0].artNumber, candidates[0].sizeNumber)
    const current    = scannedMapRef.current[sharedKey] ?? 0
    const totalCap   = candidates.reduce((sum, i) => sum + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0)

    if (current >= totalCap) {
      showMsg('warn', `${art} Size : ${size} — Already fully scanned (${totalCap} pkd)` + devSuffix)
      return
    }

    const key    = sharedKey
    const packed = totalCap

    const extArt   = parsed.articleCode.toUpperCase()
    const extColor = parsed.colorCode.toUpperCase()
    const extSize  = String(parsed.size).toUpperCase()
    const successText = `${extArt} / ${extColor} / SZ(${extSize}) — ${current + 1}/${packed}`
    setScannedMap(prev => ({ ...prev, [key]: current + 1 }))
    setScannedQrs(prev => [...prev, raw])
    setLastScannedMsg(successText)
    triggerFeedback()
    showMsg('ok', successText + devSuffix)
  }

  // ── camera ───────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      setScanMsg(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (!videoRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      videoRef.current.srcObject = stream
      streamRef.current = stream
      setIsCameraActive(true)
      scanningRef.current = true
      const video = videoRef.current
      const startLoop = () => scanLoop(video)
      if (video.readyState >= 2) startLoop()
      else video.addEventListener('loadeddata', startLoop, { once: true })
    } catch {
      showMsg('err', 'Camera permission denied or unavailable.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopCamera() {
    scanningRef.current = false
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setIsCameraActive(false)
    setQrDetected(false)
  }

  function scanLoop(video: HTMLVideoElement) {
    if (!scanningRef.current) return
    if (video.videoWidth === 0 || video.videoHeight === 0) { requestAnimationFrame(() => scanLoop(video)); return }
    if (scanPausedRef.current) { requestAnimationFrame(() => scanLoop(video)); return }

    const now = performance.now()
    if (now - lastScanTimeRef.current < SCAN_INTERVAL_MS) { requestAnimationFrame(() => scanLoop(video)); return }
    lastScanTimeRef.current = now

    let sc = scanCanvasRef.current
    // Use 1080px max dimension instead of 480px to retain 4x more detail for small/dense QR barcodes
    const scale = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight))
    const sw = Math.round(video.videoWidth * scale)
    const sh = Math.round(video.videoHeight * scale)
    if (!sc || sc.width !== sw || sc.height !== sh) {
      sc = document.createElement('canvas'); sc.width = sw; sc.height = sh
      scanCanvasRef.current = sc
    }
    const sctx = sc.getContext('2d', { willReadFrequently: true })
    if (!sctx) { requestAnimationFrame(() => scanLoop(video)); return }

    sctx.drawImage(video, 0, 0, sw, sh)
    try {
      const imageData = sctx.getImageData(0, 0, sw, sh)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code) {
        scanPausedRef.current = true; setQrDetected(true)
        setTimeout(() => { scanPausedRef.current = false; setQrDetected(false) }, 1800)
        handleQrDecode(code.data)
      }
    } catch { /* ignore */ }
    requestAnimationFrame(() => scanLoop(video))
  }

  async function toggleFlashlight() {
    if (!isFlashlightOn) {
      try {
        let track: MediaStreamTrack | undefined
        if (streamRef.current) { track = streamRef.current.getVideoTracks()[0] }
        else {
          const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
          flashlightStreamRef.current = s; track = s.getVideoTracks()[0]
        }
        if (!track) return
        await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
        setIsFlashlightOn(true)
      } catch {
        flashlightStreamRef.current?.getTracks().forEach(t => t.stop())
        flashlightStreamRef.current = null
        showMsg('warn', 'Flashlight not supported on this device.')
      }
    } else {
      const track = (streamRef.current ?? flashlightStreamRef.current)?.getVideoTracks()[0]
      if (track) track.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {})
      if (flashlightStreamRef.current) { flashlightStreamRef.current.getTracks().forEach(t => t.stop()); flashlightStreamRef.current = null }
      setIsFlashlightOn(false)
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']
    if (!allowed.includes(file.type)) { showMsg('err', 'Invalid image file type.'); if (fileInputRef.current) fileInputRef.current.value = ''; return }
    setUploadProcessing(true)
    try {
      const bitmap = await createImageBitmap(file)
      const cv = document.createElement('canvas'); cv.width = bitmap.width; cv.height = bitmap.height
      const ctx2 = cv.getContext('2d')!; ctx2.drawImage(bitmap, 0, 0); bitmap.close()
      const imageData = ctx2.getImageData(0, 0, cv.width, cv.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (!code) { showMsg('err', 'No QR code found in image.'); return }
      handleQrDecode(code.data)
    } catch { showMsg('err', 'Could not process image.') }
    finally { setUploadProcessing(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  // ── open scanner modal ───────────────────────────────────────────────────────
  async function openScanner(order: BillerOrder) {
    // close detail panel if open
    setDetailOrder(null)
    setScanOrder(order)
    setScannedMap({})
    setScannedQrs([])
    setShowDevTracking(false)
    setExpandedArticle(null)
    setScanMsg(null)
    setLastScannedMsg(null)

    // load items if not already in detailItems for this order
    let items = detailItems
    if (!detailOrder || detailOrder.id !== order.id || detailItems.length === 0) {
      try {
        const data = await getOrderWithItems(order.id)
        items = data.items as DetailItem[]
        setScanItems(items)
      } catch {
        setScanItems([])
      }
    } else {
      setScanItems(items)
    }
  }

  function closeScanner() {
    stopCamera()
    setScanOrder(null)
    setScanItems([])
    setScannedMap({})
    setScannedQrs([])
    setShowDevTracking(false)
    setExpandedArticle(null)
    setScanMsg(null)
    setLastScannedMsg(null)
  }

  // ── save bill ────────────────────────────────────────────────────────────────
  function handleSaveBill() {
    if (!scanOrder) return
    const orderId  = scanOrder.id
    // Build MrpLine[] from scannedQrs before clearing scanner state
    const qrsCopy  = [...scannedQrs]
    const mrpMap   = new Map<string, MrpLine>()
    for (const raw of qrsCopy) {
      if (!isValidWarehouseQr(raw)) continue
      const p   = parseQr(raw)
      const key = `${p.articleCode.toUpperCase()}__${p.mrp}`
      if (mrpMap.has(key)) {
        mrpMap.get(key)!.qty++
      } else {
        mrpMap.set(key, { artNumber: p.articleCode.toUpperCase(), mrp: p.mrp, qty: 1 })
      }
    }
    const builtLines = Array.from(mrpMap.values())
    setMrpLinesMap(prev => ({ ...prev, [orderId]: builtLines }))

    closeScanner()
    setActiveId(orderId)
    startTransition(async () => {
      await markBilled(orderId)
      setOrders(prev =>
        prev.map(o => o.id === orderId ? { ...o, status: 'billed', billerId: currentBillerId, billedAt: new Date() } : o)
      )
      setActiveId(null)
      // After saving, switch to Generated Bills tab
      setActiveTab('generated')
    })
  }

  // ── Print Bills: toggle selection & lazily load items ───────────────────────
  async function handleTogglePrintBill(order: BillerOrder) {
    const id = order.id
    setPrintSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
    if (!printItemsMap[id]) {
      setPrintLoadingIds(prev => new Set(prev).add(id))
      try {
        const { items } = await getOrderWithItems(id)
        setPrintItemsMap(prev => ({ ...prev, [id]: items as DetailItem[] }))
      } finally {
        setPrintLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s })
      }
    }
  }

  // ── Open a print window for selected bills (Shayona invoice format) ──────────
  function handlePrintBills(selectedOrders: BillerOrder[]) {
    const LINE_DISC = lineDiscPct === '' ? 30 : Number(lineDiscPct)
    const bills = selectedOrders.map(o => ({
      vendor: { name: o.shopkeeperName },
      order:  { orderNumber: o.orderNumber, billedAt: o.billedAt },
      lines:  mrpLinesMap[o.id] ?? [],
      lineDiscPct: LINE_DISC,
    }))
    printInvoices(bills)
  }

  // ── Mail selected bills as mailto: link ─────────────────────────────────────
  function handleMailBills(selectedOrders: BillerOrder[]) {
    const subject = encodeURIComponent('Bills — Shayona Shoe Palace')
    const bodyLines: string[] = ['Please find the bill details below:', '']
    selectedOrders.forEach(o => {
      const items = printItemsMap[o.id] ?? []
      const totalPairs = items.reduce((s: number, i: DetailItem) => s + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0)
      const billedStr = o.billedAt ? new Date(o.billedAt).toLocaleDateString('en-IN') : '—'
      bodyLines.push(`Order: ${o.orderNumber}`)
      bodyLines.push(`Party: ${o.shopkeeperName}`)
      bodyLines.push(`Date : ${billedStr}`)
      bodyLines.push(`Pairs: ${totalPairs}`)
      bodyLines.push('---')
    })
    bodyLines.push('', 'Shayona Shoe Palace')
    const body = encodeURIComponent(bodyLines.join('\n'))
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  // ── detail panel ─────────────────────────────────────────────────────────────
  async function handleViewOrder(order: BillerOrder) {
    setDetailOrder(order)
    setDetailItems([])
    setDetailError('')
    setDetailLoading(true)
    try {
      const { items } = await getOrderWithItems(order.id)
      setDetailItems(items as DetailItem[])
    } catch (e: unknown) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load order details.')
    } finally {
      setDetailLoading(false)
    }
  }

  // ── scan validation ──────────────────────────────────────────────────────────
  // An order is fully verified when every packed item has been scanned ≥ quantityPacked
  const allVerified = scanItems.length > 0 && scanItems.every(item => {
    if (item.status === 'out_of_stock') return true
    const packed = item.quantityPacked
    if (packed === 0) return true
    const key     = itemKey(item.artNumber, item.sizeNumber)
    return (scannedMap[key] ?? 0) >= packed
  })

  // ── build article groups for detail panel ────────────────────────────────────
  const articleGroups = (() => {
    const artMap = new Map<string, Map<string, DetailItem[]>>()
    for (const item of detailItems) {
      if (!artMap.has(item.artNumber)) artMap.set(item.artNumber, new Map())
      const colorKey = item.colorNumber ?? '—'
      if (!artMap.get(item.artNumber)!.has(colorKey)) artMap.get(item.artNumber)!.set(colorKey, [])
      artMap.get(item.artNumber)!.get(colorKey)!.push(item)
    }
    return Array.from(artMap.entries()).map(([artNumber, colorMap]) => ({
      artNumber,
      colorGroups: Array.from(colorMap.entries()).map(([color, items]) => ({ color, items })),
    }))
  })()

  // ── scan item grouping ───────────────────────────────────────────────────────
  const scanArticleGroups = (() => {
    const artMap = new Map<string, Map<string, DetailItem[]>>()
    for (const item of scanItems) {
      if (!artMap.has(item.artNumber)) artMap.set(item.artNumber, new Map())
      const colorKey = item.colorNumber ?? '—'
      if (!artMap.get(item.artNumber)!.has(colorKey)) artMap.get(item.artNumber)!.set(colorKey, [])
      artMap.get(item.artNumber)!.get(colorKey)!.push(item)
    }
    return Array.from(artMap.entries()).map(([artNumber, colorMap]) => ({
      artNumber,
      colorGroups: Array.from(colorMap.entries()).map(([color, items]) => ({ color, items })),
    }))
  })()

  // ── Derived lists ────────────────────────────────────────────────────────────
  const verifyOrders = orders.filter(o => o.status === 'packed')
  const billedOrders = orders.filter(o => o.status === 'billed')

  const counts = {
    total:   orders.length,
    packed:  verifyOrders.length,
    billed:  billedOrders.length,
    myBills: billedOrders.filter(o => o.billerId === currentBillerId).length,
  }

  return (
    <div className={embedded ? '' : 'min-h-screen bg-background'}>
      <div className={embedded ? '' : 'max-w-2xl mx-auto px-4 py-6'}>
        {!embedded && (
          <div className="flex items-center justify-between mb-6">
            <PageHeader title="Biller Dashboard" subtitle="Verify packed orders and generate bills" />
            <PageNav />
          </div>
        )}

        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard label="Total"     value={counts.total} />
          <StatCard label="To Verify" value={counts.packed}  color="text-purple-600" />
          <StatCard label="Billed"    value={counts.billed}  color="text-blue-600" />
          <StatCard label="My Bills"  value={counts.myBills} color="text-blue-600" />
        </div>

        {/* ── Tabs ── */}
        <div className="flex rounded-xl border border-border bg-muted/40 p-1 mb-4 gap-1">
          {(['verify', 'generated'] as BillerTab[]).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => { setActiveTab(tab); setPrintSelectedIds(new Set()) }}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'verify' ? 'Invoices' : 'Receipts'}
              <span className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ${
                activeTab === tab ? 'bg-foreground text-background' : 'bg-muted-foreground/20 text-muted-foreground'
              }`}>
                {tab === 'verify' ? counts.packed : counts.billed}
              </span>
            </button>
          ))}
        </div>

        {/* ── Verify Orders tab ── */}
        {activeTab === 'verify' && (
          <div className="space-y-3">
            {verifyOrders.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">No orders to verify 🎉</div>
            )}
            {verifyOrders.map(order => {
              const isProcessing = isPending && activeId === order.id
              return (
                <div
                  key={order.id}
                  onClick={() => handleViewOrder(order)}
                  className="w-full text-left rounded-xl border border-border bg-card p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="font-medium text-sm">{order.shopkeeperName}</p>
                      <p className="font-mono text-xs text-muted-foreground mt-0.5">{order.orderNumber}</p>
                    </div>
                    <StatusPill status={order.status} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Packed: {fmt(order.packedAt)}</p>
                    </div>
                    <div onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openScanner(order)}
                        disabled={isProcessing}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {isProcessing ? '…' : 'Scan Items'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Print Bills tab ── */}
        {activeTab === 'generated' && (() => {
          const allSelected = billedOrders.length > 0 && billedOrders.every(o => printSelectedIds.has(o.id))
          const selectedOrders = billedOrders.filter(o => printSelectedIds.has(o.id))
          const allLoaded = selectedOrders.every(o => !!printItemsMap[o.id])

          function toggleAll() {
            if (allSelected) {
              setPrintSelectedIds(new Set())
              setPrintItemsMap({})
            } else {
              billedOrders.forEach(o => { if (!printSelectedIds.has(o.id)) handleTogglePrintBill(o) })
            }
          }

          return (
            <div className="space-y-3">

              {/* ── Empty state ── */}
              {billedOrders.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                  <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  <div className="text-center">
                    <p className="text-sm font-medium">No bills generated yet</p>
                    <p className="text-xs mt-0.5 text-muted-foreground">Bills appear here after scanning and saving orders.</p>
                  </div>
                </div>
              )}

              {/* ── Selection card ── */}
              {billedOrders.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">

                  {/* Card header */}
                  <div className="px-3 py-3 sm:px-4 sm:py-3.5 bg-muted/30 border-b border-border">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        <h2 className="text-sm font-semibold text-foreground">Select Bills to Print</h2>
                        {printSelectedIds.size > 0 && (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                            {printSelectedIds.size}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={toggleAll}
                        className="text-xs font-medium text-primary hover:underline shrink-0"
                      >
                        {allSelected ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                  </div>

                  {/* Rows */}
                  <div className="divide-y divide-border">
                    {billedOrders.map(order => {
                      const checked = printSelectedIds.has(order.id)
                      const loading = printLoadingIds.has(order.id)
                      const pairs = printItemsMap[order.id]?.reduce((s, i) => s + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0) ?? null

                      return (
                        <div
                          key={order.id}
                          onClick={() => handleViewOrder(order)}
                          className={`flex items-center gap-3 px-3 py-3 sm:px-4 cursor-pointer transition-colors ${
                            checked ? 'bg-primary/5' : 'hover:bg-muted/30 active:bg-muted/50'
                          }`}
                        >
                          {/* Checkbox — click is independent from row, does NOT open preview */}
                          <button
                            type="button"
                            aria-label={checked ? 'Deselect for print' : 'Select for print'}
                            onClick={e => { e.stopPropagation(); handleTogglePrintBill(order) }}
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              checked ? 'border-primary bg-primary' : 'border-border bg-background hover:border-primary/60'
                            }`}
                          >
                            {checked && (
                              <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>

                          {/* Text — clicking opens detail preview */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate leading-snug">{order.shopkeeperName}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="font-mono text-[11px] text-muted-foreground">{order.orderNumber}</span>
                              <span className="text-[11px] text-muted-foreground">·</span>
                              <span className="text-[11px] text-muted-foreground">{fmt(order.billedAt)}</span>
                            </div>
                          </div>

                          {/* Right side */}
                          <div className="flex items-center gap-2 shrink-0">
                            {loading && (
                              <svg className="w-3.5 h-3.5 text-muted-foreground animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                              </svg>
                            )}
                            {checked && !loading && pairs !== null && (
                              <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                                {pairs} pairs
                              </span>
                            )}
                            {!checked && <StatusPill status={order.status} />}
                            {/* Chevron hint */}
                            <svg className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Summary strip — shown when at least one selected */}
                  {selectedOrders.length > 0 && (
                    <div className="border-t border-border px-3 py-2.5 sm:px-4 bg-muted/20 flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <span><span className="font-semibold text-foreground">{selectedOrders.length}</span> bill{selectedOrders.length !== 1 ? 's' : ''} selected</span>
                      </div>
                      {!allLoaded && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          Loading items…
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* ── Order detail panel ── */}
      {detailOrder && (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-end sm:flex-row sm:justify-end bg-black/40 backdrop-blur-sm"
          onClick={() => setDetailOrder(null)}
        >
          <div
            className="relative w-full sm:max-w-md bg-background sm:border-l border-t sm:border-t-0 border-border sm:h-full max-h-[85vh] sm:max-h-none overflow-y-auto shadow-2xl rounded-t-2xl sm:rounded-none"
            onClick={e => e.stopPropagation()}
          >
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-background border-b border-border">
              <div>
                <p className="font-semibold text-sm text-foreground">{detailOrder.shopkeeperName}</p>
                <p className="font-mono text-xs text-muted-foreground mt-0.5">{detailOrder.orderNumber}</p>
              </div>
              <button type="button" onClick={() => setDetailOrder(null)}
                className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted transition-colors">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <StatusPill status={detailOrder.status} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <span className="text-muted-foreground">Packed</span>
                  <span className="text-foreground">{fmt(detailOrder.packedAt)}</span>
                  {detailOrder.billedAt && (
                    <>
                      <span className="text-muted-foreground">Billed</span>
                      <span className="text-blue-600 dark:text-blue-400 font-medium">{fmt(detailOrder.billedAt)}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 bg-muted/30 border-b border-border">
                  <p className="text-sm font-semibold text-foreground">Order Items</p>
                </div>
                {detailLoading && <p className="px-4 py-6 text-sm text-muted-foreground text-center">Loading items…</p>}
                {detailError  && <p className="px-4 py-4 text-sm text-red-600">{detailError}</p>}
                {!detailLoading && !detailError && detailItems.length === 0 && (
                  <p className="px-4 py-6 text-sm text-muted-foreground text-center">No items found.</p>
                )}
                {!detailLoading && detailItems.length > 0 && (
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-muted/20 border-b border-border">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground w-24">Article</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground w-28">Color</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">
                          Size
                          <span className="ml-1 text-[10px] font-normal text-muted-foreground/50">→</span>
                          <span className="text-[10px] font-semibold text-muted-foreground/70">ord</span>
                          <span className="mx-0.5 text-[10px] text-muted-foreground/40">→</span>
                          <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">pkd</span>
                          {detailOrder?.status === 'billed' && (
                            <>
                              <span className="mx-0.5 text-[10px] text-muted-foreground/40">→</span>
                              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">ver</span>
                            </>
                          )}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {articleGroups.map(({ artNumber, colorGroups }) =>
                        colorGroups.map(({ color, items }, ci) => {
                          const allItems = colorGroups.flatMap(cg => cg.items)
                          const allOrd   = allItems.reduce((s, i) => s + i.quantityOrdered, 0)
                          const allPkd   = allItems.reduce((s, i) => s + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0)
                          const isBilled = detailOrder?.status === 'billed'
                          const allVer   = isBilled ? allPkd : 0
                          return (
                            <tr key={`${artNumber}-${color}`} className="border-b border-border hover:bg-muted/20">
                              {ci === 0 && (
                                <td className="px-4 py-2.5 font-semibold text-xs align-top border-r border-border" rowSpan={colorGroups.length}>
                                  {artNumber}
                                  {/* ord = salesman → muted */}
                                  <span className="block font-normal text-muted-foreground tabular-nums mt-0.5">{allOrd} ord</span>
                                  {/* pkd = picker → always green */}
                                  <span className="block font-semibold tabular-nums text-green-600 dark:text-green-400">{allPkd} pkd</span>
                                  {/* ver = biller → always blue, only when billed */}
                                  {isBilled && <span className="block font-semibold tabular-nums text-blue-600 dark:text-blue-400">{allVer} ver</span>}
                                </td>
                              )}
                              <td className="px-3 py-2.5 text-xs font-medium text-foreground align-top w-28 border-r border-border">{color}</td>
                              <td className="px-3 py-2.5 align-top">
                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                  {items.map(item => {
                                    const isOOS    = item.status === 'out_of_stock'
                                    const pkd      = isOOS ? 0 : item.quantityPacked
                                    const verified = isBilled ? pkd : 0
                                    return (
                                      <span key={item.id} className="inline-flex items-baseline gap-0.5 tabular-nums whitespace-nowrap">
                                        <span className="text-xs text-muted-foreground">{item.sizeNumber ?? '—'}</span>
                                        <span className="text-[10px] text-muted-foreground/50 mx-px">/</span>
                                        {/* ord = salesman → always muted */}
                                        <span className="text-xs font-bold text-muted-foreground">{item.quantityOrdered}</span>
                                        <span className="text-[10px] text-muted-foreground/40">→</span>
                                        {/* pkd = picker → always green (red if OOS) */}
                                        <span className={`text-xs font-bold ${isOOS ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                                          {isOOS ? 'OOS' : pkd}
                                        </span>
                                        {/* verified = biller → always blue, only when billed */}
                                        {isBilled && !isOOS && (
                                          <>
                                            <span className="text-[10px] text-muted-foreground/40">→</span>
                                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{verified}</span>
                                          </>
                                        )}
                                      </span>
                                    )
                                  })}
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                    <tfoot className="border-t-2 border-border bg-muted/20">
                      <tr>
                        <td colSpan={2} className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Total</td>
                        <td className="px-3 py-2.5 text-xs">
                          {(() => {
                            const isBilled = detailOrder?.status === 'billed'
                            const totalOrd = detailItems.reduce((s, i) => s + i.quantityOrdered, 0)
                            const totalPkd = detailItems.reduce((s, i) => s + (i.status === 'out_of_stock' ? 0 : i.quantityPacked), 0)
                            const totalVer = isBilled ? totalPkd : 0
                            return (
                              <>
                                {/* ord = salesman → muted */}
                                <span className="font-bold tabular-nums text-muted-foreground">{totalOrd}</span>
                                <span className="text-muted-foreground mx-1">ord /</span>
                                {/* pkd = picker → green */}
                                <span className="font-bold tabular-nums text-green-600 dark:text-green-400">{totalPkd}</span>
                                <span className="text-muted-foreground mx-1">pkd</span>
                                {/* ver = biller → blue, only when billed */}
                                {isBilled && (
                                  <>
                                    <span className="text-muted-foreground mx-0.5">/</span>
                                    <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">{totalVer}</span>
                                    <span className="text-muted-foreground ml-1">ver</span>
                                  </>
                                )}
                              </>
                            )
                          })()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {/* ── Bill Details ── shown when billed */}
              {detailOrder.status === 'billed' && (() => {
                const lines = mrpLinesMap[detailOrder.id] ?? []

                if (lines.length === 0) return (
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-3 bg-muted/30 border-b border-border">
                      <p className="text-sm font-semibold text-foreground">Bill Items</p>
                    </div>
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                      Bill data not available — only bills scanned in this session are shown here.
                    </div>
                  </div>
                )

                const LINE_DISC_PCT = typeof lineDiscPct === 'number' ? lineDiscPct : 30
                const DISC_PCT = 4.75
                const CGST_PCT = 2.50
                const SGST_PCT = 2.50

                const totalQty  = lines.reduce((s, l) => s + l.qty, 0)
                const subTotal  = lines.reduce((s, l) => s + Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100)) * l.qty, 0)
                const discAmt   = Math.round(subTotal * DISC_PCT / 100 * 100) / 100
                const afterDisc = subTotal - discAmt
                const cgstAmt   = Math.round(afterDisc * CGST_PCT / 100 * 100) / 100
                const sgstAmt   = Math.round(afterDisc * SGST_PCT / 100 * 100) / 100
                const netAmt    = Math.round((afterDisc + cgstAmt + sgstAmt) * 100) / 100
                const fmtRs     = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

                // group by artNumber for display
                const artGroupMap = new Map<string, typeof lines>()
                for (const l of lines) {
                  if (!artGroupMap.has(l.artNumber)) artGroupMap.set(l.artNumber, [])
                  artGroupMap.get(l.artNumber)!.push(l)
                }

                return (
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">Bill Items</p>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {lines.length} line{lines.length !== 1 ? 's' : ''} · {totalQty} box{totalQty !== 1 ? 'es' : ''} · {fmtRs(subTotal)}
                      </span>
                    </div>

                    {/* Discount % badge */}
                    <div className="px-4 py-2 border-b border-border bg-muted/10 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Disc %</span>
                      <span className="text-xs font-bold text-foreground tabular-nums">{LINE_DISC_PCT}</span>
                    </div>

                    {/* Line items table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead className="bg-muted/20 border-b border-border">
                          <tr>
                            <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Article</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">MRP</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Disc {LINE_DISC_PCT}%</th>
                            <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Qty</th>
                            <th className="text-right px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Amt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {Array.from(artGroupMap.entries()).map(([artNumber, artLines]) =>
                            artLines.map((l, li) => {
                              const rate = Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100))
                              const amt  = rate * l.qty
                              return (
                                <tr key={`${artNumber}-${li}`} className="odd:bg-card even:bg-muted/10">
                                  <td className="px-4 py-2 font-semibold text-foreground">{li === 0 ? artNumber : ''}</td>
                                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{fmtRs(l.mrp)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{fmtRs(rate)}</td>
                                  <td className="px-3 py-2 text-center font-bold tabular-nums">{l.qty}</td>
                                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmtRs(amt)}</td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Totals */}
                    <div className="border-t border-border divide-y divide-border/60">
                      {[
                        { label: `Sub Total (${totalQty} boxes)`, value: fmtRs(subTotal), cls: 'font-semibold text-foreground' },
                        { label: `Discount (${DISC_PCT}%)`,       value: `− ${fmtRs(discAmt)}`, cls: 'text-red-600 dark:text-red-400' },
                        { label: `CGST (${CGST_PCT}%)`,           value: `+ ${fmtRs(cgstAmt)}`, cls: 'text-muted-foreground' },
                        { label: `SGST (${SGST_PCT}%)`,           value: `+ ${fmtRs(sgstAmt)}`, cls: 'text-muted-foreground' },
                      ].map(row => (
                        <div key={row.label} className="flex items-center justify-between px-4 py-2 text-xs">
                          <span className="text-muted-foreground">{row.label}</span>
                          <span className={`tabular-nums ${row.cls}`}>{row.value}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
                        <span className="text-sm font-bold text-foreground">Net Payable</span>
                        <span className="text-sm font-extrabold tabular-nums text-foreground">{fmtRs(netAmt)}</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {detailOrder.status === 'packed' && (
                <button
                  type="button"
                  disabled={isPending && activeId === detailOrder.id}
                  onClick={() => openScanner(detailOrder)}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Scan Items
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Scan & verify modal ── */}
      {scanOrder && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">

          {/* ── Top header ── */}
          <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-background">
            <button
              type="button"
              onClick={closeScanner}
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-foreground truncate">{scanOrder.shopkeeperName}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{scanOrder.orderNumber}</p>
            </div>
            {/* Progress pill */}
            <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
              allVerified
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-muted text-muted-foreground'
            }`}>
              {Object.values(scannedMap).reduce((a, b) => a + b, 0)}&nbsp;/&nbsp;{scanItems.filter(i => i.status !== 'out_of_stock').reduce((s, i) => s + i.quantityPacked, 0)}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* ── Camera section ── */}
            <div className="px-4 pt-4">
              <div className="relative bg-black w-full rounded-2xl overflow-hidden" style={{ aspectRatio: '4/3', maxHeight: '44vh' }}>
                <video
                  ref={videoRef}
                  autoPlay playsInline muted
                  className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* QR lock-on highlight */}
                {qrDetected && (
                  <div className="absolute inset-0 rounded-2xl ring-4 ring-green-400 pointer-events-none" />
                )}

                {/* Scanning reticle — shown when camera active */}
                {isCameraActive && !qrDetected && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-44 h-44 relative">
                      {/* corner marks */}
                      <span className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white/70 rounded-tl" />
                      <span className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white/70 rounded-tr" />
                      <span className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white/70 rounded-bl" />
                      <span className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white/70 rounded-br" />
                    </div>
                  </div>
                )}

                {/* Idle state — camera not started */}
                {!isCameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <svg className="w-10 h-10 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-blue-700 active:scale-95 transition-all"
                    >
                      Start Camera
                    </button>
                  </div>
                )}

                {/* Overlay controls — shown when camera active */}
                {isCameraActive && (
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="rounded-lg border border-white/25 bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
                    >
                      Stop
                    </button>
                    <button
                      type="button"
                      onClick={toggleFlashlight}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors ${
                        isFlashlightOn
                          ? 'border-yellow-400/80 bg-yellow-400/20 text-yellow-300'
                          : 'border-white/25 bg-black/55 text-white hover:bg-black/70'
                      }`}
                    >
                      {isFlashlightOn ? '⚡ Flash On' : '⚡ Flash'}
                    </button>
                  </div>
                )}
              </div>

              {/* Controls row below camera */}
              <div className="flex items-center justify-between mt-3 mb-1">
                <p className="text-[11px] text-muted-foreground">
                  {isCameraActive
                    ? 'Point at a warehouse box QR code'
                    : 'Tap Start Camera or upload an image'}
                </p>
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer">
                  {uploadProcessing
                    ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                    : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  }
                  Upload Image
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              </div>
            </div>

            {/* ── Scan result banner ── */}
            {scanMsg && (
              <div className={`mx-4 mt-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs font-medium ${
                scanMsg.type === 'ok'
                  ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                  : scanMsg.type === 'warn'
                  ? 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800'
                  : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
              }`}>
                <span className="mt-px shrink-0">
                  {scanMsg.type === 'ok' ? '✓' : scanMsg.type === 'warn' ? '⚠' : '✕'}
                </span>
                <span>{scanMsg.text}</span>
              </div>
            )}

            {/* ── Persistent Last Scanned display ── */}
            {lastScannedMsg && (
              <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl bg-card border border-border px-3.5 py-3 text-xs select-none shadow-sm">
                <div className="shrink-0 flex items-center">
                  <span className="bg-emerald-500 text-white font-bold px-2.5 py-1 rounded-md text-[10px] tracking-wide uppercase shadow-sm shadow-emerald-500/10">
                    Last Scanned
                  </span>
                </div>
                <span className="font-bold text-foreground font-mono text-right text-xs sm:text-sm pl-2">{lastScannedMsg}</span>
              </div>
            )}

            {/* ── Item verification checklist ── */}
            <div className="px-4 pt-4 pb-28 space-y-3">
              <div className="flex items-center justify-between mb-3 select-none">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
                  Order items
                </p>
                <button
                  type="button"
                  onClick={() => setShowDevTracking(!showDevTracking)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold transition-all border ${
                    showDevTracking
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full transition-colors ${showDevTracking ? 'bg-blue-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
                  Developer Mode
                </button>
              </div>

              {scanArticleGroups.map(({ artNumber, colorGroups }) => {
                const allItems   = colorGroups.flatMap(cg => cg.items)
                const artDone    = allItems.every(i => {
                  if (i.status === 'out_of_stock') return true
                  return (scannedMap[itemKey(i.artNumber, i.sizeNumber)] ?? 0) >= i.quantityPacked
                })
                const isExpanded = expandedArticle === artNumber

                const totalPackedPairs = allItems.reduce((sum, item) => sum + (item.status === 'out_of_stock' ? 0 : item.quantityPacked), 0)
                const totalVerifiedPairs = allItems.reduce((sum, item) => {
                  if (item.status === 'out_of_stock') return sum
                  const key = itemKey(item.artNumber, item.sizeNumber)
                  const totalScans = scannedMap[key] ?? 0
                  const siblingItems = scanItems.filter(i => itemKey(i.artNumber, i.sizeNumber) === key)
                  const currentItemIndex = siblingItems.findIndex(i => i.id === item.id)

                  let assignedScannedCount = 0
                  let scansLeft = totalScans

                  for (let idx = 0; idx < siblingItems.length; idx++) {
                    const sibling = siblingItems[idx]
                    const sibPacked = sibling.status === 'out_of_stock' ? 0 : sibling.quantityPacked
                    
                    if (idx === currentItemIndex) {
                      if (idx === siblingItems.length - 1) {
                        assignedScannedCount = scansLeft
                      } else {
                        assignedScannedCount = Math.min(scansLeft, sibPacked)
                      }
                      break
                    } else {
                      scansLeft -= Math.min(scansLeft, sibPacked)
                    }
                  }
                  return sum + Math.min(assignedScannedCount, item.quantityPacked)
                }, 0)

                return (
                  <div key={artNumber} className={`rounded-xl border transition-all duration-200 overflow-hidden ${
                    artDone
                      ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/5 dark:bg-emerald-950/5'
                      : isExpanded
                      ? 'border-blue-300 dark:border-blue-700 shadow-md shadow-blue-500/5'
                      : 'border-border bg-card'
                  }`}>
                    {/* Article header */}
                    <div
                      onClick={() => setExpandedArticle(isExpanded ? null : artNumber)}
                      className={`px-4 py-3.5 border-b cursor-pointer transition-colors select-none ${
                        artDone
                          ? 'border-emerald-100/60 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-950/10 hover:bg-emerald-50/40'
                          : isExpanded
                          ? 'border-blue-100 dark:border-blue-900/40 bg-blue-50/10 dark:bg-blue-950/5 hover:bg-blue-50/20'
                          : 'border-border bg-muted/20 hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        {/* Article Code */}
                        <div className="flex items-center gap-2 min-w-0">
                          <svg
                            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                          </svg>
                          <span className="text-xs font-bold font-mono text-foreground truncate">{artNumber}</span>
                        </div>

                        {/* Verified Pairs / Total Packed Pairs */}
                        <div className="flex items-center gap-1.5 font-mono text-xs shrink-0">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold tracking-tight leading-none ${
                            artDone
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : totalVerifiedPairs > 0
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {totalVerifiedPairs}&thinsp;/&thinsp;{totalPackedPairs}
                          </span>
                          {artDone && (
                            <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Table of items inside article */}
                    {isExpanded ? (
                      <div className="overflow-x-auto bg-card border-t border-border/50 scrollbar-none touch-pan-x">
                        <table className="w-full text-xs text-left border-collapse table-auto">
                          <thead className="bg-muted/10 border-b border-border text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            <tr>
                              <th className="px-3.5 py-2.5 min-w-[80px] whitespace-nowrap text-muted-foreground">Color</th>
                              <th className="px-2 py-2.5 text-center min-w-[48px] w-12 whitespace-nowrap text-muted-foreground">Size</th>
                              <th className="px-2 py-2.5 text-center min-w-[56px] w-14 whitespace-nowrap text-muted-foreground">ORD</th>
                              <th className="px-2 py-2.5 text-center min-w-[56px] w-14 text-green-600 dark:text-green-400 font-bold whitespace-nowrap">PKD</th>
                              <th className="px-2 py-2.5 text-center min-w-[64px] w-16 text-blue-600 dark:text-blue-400 font-bold whitespace-nowrap">Verified</th>
                              <th className="px-3.5 py-2.5 text-right min-w-[80px] w-24 whitespace-nowrap text-muted-foreground">Price</th>
                              {showDevTracking && (
                                <th className="px-3.5 py-2.5 text-left min-w-[280px] whitespace-nowrap text-muted-foreground">rawCode</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border bg-card/40">
                            {colorGroups.map(({ color, items }) =>
                              items.map(item => {
                                const isOOS   = item.status === 'out_of_stock'
                                const packed  = isOOS ? 0 : item.quantityPacked
                                const key     = itemKey(item.artNumber, item.sizeNumber)
                                const totalScans = scannedMap[key] ?? 0

                                // Sibling items under the same key to distribute counts sequentially
                                const siblingItems = scanItems.filter(i => itemKey(i.artNumber, i.sizeNumber) === key)
                                const currentItemIndex = siblingItems.findIndex(i => i.id === item.id)

                                let assignedScannedCount = 0
                                let scansLeft = totalScans

                                for (let idx = 0; idx < siblingItems.length; idx++) {
                                  const sibling = siblingItems[idx]
                                  const sibPacked = sibling.status === 'out_of_stock' ? 0 : sibling.quantityPacked
                                  
                                  if (idx === currentItemIndex) {
                                    if (idx === siblingItems.length - 1) {
                                      assignedScannedCount = scansLeft
                                    } else {
                                      assignedScannedCount = Math.min(scansLeft, sibPacked)
                                    }
                                    break
                                  } else {
                                    scansLeft -= Math.min(scansLeft, sibPacked)
                                  }
                                }

                                const done    = isOOS || assignedScannedCount >= packed
                                const partial = !done && assignedScannedCount > 0

                                // Find matching scans for this article + size
                                const matchingScans = scannedQrs.filter(raw => {
                                  if (!isValidWarehouseQr(raw)) return false
                                  const p = parseQr(raw)
                                  return articlesMatch(p.articleCode, item.artNumber) &&
                                         String(p.size).toUpperCase() === (item.sizeNumber ?? '').toUpperCase()
                                })

                                // Distribute matching QR codes sequentially to current item
                                let itemScans: string[] = []
                                let qrScansLeft = [...matchingScans]

                                for (let idx = 0; idx < siblingItems.length; idx++) {
                                  const sibling = siblingItems[idx]
                                  const sibPacked = sibling.status === 'out_of_stock' ? 0 : sibling.quantityPacked
                                  
                                  if (idx === currentItemIndex) {
                                    if (idx === siblingItems.length - 1) {
                                      itemScans = qrScansLeft
                                    } else {
                                      itemScans = qrScansLeft.slice(0, sibPacked)
                                    }
                                    break
                                  } else {
                                    qrScansLeft = qrScansLeft.slice(sibPacked)
                                  }
                                }

                                // Unique prices and their scan count parsed from scanned QR codes
                                const priceCounts: Record<number, number> = {}
                                itemScans.forEach(raw => {
                                  const p = parseQr(raw).mrp
                                  priceCounts[p] = (priceCounts[p] ?? 0) + 1
                                })
                                const priceEntries = Object.entries(priceCounts)

                                return (
                                  <tr key={item.id} className={`transition-colors select-none ${
                                    isOOS
                                      ? 'bg-red-50/10 dark:bg-red-950/5 hover:bg-red-50/15'
                                      : done
                                      ? 'bg-blue-50/10 dark:bg-blue-950/5 hover:bg-blue-50/15'
                                      : 'hover:bg-muted/10 odd:bg-card/30 even:bg-muted/5'
                                  }`}>
                                    <td className="px-3.5 py-2.5 font-medium text-foreground text-xs sm:text-sm">{color}</td>
                                    <td className="px-2 py-2.5 font-mono text-center text-foreground text-xs sm:text-sm font-semibold">{item.sizeNumber ?? '—'}</td>
                                    <td className="px-2 py-2.5 font-mono text-center text-muted-foreground text-xs sm:text-sm">{item.quantityOrdered}</td>
                                    <td className="px-2 py-2.5 font-mono text-center text-green-600 dark:text-green-400 text-xs sm:text-sm font-bold">
                                      {isOOS ? <span className="text-red-500 font-normal text-[10px] bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">OOS</span> : packed}
                                    </td>
                                    <td className="px-2 py-2.5 font-mono text-center text-xs sm:text-sm">
                                      {isOOS ? (
                                        <span className="text-muted-foreground font-normal text-[10px]">—</span>
                                      ) : (
                                        <span className={`inline-flex items-center justify-center min-w-8 px-2.5 py-0.5 rounded-full text-xs font-bold leading-none ${
                                          done
                                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50 shadow-xs'
                                            : partial
                                            ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/10'
                                            : 'bg-muted text-muted-foreground/80'
                                        }`}>
                                          {assignedScannedCount}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3.5 py-2.5 text-right font-mono text-foreground text-xs sm:text-sm font-semibold whitespace-nowrap">
                                      {priceEntries.length > 0 ? (
                                        <div className="flex flex-wrap gap-1 justify-end max-w-[140px] ml-auto">
                                          {priceEntries.map(([mrp, qty]) => (
                                            <span key={mrp} className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-semibold text-foreground border border-border/30 shadow-xs">
                                              ₹{parseFloat(mrp).toFixed(2)}*{qty}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </td>
                                    {showDevTracking && (
                                      <td className="px-3.5 py-2.5 font-mono text-[9px] text-muted-foreground min-w-[350px]">
                                        {itemScans.length > 0 ? (
                                          <div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto pr-1 items-start">
                                            {itemScans.map((raw, rIdx) => (
                                              <span key={rIdx} className="bg-muted/80 px-2 py-0.5 rounded select-all inline-block w-fit border border-border/40 text-[8.5px] whitespace-nowrap" title={raw}>
                                                {raw}
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-muted-foreground">—</span>
                                        )}
                                      </td>
                                    )}
                                  </tr>
                                )
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Sticky bottom Save Bill button ── */}
          <div className="shrink-0 bg-background/95 backdrop-blur-sm border-t border-border px-4 py-3 safe-area-inset-bottom">
            {/* Disc % input — mirrors billing-scanner */}
            <div className="flex items-center gap-2 mb-2">
              <label htmlFor="biller-line-disc" className="text-[11px] text-muted-foreground whitespace-nowrap">Disc %</label>
              <input
                id="biller-line-disc"
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder="30"
                value={lineDiscPct}
                onChange={e => setLineDiscPct(e.target.value === '' ? '' : Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                onBlur={() => { if (lineDiscPct === '') setLineDiscPct(30) }}
                className="w-16 h-7 rounded-lg border border-input bg-background px-2 text-xs text-center focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-[11px] text-muted-foreground">line discount applied at print time</span>
            </div>
            <button
              type="button"
              onClick={handleSaveBill}
              disabled={!allVerified || isPending}
              className={`w-full rounded-xl py-3.5 text-sm font-semibold transition-all shadow-sm ${
                allVerified
                  ? 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              {isPending
                ? 'Saving…'
                : allVerified
                ? '✓ Save Bill'
                : `Scan all items to enable Save (${Object.values(scannedMap).reduce((a, b) => a + b, 0)} / ${scanItems.filter(i => i.status !== 'out_of_stock').reduce((s, i) => s + i.quantityPacked, 0)})`
              }
            </button>
          </div>
        </div>
      )}

      {/* ── Sticky bottom bar — Print / Mail Bills ── */}
      {activeTab === 'generated' && (() => {
        const selectedOrders = billedOrders.filter(o => printSelectedIds.has(o.id))
        const allLoaded = selectedOrders.every(o => !!printItemsMap[o.id])
        const canAct = selectedOrders.length > 0 && allLoaded
        const noneSelected = selectedOrders.length === 0
        return (
          <div className="fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur-sm border-t border-border">
            <div className="max-w-2xl mx-auto px-3 sm:px-4 py-2.5 flex items-center gap-2">

              {/* Selection badge + loading */}
              {selectedOrders.length > 0 && (
                <div className="flex items-center gap-2 mr-auto min-w-0">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground shrink-0">
                    <svg className="w-3 h-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    {selectedOrders.length} bill{selectedOrders.length !== 1 ? 's' : ''}
                  </span>
                  {!allLoaded && (
                    <svg className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  )}
                </div>
              )}

              {/* Mail button */}
              <button
                type="button"
                disabled={!canAct}
                onClick={() => handleMailBills(selectedOrders)}
                className={`flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0 ${
                  noneSelected ? 'hidden' : ''
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Mail
              </button>

              {/* Print button */}
              <button
                type="button"
                disabled={!canAct}
                onClick={() => handlePrintBills(selectedOrders)}
                className={`flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0 ${
                  noneSelected ? 'w-full sm:w-auto sm:ml-auto' : ''
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                {canAct ? 'Print' : noneSelected ? 'Select bills to print' : 'Loading…'}
              </button>

            </div>
          </div>
        )
      })()}

    </div>
  )
}
