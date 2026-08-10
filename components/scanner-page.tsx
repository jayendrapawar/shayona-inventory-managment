'use client'

import jsQR from 'jsqr'
import { User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { recordScan, getCurrentUserName, getRecentScans, deleteScan } from '@/app/actions/scan'
import { addManualEntry } from '@/app/actions/dashboard'
import { DUPLICATE_QR_ERROR, DUPLICATE_ENTRY_ERROR, INVALID_QR_ERROR } from '@/lib/errors'
import { isValidWarehouseQr, parseQr } from '@/lib/qr-parser'
import { signOut } from '@/lib/auth-client'
import { useLanguage } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'
import { enqueue, getQueue, removeFromQueue, type OfflineEntry } from '@/lib/offline-queue'
import { useOnline } from '@/lib/use-online'
import { syncQueue, type SyncResult } from '@/lib/sync-engine'

type RecentScan = Awaited<ReturnType<typeof getRecentScans>>[number]

// ─── Username persistence ────────────────────────────────────────────────────
// We store the username in localStorage so offline scans can be labelled
// even after a page refresh (server session isn't reachable offline).
const USER_KEY = 'shayona-offline-user'

// ─── Daily scan counter ───────────────────────────────────────────────────────
// Persisted in localStorage as { date: 'YYYY-MM-DD', count: number }
// Resets automatically when the calendar date changes (midnight).
const DAILY_SCAN_KEY = 'shayona-daily-scan-count'

function getTodayDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDailyScanCount(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(DAILY_SCAN_KEY)
    if (!raw) return 0
    const { date, count } = JSON.parse(raw) as { date: string; count: number }
    if (date !== getTodayDateStr()) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

function incrementDailyScanCount(): number {
  if (typeof window === 'undefined') return 0
  const next = getDailyScanCount() + 1
  localStorage.setItem(DAILY_SCAN_KEY, JSON.stringify({ date: getTodayDateStr(), count: next }))
  return next
}

function getCachedUser(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(USER_KEY) ?? ''
}
function setCachedUser(name: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(USER_KEY, name)
}

export function ScannerPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isFlashlightOn, setIsFlashlightOn] = useState(false)
  const [manualForm, setManualForm] = useState<{
    artNumber: string
    colorNumber: string
    sizeNumber: string
    quantity: number | ''
    mrp: string
    notes: string
    division: string
    mfgMonth: string
    mfgYear: string
  }>({
    artNumber: '',
    colorNumber: '',
    sizeNumber: '',
    quantity: '',
    mrp: '',
    notes: '',
    division: '',
    mfgMonth: '',
    mfgYear: '',
  })
  const [manualLoading, setManualLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const flashlightStreamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadProcessing, setUploadProcessing] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [warnMsg, setWarnMsg] = useState<string | null>(null)
  const [infoMsg, setInfoMsg] = useState<string | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanningRef = useRef(false)
  // Cooldown ref — true for 2s after each successful scan so the same
  // QR code isn't re-read while the worker is still holding the device.
  const scanPausedRef = useRef(false)

  const [dailyScanCount, setDailyScanCount] = useState<number>(0)
  const [userName, setUserName] = useState<string>('')
  const [recentScans, setRecentScans] = useState<RecentScan[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [lastCameraScan, setLastCameraScan] = useState<RecentScan | null>(null)
  const [lastManualEntry, setLastManualEntry] = useState<RecentScan | null>(null)
  const [lastOfflineScan, setLastOfflineScan] = useState<OfflineEntry | null>(null)
  const [lastOfflineManual, setLastOfflineManual] = useState<OfflineEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RecentScan | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // ── Offline state ──────────────────────────────────────────────────────────
  const [offlineQueue, setOfflineQueue] = useState<OfflineEntry[]>([])
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const syncResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refresh local queue from IndexedDB
  async function refreshOfflineQueue() {
    try {
      const q = await getQueue()
      setOfflineQueue(q)
    } catch {
      // IndexedDB unavailable — silently ignore
    }
  }

  // ── Sync handler (called on reconnect & on mount when online) ──────────────
  const handleSync = useCallback(async () => {
    const pending = offlineQueue.filter((e) => e.status === 'pending' || e.status === 'syncing')
    if (pending.length === 0) {
      // Re-check IndexedDB directly in case state is stale
      const q = await getQueue()
      const actualPending = q.filter((e) => e.status === 'pending' || e.status === 'syncing')
      if (actualPending.length === 0) return
    }

    setIsSyncing(true)
    try {
      const result = await syncQueue()
      setSyncResult(result)
      if (syncResultTimerRef.current) clearTimeout(syncResultTimerRef.current)
      syncResultTimerRef.current = setTimeout(() => setSyncResult(null), 6000)
      await refreshOfflineQueue()
      // Reload recent scans to show newly synced items
      if (result.synced > 0) loadRecentScans()
    } finally {
      setIsSyncing(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // useOnline: tracks online/offline and calls handleSync on reconnect
  const isOnline = useOnline(handleSync)

  // ── Mount: load user, recent scans, offline queue, auto-start camera ───────
  useEffect(() => {
    // Restore persisted daily scan count (works offline)
    setDailyScanCount(getDailyScanCount())

    // Restore cached username immediately (available offline)
    const cached = getCachedUser()
    if (cached) setUserName(cached)

    // Try fetching the authoritative name from the server
    getCurrentUserName()
      .then((name) => {
        if (name) {
          setUserName(name)
          setCachedUser(name)
        }
      })
      .catch(() => {})

    loadRecentScans()
    refreshOfflineQueue()

    // If we're already online at mount and there's a queue, sync it
    if (navigator.onLine) {
      getQueue().then((q) => {
        if (q.some((e) => e.status === 'pending')) {
          handleSync()
        }
      }).catch(() => {})
    }

    // Auto-start camera immediately — no button tap needed
    startCamera()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      scanningRef.current = false
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      if (syncResultTimerRef.current) clearTimeout(syncResultTimerRef.current)
      if (flashlightStreamRef.current) {
        flashlightStreamRef.current.getTracks().forEach((t) => t.stop())
        flashlightStreamRef.current = null
      }
    }
  }, [])

  async function loadRecentScans() {
    setRecentLoading(true)
    try {
      const data = await getRecentScans(50)
      setRecentScans(data)
    } catch {
      // offline — silently ignore
    } finally {
      setRecentLoading(false)
    }
  }

  function triggerScanFeedback() {
    // Beep — synthesised via Web Audio API (no audio file required)
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1046, ctx.currentTime)   // C6 — pleasant, short
      gain.gain.setValueAtTime(0.35, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.18)
      osc.onended = () => ctx.close()
    } catch {
      // Web Audio not available — silently skip
    }
    // Vibration — 80 ms pulse
    try {
      if (navigator.vibrate) navigator.vibrate(80)
    } catch {
      // Vibration not available — silently skip
    }
  }

  function showSuccess(msg: string) {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    setError(null)
    setWarnMsg(null)
    setSuccessMsg(msg)
    successTimerRef.current = setTimeout(() => setSuccessMsg(null), 3000)
  }

  function showWarning(msg: string) {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    setError(null)
    setSuccessMsg(null)
    setWarnMsg(msg)
    successTimerRef.current = setTimeout(() => setWarnMsg(null), 5000)
  }

  function showInfo(msg: string) {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    setError(null)
    setSuccessMsg(null)
    setWarnMsg(null)
    setInfoMsg(msg)
    successTimerRef.current = setTimeout(() => setInfoMsg(null), 4000)
  }

  function showError(msg: string) {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    setSuccessMsg(null)
    setWarnMsg(null)
    setInfoMsg(null)
    setError(msg)
  }

  async function handleLogout() {
    await signOut()
    router.push('/sign-in')
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  async function startCamera() {
    try {
      setError(null)
      setSuccessMsg(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      if (!videoRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      videoRef.current.srcObject = stream
      streamRef.current = stream
      setIsCameraActive(true)
      scanningRef.current = true
      const video = videoRef.current
      const startLoop = () => scanLoop(video)
      if (video.readyState >= 2) {
        startLoop()
      } else {
        video.addEventListener('loadeddata', startLoop, { once: true })
      }
    } catch (err) {
      showError(t('cameraPermissionError'))
      console.error('Camera error:', err)
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']
    if (!allowed.includes(file.type)) {
      showError(t('invalidImageFile'))
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setUploadProcessing(true)
    setSuccessMsg(null)
    setError(null)

    try {
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(file)
      } catch {
        showError(t('invalidImageFile'))
        bitmap = null as unknown as ImageBitmap
      }
      if (!bitmap) return

      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)

      if (!code) {
        showError(t('uploadQRError'))
        return
      }

      await handleCameraScan(code.data)
    } catch (err) {
      showError(t('uploadQRError'))
      console.error('Image upload scan error:', err)
    } finally {
      setUploadProcessing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function toggleFlashlight() {
    if (!isFlashlightOn) {
      try {
        let track: MediaStreamTrack | undefined
        if (streamRef.current) {
          track = streamRef.current.getVideoTracks()[0]
        } else {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false,
          })
          flashlightStreamRef.current = stream
          track = stream.getVideoTracks()[0]
        }
        if (!track) return
        await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
        setIsFlashlightOn(true)
      } catch (err) {
        console.error('Torch not supported:', err)
        if (flashlightStreamRef.current) {
          flashlightStreamRef.current.getTracks().forEach((t) => t.stop())
          flashlightStreamRef.current = null
        }
        showInfo(t('flashlightNotSupported'))
      }
    } else {
      const track =
        (streamRef.current ?? flashlightStreamRef.current)?.getVideoTracks()[0]
      if (track) {
        track.applyConstraints({ advanced: [{ torch: false } as MediaTrackConstraintSet] }).catch(() => {})
      }
      if (flashlightStreamRef.current) {
        flashlightStreamRef.current.getTracks().forEach((t) => t.stop())
        flashlightStreamRef.current = null
      }
      setIsFlashlightOn(false)
    }
  }

  function stopCamera() {
    scanningRef.current = false
    if (streamRef.current) {
      const cameraTrack = streamRef.current.getVideoTracks()[0]
      if (cameraTrack && isFlashlightOn && !flashlightStreamRef.current) {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
          .then((stream) => {
            flashlightStreamRef.current = stream
            const tr = stream.getVideoTracks()[0]
            if (tr) tr.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => {})
          })
          .catch(() => { setIsFlashlightOn(false) })
      }
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setIsCameraActive(false)
  }

  function scanLoop(video: HTMLVideoElement) {
    if (!scanningRef.current) return
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      requestAnimationFrame(() => scanLoop(video))
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)
    // Skip frame during post-scan cooldown — camera stays live
    if (scanPausedRef.current) {
      requestAnimationFrame(() => scanLoop(video))
      return
    }

    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code) {
        // Pause reading for 2s so the same QR isn't re-read immediately
        scanPausedRef.current = true
        setTimeout(() => { scanPausedRef.current = false }, 2000)
        handleCameraScan(code.data)
        // Do NOT stopCamera() — keep the loop running for the next scan
      }
    } catch (err) {
      console.error('Camera QR scan error:', err)
    }
    requestAnimationFrame(() => scanLoop(video))
  }

  // ── Core scan handler — online calls server, offline queues locally ─────────

  async function handleCameraScan(qrCode: string) {
    // Reject QR codes that don't match the warehouse format — never store empty/garbage data
    if (!isValidWarehouseQr(qrCode)) {
      showWarning('QR code format not recognised.')
      return
    }

    if (!isOnline) {
      const parsed = parseQr(qrCode)
      // Duplicate check against existing offline queue — match by boxCode (last field)
      const boxCode = qrCode.split('-').pop() ?? qrCode
      const queue = await getQueue()
      const dup = queue.find(
        (e) => (e.rawQrCode?.split('-').pop() ?? '') === boxCode
      )
      if (dup) {
        showWarning(dup.scannedByName ? `${t('duplicateByUser')} ${dup.scannedByName}` : t('duplicateQR'))
        return
      }
      const entry: OfflineEntry = {
        tempId:        crypto.randomUUID(),
        entryType:     'scan',
        rawQrCode:     qrCode,
        artNumber:     parsed.articleCode,
        colorNumber:   parsed.colorCode,
        sizeNumber:    parsed.size,
        division:      parsed.division || undefined,
        mrp:           parsed.mrp || undefined,
        mfgMonth:      parsed.mfgMonth || undefined,
        mfgYear:       parsed.mfgYear || undefined,
        quantity:      1,
        scannedByName: userName || getCachedUser(),
        savedAt:       Date.now(),
        status:        'pending',
      }
      await enqueue(entry)
      await refreshOfflineQueue()
      setLastOfflineScan(entry)
      setDailyScanCount(incrementDailyScanCount())
      triggerScanFeedback()
      showSuccess(t('offlineSaved'))
      return
    }

    const res = await recordScan(qrCode)
    if (!res.ok) {
      if (res.error === INVALID_QR_ERROR) {
        showWarning('QR code format not recognised. Only warehouse QR codes can be scanned.')
      } else if (res.error === DUPLICATE_QR_ERROR) {
        const who = res.scannedByName
        showWarning(who ? `${t('duplicateByUser')} ${who}` : t('duplicateQR'))
      } else {
        showError(t('scanRecordError'))
      }
      return
    }
    setLastCameraScan(res.data)
    setDailyScanCount(incrementDailyScanCount())
    triggerScanFeedback()
    showSuccess(t('cameraScanSuccess'))
    loadRecentScans()
  }

  async function handleManualForm(e: React.FormEvent) {
    e.preventDefault()
    setManualLoading(true)
    setSuccessMsg(null)
    setWarnMsg(null)
    setError(null)

    try {
      if (!isOnline) {
        const art      = manualForm.artNumber.trim().toUpperCase()
        const color    = manualForm.colorNumber.trim().toUpperCase()
        const size     = manualForm.sizeNumber.trim().toUpperCase()
        const mrpVal   = manualForm.mrp ? parseFloat(manualForm.mrp) : undefined
        const divVal   = manualForm.division || undefined
        const monthVal = manualForm.mfgMonth ? parseInt(manualForm.mfgMonth) : undefined
        const yearVal  = manualForm.mfgYear  ? parseInt(manualForm.mfgYear)  : undefined
        const qty      = manualForm.quantity || 1

        // Quantity-merge check — same Art+Color+Size+Division+MRP+MfgMonth+MfgYear in queue → increment
        const queue = await getQueue()
        const dup = queue.find(
          (e) =>
            e.entryType  === 'manual' &&
            e.artNumber  === art   && e.colorNumber === color && e.sizeNumber === size &&
            e.division   === divVal &&
            e.mrp        === mrpVal &&
            e.mfgMonth   === monthVal && e.mfgYear === yearVal
        )
        if (dup) {
          await enqueue({ ...dup, quantity: dup.quantity + qty })
          await refreshOfflineQueue()
          setLastOfflineManual({ ...dup, quantity: dup.quantity + qty })
          setManualForm({ artNumber: '', colorNumber: '', sizeNumber: '', quantity: '', mrp: '', notes: '', division: '', mfgMonth: '', mfgYear: '' })
          showSuccess(t('offlineSaved'))
          return
        }

        const entry: OfflineEntry = {
          tempId:        crypto.randomUUID(),
          entryType:     'manual',
          artNumber:     art,
          colorNumber:   color,
          sizeNumber:    size,
          quantity:      qty,
          mrp:           mrpVal,
          notes:         manualForm.notes || undefined,
          division:      divVal,
          mfgMonth:      monthVal,
          mfgYear:       yearVal,
          scannedByName: userName || getCachedUser(),
          savedAt:       Date.now(),
          status:        'pending',
        }
        await enqueue(entry)
        await refreshOfflineQueue()
        setLastOfflineManual(entry)
        setManualForm({ artNumber: '', colorNumber: '', sizeNumber: '', quantity: '', mrp: '', notes: '', division: '', mfgMonth: '', mfgYear: '' })
        showSuccess(t('offlineSaved'))
        return
      }

      const res = await addManualEntry(
        manualForm.artNumber,
        manualForm.colorNumber,
        manualForm.sizeNumber,
        manualForm.quantity || 1,
        manualForm.notes || undefined,
        manualForm.mrp ? parseFloat(manualForm.mrp) : undefined,
        manualForm.division || undefined,
        manualForm.mfgMonth ? parseInt(manualForm.mfgMonth) : undefined,
        manualForm.mfgYear ? parseInt(manualForm.mfgYear) : undefined,
      )
      if (!res.ok) {
        if (res.error === DUPLICATE_ENTRY_ERROR) {
          const who = res.scannedByName
          showWarning(who ? `${t('duplicateByUser')} ${who}` : t('duplicateQR'))
        } else {
          showError(t('scanRecordError'))
        }
        return
      }
      setLastManualEntry(res.data)
      setManualForm({ artNumber: '', colorNumber: '', sizeNumber: '', quantity: '', mrp: '', notes: '', division: '', mfgMonth: '', mfgYear: '' })
      showSuccess(t('manualEntrySuccess'))
      loadRecentScans()
    } catch (err) {
      showError(t('scanRecordError'))
      console.error('addManualEntry error:', err)
    } finally {
      setManualLoading(false)
    }
  }

  // ── Delete (server rows) ───────────────────────────────────────────────────

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteScan(
        deleteTarget.id,
        deleteTarget.rawQrCode?.split('-').pop(),
      )
      // Always remove this specific box entry from the list.
      // If the DB row still exists (updated !== null), other boxes of the same
      // SKU remain in the list with their own entries.
      setRecentScans((prev) =>
        prev.filter((s) => s.rawQrCode !== deleteTarget.rawQrCode)
      )
      setDeleteTarget(null)
      setDeleteConfirmText('')
    } catch {
      // silently ignore — row stays visible
    } finally {
      setDeleteLoading(false)
    }
  }

  // ── Dismiss an offline error entry ─────────────────────────────────────────

  async function handleDismissOfflineError(tempId: string) {
    await removeFromQueue(tempId)
    await refreshOfflineQueue()
  }

  // ─── Last scan summary card ────────────────────────────────────────────────

  function ScanSummaryCard({ label, artNumber, colorNumber, sizeNumber, mrp, division, scannedByName }: {
    label: string
    artNumber?: string | null
    colorNumber?: string | null
    sizeNumber?: string | null
    mrp?: string | number | null
    division?: string | null
    scannedByName?: string | null
  }) {
    return (
      <div className="rounded-xl border bg-zinc-900 text-white p-4 space-y-3">
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400">{label}</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">Article</p>
            <p className="text-base font-bold leading-tight">{artNumber || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">Color</p>
            <p className="text-base font-bold leading-tight">{colorNumber || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">Size</p>
            <p className="text-base font-bold leading-tight">{sizeNumber || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">MRP</p>
            <p className="text-base font-bold leading-tight">
              {mrp != null ? `₹${Number(mrp).toFixed(2)}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">Division</p>
            <p className="text-base font-bold leading-tight">{division || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">By</p>
            <p className="text-base font-bold leading-tight">{scannedByName || '—'}</p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Feedback banners ──────────────────────────────────────────────────────

  function Banners() {
    return (
      <>
        {successMsg && (
          <div className="rounded-md bg-green-100 px-3 py-2 text-sm text-green-800 border border-green-300">
            {successMsg}
          </div>
        )}
        {warnMsg && (
          <div className="rounded-md bg-yellow-100 px-3 py-2 text-sm text-yellow-800 border border-yellow-300">
            {warnMsg}
          </div>
        )}
        {infoMsg && (
          <div className="rounded-md bg-blue-100 px-3 py-2 text-sm text-blue-800 border border-blue-300">
            {infoMsg}
          </div>
        )}
        {error && (
          <div className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </>
    )
  }

  // ─── Pending count across all states ──────────────────────────────────────
  const pendingCount   = offlineQueue.filter((e) => e.status === 'pending' || e.status === 'syncing').length
  const errorCount     = offlineQueue.filter((e) => e.status === 'error').length
  const totalOffline   = offlineQueue.length

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6">

        {/* ── Offline banner ─────────────────────────────────────────────── */}
        {!isOnline && (
          <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            {/* wifi-off icon */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="h-4 w-4 shrink-0 mt-0.5">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
              <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
              <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
              <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
            <span>{t('offlineBanner')}</span>
          </div>
        )}

        {/* ── Sync in-progress banner ────────────────────────────────────── */}
        {isSyncing && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="h-4 w-4 shrink-0 animate-spin">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {t('syncing')}
          </div>
        )}

        {/* ── Sync result banner ─────────────────────────────────────────── */}
        {syncResult && !isSyncing && (
          <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            syncResult.duplicates > 0 || syncResult.errors > 0
              ? 'border-yellow-300 bg-yellow-50 text-yellow-800'
              : 'border-green-300 bg-green-50 text-green-800'
          }`}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="h-4 w-4 shrink-0 mt-0.5">
              {syncResult.duplicates === 0 && syncResult.errors === 0
                ? <><polyline points="20 6 9 17 4 12" /></>
                : <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>
              }
            </svg>
            <span>
              {syncResult.synced > 0 && syncResult.duplicates === 0 && syncResult.errors === 0
                ? t('syncSuccess')
                : `${t('syncPartial')} ${syncResult.synced > 0 ? `${syncResult.synced} synced. ` : ''}${syncResult.duplicates > 0 ? `${syncResult.duplicates} ${t('syncDuplicates')} ` : ''}${syncResult.errors > 0 ? `${syncResult.errors} failed (will retry).` : ''}`
              }
            </span>
          </div>
        )}

        {/* ── Pending offline items pill (shown when online + have pending) */}
        {isOnline && pendingCount > 0 && !isSyncing && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
            <span>⚡ {pendingCount} {t('offlinePending')}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
              onClick={handleSync} disabled={isSyncing}>
              {t('retrySync')}
            </Button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">{t('warehouseScanner')}</h1>
              {!isOnline && (
                <span className="shrink-0 rounded-full bg-yellow-100 border border-yellow-300 px-2 py-0.5 text-[10px] font-semibold text-yellow-700 uppercase tracking-wide">
                  {t('offlineBadge')}
                </span>
              )}
            </div>
            <div className="flex gap-1.5 sm:gap-2 items-center shrink-0">
              <LanguageToggle />
              <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3" onClick={() => router.push('/dashboard')}>
                {t('dashboardLink')}
              </Button>
              <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-3" onClick={handleLogout}>
                {t('signOut')}
              </Button>
            </div>
          </div>
          {userName && (
            <div className="flex items-center gap-1 ml-auto mt-0.5">
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white">
                <User className="h-2.5 w-2.5" />
              </div>
              <span className="text-xs font-semibold text-muted-foreground">{userName}</span>
            </div>
          )}
        </div>

        <Tabs
          defaultValue="camera"
          className="w-full"
          onValueChange={(tab) => {
            if (tab === 'camera') {
              startCamera()
            } else {
              stopCamera()
            }
          }}
        >
          <TabsList className={`grid w-full ${totalOffline > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <TabsTrigger value="camera" className="text-[11px] sm:text-sm truncate">{t('cameraTab')}</TabsTrigger>
            <TabsTrigger value="manual" className="text-[11px] sm:text-sm truncate">{t('manualTab')}</TabsTrigger>
            <TabsTrigger value="recent" className="text-[11px] sm:text-sm truncate">{t('recentScansTab')}</TabsTrigger>
            {totalOffline > 0 && (
              <TabsTrigger value="offline" className="text-xs sm:text-sm px-1 sm:px-3">
                {/* Mobile: wifi-off icon + badge only; Desktop: full label */}
                <span className="flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="h-3.5 w-3.5 shrink-0">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                    <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                    <line x1="12" y1="20" x2="12.01" y2="20" />
                  </svg>
                  <span className="hidden sm:inline">{t('offlineQueueTitle')}</span>
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-yellow-500 px-1 text-[10px] font-bold text-white">
                    {totalOffline}
                  </span>
                </span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* ── Camera Tab ──────────────────────────────────────────────── */}
          <TabsContent value="camera" className="space-y-4">
            <Card>
              <CardHeader className="px-3 py-3 sm:px-6 sm:py-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm sm:text-base lg:text-lg truncate">{t('qrCodeScanner')}</CardTitle>
                      {dailyScanCount > 0 && (
                        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-green-500 px-1.5 text-xs font-bold text-white">
                          {dailyScanCount}
                        </span>
                      )}
                    </div>
                    <CardDescription className="text-xs sm:text-sm truncate">{t('qrScannerDesc')}</CardDescription>
                  </div>
                  <div className="flex items-center gap-1 sm:gap-1.5 rounded-full border px-2 sm:px-3 py-1 sm:py-1.5 bg-background shadow-sm shrink-0">
                    <span className="text-[10px] sm:text-xs font-medium text-muted-foreground">OFF</span>
                    <button
                      type="button"
                      aria-label="Toggle flashlight"
                      onClick={toggleFlashlight}
                      className={`relative inline-flex h-6 w-11 sm:h-7 sm:w-14 items-center rounded-full transition-colors focus-visible:outline-none ${
                        isFlashlightOn ? 'bg-green-500' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-white shadow transition-transform ${
                          isFlashlightOn ? 'translate-x-5 sm:translate-x-7' : 'translate-x-0.5'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                          stroke={isFlashlightOn ? '#16a34a' : '#9ca3af'} strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <path d="M18 6l-6 6" />
                          <path d="M7 17l1.5-1.5" />
                          <path d="M10.5 20.5l1-1" />
                          <path d="M3.5 14.5l1-1" />
                          <path d="M6 11l-2.5 2.5a4.95 4.95 0 0 0 7 7L13 18" />
                          <path d="M22 2l-7 7" />
                        </svg>
                      </span>
                    </button>
                    <span className={`text-[10px] sm:text-xs font-medium ${isFlashlightOn ? 'text-green-600' : 'text-muted-foreground'}`}>ON</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  {/* Scanning active overlay */}
                  {isCameraActive && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute inset-0 border-4 border-green-400 rounded-lg animate-pulse" />
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-green-300 text-xs font-medium px-3 py-1 rounded-full">
                        {t('cameraScanning')}
                      </div>
                    </div>
                  )}
                  {/* Paused state — dim overlay with text */}
                  {!isCameraActive && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
                      <p className="text-white/60 text-sm font-medium">{t('cameraNotActive')}</p>
                    </div>
                  )}
                  {/* Pause / Resume button — top-right corner */}
                  <button
                    type="button"
                    aria-label={isCameraActive ? t('stopCamera') : t('startCamera')}
                    onClick={isCameraActive ? stopCamera : startCamera}
                    className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75 transition-colors"
                  >
                    {isCameraActive ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    )}
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={uploadProcessing || isCameraActive}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadProcessing ? t('uploadQRProcessing') : t('uploadQRImage')}
                </Button>
                <Banners />
                {lastCameraScan && (
                  <ScanSummaryCard label="Last Scanned" {...lastCameraScan} mrp={lastCameraScan.mrp} />
                )}
                {lastOfflineScan && !lastCameraScan && (
                  <ScanSummaryCard label="Last Scanned (Offline)" {...lastOfflineScan} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Manual Entry Tab ─────────────────────────────────────────── */}
          <TabsContent value="manual" className="space-y-3">
            <Card>
              <CardHeader className="px-4 py-3 sm:px-6 sm:py-4">
                <CardTitle className="text-base">{t('manualEntryTitle')}</CardTitle>
                <CardDescription className="text-xs">{t('manualEntryDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 sm:px-6">
                <form onSubmit={handleManualForm} className="space-y-3">
                  {/* Row 1 — Art · Color */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="m-artNumber" className="text-xs">{t('artNumber')}</Label>
                      <Input
                        id="m-artNumber"
                        placeholder={t('artNumberPlaceholder')}
                        value={manualForm.artNumber}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, artNumber: e.target.value }))}
                        disabled={manualLoading}
                        className="h-8 text-sm"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="m-colorNumber" className="text-xs">{t('colorNumber')}</Label>
                      <Input
                        id="m-colorNumber"
                        placeholder={t('colorNumberPlaceholder')}
                        value={manualForm.colorNumber}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, colorNumber: e.target.value }))}
                        disabled={manualLoading}
                        className="h-8 text-sm"
                        required
                      />
                    </div>
                  </div>
                  {/* Row 2 — Size · Qty */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="m-sizeNumber" className="text-xs">{t('sizeNumber')}</Label>
                      <Input
                        id="m-sizeNumber"
                        type="number"
                        step="1"
                        min="0"
                        placeholder={t('sizeNumberPlaceholder')}
                        value={manualForm.sizeNumber}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, sizeNumber: e.target.value === '' ? '' : String(parseInt(e.target.value) || '') }))}
                        disabled={manualLoading}
                        className="h-8 text-sm"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="m-quantity" className="text-xs">{t('quantity')}</Label>
                      <Input
                        id="m-quantity"
                        type="number"
                        min="1"
                        placeholder="1"
                        value={manualForm.quantity}
                        onChange={(e) =>
                          setManualForm((prev) => ({ ...prev, quantity: e.target.value === '' ? '' : parseInt(e.target.value) || 1 }))
                        }
                        disabled={manualLoading}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  {/* Row 3 — MRP · Division */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="m-mrp" className="text-xs">{t('mrpCol')}</Label>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"> ₹</span>
                        <Input
                          id="m-mrp"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={manualForm.mrp}
                          onChange={(e) => setManualForm((prev) => ({ ...prev, mrp: e.target.value }))}
                          disabled={manualLoading}
                          className="h-8 text-sm pl-6"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="m-division" className="text-xs">Division</Label>
                      <select
                        id="m-division"
                        value={manualForm.division}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, division: e.target.value }))}
                        disabled={manualLoading}
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-0 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">Division</option>
                        <option value="Flite PU">Flite PU</option>
                        <option value="Flite EVA">Flite EVA</option>
                        <option value="Sparx">Sparx</option>
                        <option value="Bahamas">Bahamas</option>
                      </select>
                    </div>
                  </div>
                  {/* Row 4 — Mfg Month · Mfg Year */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="m-mfgMonth" className="text-xs">Mfg Month</Label>
                      <Input
                        id="m-mfgMonth"
                        type="number"
                        min="1"
                        max="12"
                        step="1"
                        placeholder="MM"
                        value={manualForm.mfgMonth}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, mfgMonth: e.target.value }))}
                        disabled={manualLoading}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="m-mfgYear" className="text-xs">Mfg Year</Label>
                      <Input
                        id="m-mfgYear"
                        type="number"
                        min="2000"
                        max="2099"
                        step="1"
                        placeholder="YYYY"
                        value={manualForm.mfgYear}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, mfgYear: e.target.value }))}
                        disabled={manualLoading}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  {/* Row 5 — Notes full width */}
                  <div className="space-y-1">
                    <Label htmlFor="m-notes" className="text-xs">{t('notes')}</Label>
                    <Input
                      id="m-notes"
                      placeholder={t('notesPlaceholder')}
                      value={manualForm.notes}
                      onChange={(e) => setManualForm((prev) => ({ ...prev, notes: e.target.value }))}
                      disabled={manualLoading}
                      className="h-8 text-sm"
                    />
                  </div>
                  <Banners />
                  <div className="flex gap-2 pt-1">
                    <Button type="submit" className="flex-1 h-9 text-sm" disabled={manualLoading}>
                      {manualLoading ? t('recording') : t('addEntry')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 text-sm px-4"
                      disabled={manualLoading}
                      onClick={() => setManualForm({ artNumber: '', colorNumber: '', sizeNumber: '', quantity: '', mrp: '', notes: '', division: '', mfgMonth: '', mfgYear: '' })}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
                  {lastManualEntry && (
                    <ScanSummaryCard label="Last Added" {...lastManualEntry} mrp={lastManualEntry.mrp} />
                  )}
                  {lastOfflineManual && !lastManualEntry && (
                    <ScanSummaryCard label="Last Added (Offline)" {...lastOfflineManual} />
                  )}
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Recent Scans Tab ─────────────────────────────────────────── */}
          <TabsContent value="recent" className="space-y-4">
            <Card>
              <CardHeader className="px-3 sm:px-6">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base sm:text-lg">{t('recentScansTitle')}</CardTitle>
                    <CardDescription className="text-xs sm:text-sm">{t('recentScansDesc')}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadRecentScans} disabled={recentLoading || !isOnline}>
                    ↻
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-0 sm:px-6">
                {!isOnline && recentScans.length === 0 ? (
                  <p className="text-center py-8 text-sm text-muted-foreground px-3">
                    You are offline. Previously loaded scans appear here once internet is available.
                  </p>
                ) : recentLoading ? (
                  <p className="text-center py-8 text-sm text-muted-foreground">{t('loading')}</p>
                ) : recentScans.length === 0 ? (
                  <p className="text-center py-8 text-sm text-muted-foreground">{t('noRecentScans')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('entryTypeCol')}</TableHead>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('artNumberCol')}</TableHead>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('colorCol')}</TableHead>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('sizeCol')}</TableHead>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell">{t('divisionCol')}</TableHead>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell text-right">{t('mrpCol')}</TableHead>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4 text-right">{t('quantityCol')}</TableHead>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4">{t('scannedByCol')}</TableHead>
                          <TableHead className="text-xs sm:text-sm px-3 sm:px-4 hidden md:table-cell">{t('lastScannedCol')}</TableHead>
                          <TableHead className="px-3 sm:px-4" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentScans.map((scan) => (
                          <TableRow key={scan.id}>
                            <TableCell className="px-3 sm:px-4">
                              <Badge variant={scan.entryType === 'scan' ? 'default' : 'secondary'} className="text-xs">
                                {scan.entryType}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs sm:text-sm font-semibold px-3 sm:px-4">
                              {scan.artNumber || '-'}
                            </TableCell>
                            <TableCell className="font-mono text-xs sm:text-sm px-3 sm:px-4">
                              {scan.colorNumber || '-'}
                            </TableCell>
                            <TableCell className="font-mono text-xs sm:text-sm px-3 sm:px-4">
                              {scan.sizeNumber || '-'}
                            </TableCell>
                            <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell">
                              {scan.division || '-'}
                            </TableCell>
                            <TableCell className="text-xs sm:text-sm px-3 sm:px-4 hidden sm:table-cell text-right">
                              {scan.mrp != null ? `₹${Number(scan.mrp).toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className="text-right px-3 sm:px-4">
                              <Badge variant="outline">{scan.quantity}</Badge>
                            </TableCell>
                            <TableCell className="text-xs sm:text-sm px-3 sm:px-4">
                              {scan.scannedByName || '-'}
                            </TableCell>
                            <TableCell className="text-xs sm:text-sm text-muted-foreground px-3 sm:px-4 hidden md:table-cell">
                              {new Date(scan.scannedAt).toLocaleDateString(undefined, {
                                year: 'numeric', month: '2-digit', day: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </TableCell>
                            <TableCell className="px-3 sm:px-4">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteTarget(scan)}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                  className="h-3.5 w-3.5">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                  <path d="M10 11v6" />
                                  <path d="M14 11v6" />
                                  <path d="M9 6V4h6v2" />
                                </svg>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Offline Queue Tab (only shown when queue has items) ───────── */}
          {totalOffline > 0 && (
            <TabsContent value="offline" className="space-y-4">
              <Card>
                <CardHeader className="px-3 sm:px-6">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        {t('offlineQueueTitle')}
                        {pendingCount > 0 && (
                          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-500 px-1.5 text-[11px] font-bold text-white">
                            {pendingCount}
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm">{t('offlineQueueDesc')}</CardDescription>
                    </div>
                    {isOnline && pendingCount > 0 && (
                      <Button size="sm" variant="outline" onClick={handleSync} disabled={isSyncing}>
                        {isSyncing ? t('syncing') : t('retrySync')}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-0 sm:px-6">
                  {offlineQueue.length === 0 ? (
                    <p className="text-center py-8 text-sm text-muted-foreground">{t('offlineQueueEmpty')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs px-3 sm:px-4">Status</TableHead>
                            <TableHead className="text-xs px-3 sm:px-4">{t('entryTypeCol')}</TableHead>
                            <TableHead className="text-xs px-3 sm:px-4">{t('artNumberCol')}</TableHead>
                            <TableHead className="text-xs px-3 sm:px-4">{t('colorCol')}</TableHead>
                            <TableHead className="text-xs px-3 sm:px-4">{t('sizeCol')}</TableHead>
                            <TableHead className="text-xs px-3 sm:px-4 text-right">{t('quantityCol')}</TableHead>
                            <TableHead className="text-xs px-3 sm:px-4 hidden sm:table-cell">Saved At</TableHead>
                            <TableHead className="px-3 sm:px-4" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {offlineQueue.map((entry) => (
                            <TableRow key={entry.tempId} className={entry.status === 'error' ? 'bg-destructive/5' : ''}>
                              <TableCell className="px-3 sm:px-4">
                                {entry.status === 'pending' && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 border border-yellow-300 px-2 py-0.5 text-[10px] font-semibold text-yellow-700">
                                    ⏳ {t('pendingSyncBadge')}
                                  </span>
                                )}
                                {entry.status === 'syncing' && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 border border-blue-300 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                    ↻ {t('syncing')}
                                  </span>
                                )}
                                {entry.status === 'error' && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 border border-red-300 px-2 py-0.5 text-[10px] font-semibold text-red-700" title={entry.errorMessage}>
                                    ✕ Duplicate
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="px-3 sm:px-4">
                                <Badge variant={entry.entryType === 'scan' ? 'default' : 'secondary'} className="text-xs">
                                  {entry.entryType}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs font-semibold px-3 sm:px-4">
                                {entry.artNumber || '-'}
                              </TableCell>
                              <TableCell className="font-mono text-xs px-3 sm:px-4">
                                {entry.colorNumber || '-'}
                              </TableCell>
                              <TableCell className="font-mono text-xs px-3 sm:px-4">
                                {entry.sizeNumber || '-'}
                              </TableCell>
                              <TableCell className="text-right px-3 sm:px-4">
                                <Badge variant="outline">{entry.quantity}</Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground px-3 sm:px-4 hidden sm:table-cell">
                                {new Date(entry.savedAt).toLocaleTimeString(undefined, {
                                  hour: '2-digit', minute: '2-digit',
                                })}
                              </TableCell>
                              <TableCell className="px-3 sm:px-4">
                                {entry.status === 'error' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                                    onClick={() => handleDismissOfflineError(entry.tempId)}
                                  >
                                    {t('dismissError')}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  {errorCount > 0 && (
                    <p className="px-3 sm:px-4 pt-3 pb-1 text-xs text-destructive">
                      {errorCount} duplicate item(s) could not be synced because they already exist in the database. Dismiss them to clear.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>

        {/* ── Delete confirm dialog ─────────────────────────────────────── */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-background border shadow-lg p-6 space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="h-4 w-4 text-destructive">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <h2 className="text-base font-semibold">Delete entry?</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                You are about to permanently delete{' '}
                <span className="font-mono font-semibold text-foreground">
                  {[deleteTarget.artNumber, deleteTarget.colorNumber, deleteTarget.sizeNumber]
                    .filter(Boolean)
                    .join(' · ') || `#${deleteTarget.id}`}
                </span>
                . This action <span className="font-semibold text-destructive">cannot be undone</span>.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="delete-confirm-input" className="text-xs text-muted-foreground">
                  Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm
                </Label>
                <Input
                  id="delete-confirm-input"
                  placeholder="Type DELETE here"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  disabled={deleteLoading}
                  autoFocus
                  autoComplete="off"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deleteLoading}
                  onClick={() => { setDeleteTarget(null); setDeleteConfirmText('') }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteLoading || deleteConfirmText !== 'DELETE'}
                  onClick={handleDeleteConfirm}
                >
                  {deleteLoading ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
