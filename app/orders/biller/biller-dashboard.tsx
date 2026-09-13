'use client'

import { useState, useTransition, useRef, useCallback, useEffect } from 'react'
import jsQR from 'jsqr'
import { StatusPill, fmt, PageHeader, StatCard } from '../_components/shared'
import { markBilled, getOrderWithItems } from '@/app/actions/orders'
import { PageNav } from '@/components/page-nav'
import { parseQr, isValidWarehouseQr } from '@/lib/qr-parser'
import { SCAN_MAX_DIM, SCAN_INTERVAL_MS } from '@/components/scanner/constants'

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
  const [scanMsg, setScanMsg] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null)
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

  // ── banner helpers ───────────────────────────────────────────────────────────
  function showMsg(type: 'ok' | 'warn' | 'err', text: string) {
    if (scanMsgTimer.current) clearTimeout(scanMsgTimer.current)
    setScanMsg({ type, text })
    scanMsgTimer.current = setTimeout(() => setScanMsg(null), type === 'err' ? 0 : 3000)
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
    if (!isValidWarehouseQr(raw)) {
      showMsg('warn', 'Unrecognised QR — only warehouse box QR codes accepted')
      return
    }
    const parsed = parseQr(raw)
    const art    = parsed.articleCode.toUpperCase()
    const size   = String(parsed.size).toUpperCase()

    // find the matching packed item (artNumber matches, sizeNumber matches)
    const match = scanItems.find(i => {
      const iArt  = i.artNumber.toUpperCase()
      const iSize = (i.sizeNumber ?? '').toUpperCase()
      return iArt === art && iSize === size
    })

    if (!match) {
      showMsg('warn', `${art} / size ${size} — not in this order`)
      return
    }

    const key     = itemKey(match.artNumber, match.sizeNumber)
    const current = scannedMap[key] ?? 0
    const packed  = match.status === 'out_of_stock' ? 0 : match.quantityPacked

    if (current >= packed) {
      showMsg('warn', `${art} / size ${size} — already fully scanned (${packed} pkd)`)
      return
    }

    setScannedMap(prev => ({ ...prev, [key]: current + 1 }))
    triggerFeedback()
    showMsg('ok', `${art} / size ${size} — ${current + 1}/${packed}`)
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
    const scale = Math.min(1, SCAN_MAX_DIM / Math.max(video.videoWidth, video.videoHeight))
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
    setScanMsg(null)

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
    setScanMsg(null)
  }

  // ── save bill ────────────────────────────────────────────────────────────────
  function handleSaveBill() {
    if (!scanOrder) return
    const orderId = scanOrder.id
    closeScanner()
    setActiveId(orderId)
    startTransition(async () => {
      await markBilled(orderId)
      setOrders(prev =>
        prev.map(o => o.id === orderId ? { ...o, status: 'billed', billerId: currentBillerId, billedAt: new Date() } : o)
      )
      setActiveId(null)
    })
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

  const counts = {
    total:   orders.length,
    packed:  orders.filter(o => o.status === 'packed').length,
    billed:  orders.filter(o => o.status === 'billed').length,
    myBills: orders.filter(o => o.status === 'billed' && o.billerId === currentBillerId).length,
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

        <div className="space-y-3">
          {orders.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">No orders to verify 🎉</div>
          )}
          {orders.map(order => {
            const isProcessing = isPending && activeId === order.id
            const isBilled = order.status === 'billed'
            return (
              <div
                key={order.id}
                onClick={() => handleViewOrder(order)}
                className={`w-full text-left rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors cursor-pointer ${
                  isBilled ? 'border-blue-200 dark:border-blue-800' : 'border-border'
                }`}
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
                    {isBilled && order.billedAt && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Billed: {fmt(order.billedAt)}</p>
                    )}
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    {order.status === 'packed' && (
                      <button
                        type="button"
                        onClick={() => openScanner(order)}
                        disabled={isProcessing}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {isProcessing ? '…' : 'Generate Bill'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
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
                          Size <span className="ml-1 text-[10px] font-normal opacity-60">ord→pkd</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {articleGroups.map(({ artNumber, colorGroups }) =>
                        colorGroups.map(({ color, items }, ci) => {
                          const allOrd = colorGroups.flatMap(cg => cg.items).reduce((s, i) => s + i.quantityOrdered, 0)
                          const allPkd = colorGroups.flatMap(cg => cg.items).reduce((s, i) => s + i.quantityPacked, 0)
                          return (
                            <tr key={`${artNumber}-${color}`} className="border-b border-border hover:bg-muted/20">
                              {ci === 0 && (
                                <td className="px-4 py-2.5 font-semibold text-xs align-top border-r border-border" rowSpan={colorGroups.length}>
                                  {artNumber}
                                  <span className="block font-normal text-muted-foreground tabular-nums mt-0.5">{allOrd} ord</span>
                                  <span className={`block font-semibold tabular-nums ${allPkd < allOrd ? 'text-yellow-500' : 'text-green-600 dark:text-green-400'}`}>{allPkd} pkd</span>
                                </td>
                              )}
                              <td className="px-3 py-2.5 text-xs font-medium text-foreground align-top w-28 border-r border-border">{color}</td>
                              <td className="px-3 py-2.5 align-top">
                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                  {items.map(item => {
                                    const isOOS  = item.status === 'out_of_stock'
                                    const isFull = !isOOS && item.quantityPacked >= item.quantityOrdered
                                    return (
                                      <span key={item.id} className="inline-flex items-baseline gap-0.5 tabular-nums whitespace-nowrap">
                                        <span className="text-xs text-foreground">{item.sizeNumber ?? '—'}</span>
                                        <span className="text-[10px] text-muted-foreground/50 mx-px">/</span>
                                        <span className="text-xs font-bold text-foreground">{item.quantityOrdered}</span>
                                        <span className="text-[10px] text-muted-foreground/40">→</span>
                                        <span className={`text-xs font-bold ${isOOS ? 'text-red-500' : isFull ? 'text-green-600 dark:text-green-400' : 'text-yellow-500'}`}>
                                          {isOOS ? 0 : item.quantityPacked}
                                        </span>
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
                          <span className="text-foreground font-medium tabular-nums">{detailItems.reduce((s, i) => s + i.quantityOrdered, 0)}</span>
                          <span className="text-muted-foreground mx-1">ord /</span>
                          <span className={`font-bold tabular-nums ${
                            detailItems.reduce((s, i) => s + i.quantityPacked, 0) < detailItems.reduce((s, i) => s + i.quantityOrdered, 0) ? 'text-yellow-500' : 'text-green-600 dark:text-green-400'
                          }`}>{detailItems.reduce((s, i) => s + i.quantityPacked, 0)}</span>
                          <span className="text-muted-foreground ml-1">pkd</span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>

              {detailOrder.status === 'packed' && (
                <button
                  type="button"
                  disabled={isPending && activeId === detailOrder.id}
                  onClick={() => openScanner(detailOrder)}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Generate Bill
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

            {/* ── Item verification checklist ── */}
            <div className="px-4 pt-4 pb-28 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Order items
              </p>

              {scanArticleGroups.map(({ artNumber, colorGroups }) => {
                const allItems   = colorGroups.flatMap(cg => cg.items)
                const artDone    = allItems.every(i => {
                  if (i.status === 'out_of_stock') return true
                  return (scannedMap[itemKey(i.artNumber, i.sizeNumber)] ?? 0) >= i.quantityPacked
                })
                return (
                  <div key={artNumber} className={`rounded-xl border overflow-hidden ${artDone ? 'border-blue-200 dark:border-blue-800' : 'border-border'}`}>
                    {/* Article header */}
                    <div className={`flex items-center justify-between px-3.5 py-2 border-b ${artDone ? 'border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20' : 'border-border bg-muted/30'}`}>
                      <span className="text-xs font-bold font-mono text-foreground">{artNumber}</span>
                      {artDone && (
                        <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* Items */}
                    <div className="divide-y divide-border bg-card">
                      {colorGroups.map(({ color, items }) =>
                        items.map(item => {
                          const isOOS   = item.status === 'out_of_stock'
                          const packed  = isOOS ? 0 : item.quantityPacked
                          const key     = itemKey(item.artNumber, item.sizeNumber)
                          const scanned = scannedMap[key] ?? 0
                          const done    = isOOS || scanned >= packed
                          const partial = !done && scanned > 0

                          return (
                            <div key={item.id} className="flex items-center justify-between px-3.5 py-3">
                              {/* Left — dot + label */}
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`shrink-0 w-2 h-2 rounded-full ${
                                  isOOS ? 'bg-red-400' : done ? 'bg-blue-500' : partial ? 'bg-yellow-400' : 'bg-border'
                                }`} />
                                <div className="min-w-0">
                                  <span className="text-xs font-medium text-foreground">{color}</span>
                                  {item.sizeNumber && (
                                    <span className="ml-1.5 text-xs text-muted-foreground">Size {item.sizeNumber}</span>
                                  )}
                                </div>
                              </div>

                              {/* Right — status */}
                              <div className="shrink-0 flex items-center gap-2">
                                {isOOS ? (
                                  <span className="text-[11px] font-medium text-red-500">Out of stock</span>
                                ) : (
                                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
                                    done
                                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                      : partial
                                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                      : 'bg-muted text-muted-foreground'
                                  }`}>
                                    {scanned}&thinsp;/&thinsp;{packed}
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Sticky bottom Save Bill button ── */}
          <div className="shrink-0 bg-background/95 backdrop-blur-sm border-t border-border px-4 py-3 safe-area-inset-bottom">
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
    </div>
  )
}
