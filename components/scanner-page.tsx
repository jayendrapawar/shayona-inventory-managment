'use client'

import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { recordScan, getCurrentUserName, getRecentScans } from '@/app/actions/scan'
import { addManualEntry } from '@/app/actions/dashboard'
import { DUPLICATE_QR_ERROR, DUPLICATE_ENTRY_ERROR } from '@/lib/errors'
import { signOut } from '@/lib/auth-client'
import { useLanguage } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'

type RecentScan = Awaited<ReturnType<typeof getRecentScans>>[number]

export function ScannerPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isFlashlightOn, setIsFlashlightOn] = useState(false)
  const [manualForm, setManualForm] = useState({
    artNumber: '',
    colorNumber: '',
    sizeNumber: '',
    quantity: 1,
    notes: '',
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

  // New state
  const [userName, setUserName] = useState<string | null>(null)
  const [recentScans, setRecentScans] = useState<RecentScan[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [lastCameraScan, setLastCameraScan] = useState<RecentScan | null>(null)
  const [lastManualEntry, setLastManualEntry] = useState<RecentScan | null>(null)

  // Load user name + initial recent scans on mount
  useEffect(() => {
    getCurrentUserName().then(setUserName).catch(() => {})
    loadRecentScans()
  }, [])

  async function loadRecentScans() {
    setRecentLoading(true)
    try {
      const data = await getRecentScans(50)
      setRecentScans(data)
    } catch {
      // silently ignore
    } finally {
      setRecentLoading(false)
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

  // Stop scan loop and clear timers on unmount
  useEffect(() => {
    return () => {
      scanningRef.current = false
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      if (flashlightStreamRef.current) {
        flashlightStreamRef.current.getTracks().forEach((t) => t.stop())
        flashlightStreamRef.current = null
      }
    }
  }, [])

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

       const res = await recordScan(code.data)
      if (!res.ok) {
        if (res.error === DUPLICATE_QR_ERROR) {
          const who = res.scannedByName
          showWarning(who ? `${t('duplicateByUser')} ${who}` : t('duplicateQR'))
        } else {
          showError(t('scanRecordError'))
        }
      } else {
        setLastCameraScan(res.data)
        showSuccess(t('scanSuccess'))
        loadRecentScans()
      }
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
            const t = stream.getVideoTracks()[0]
            if (t) t.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] }).catch(() => {})
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

    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)

      if (code) {
        stopCamera()
        handleCameraScan(code.data)
        return
      }
    } catch (err) {
      console.error('Camera QR scan error:', err)
    }

    requestAnimationFrame(() => scanLoop(video))
  }

  async function handleCameraScan(qrCode: string) {
    const res = await recordScan(qrCode)
    if (!res.ok) {
      if (res.error === DUPLICATE_QR_ERROR) {
        const who = res.scannedByName
        showWarning(who ? `${t('duplicateByUser')} ${who}` : t('duplicateQR'))
      } else {
        showError(t('scanRecordError'))
      }
      return
    }
    setLastCameraScan(res.data)
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
      const res = await addManualEntry(
        manualForm.artNumber,
        manualForm.colorNumber,
        manualForm.sizeNumber,
        manualForm.quantity,
        manualForm.notes || undefined
      )
      if (!res.ok) {
        if (res.error === DUPLICATE_ENTRY_ERROR) {
          const who = res.scannedByName
          const msg = who
            ? `${t('duplicateByUser')} ${who}`
            : t('duplicateQR')
          showWarning(msg)
        } else {
          showError(t('scanRecordError'))
        }
        return
      }
      setLastManualEntry(res.data)
      setManualForm({ artNumber: '', colorNumber: '', sizeNumber: '', quantity: 1, notes: '' })
      showSuccess(t('manualEntrySuccess'))
      loadRecentScans()
    } catch (err) {
      showError(t('scanRecordError'))
      console.error('addManualEntry error:', err)
    } finally {
      setManualLoading(false)
    }
  }

  // ─── Last scan summary card ──────────────────────────────────────────────

  function LastScannedCard({ scan, label }: { scan: RecentScan; label: string }) {
    return (
      <div className="rounded-xl border bg-zinc-900 text-white p-4 space-y-3">
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400">{label}</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">Article</p>
            <p className="text-base font-bold leading-tight">{scan.artNumber || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">Color</p>
            <p className="text-base font-bold leading-tight">{scan.colorNumber || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">Size</p>
            <p className="text-base font-bold leading-tight">{scan.sizeNumber || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">MRP</p>
            <p className="text-base font-bold leading-tight">
              {scan.mrp != null ? `₹${Number(scan.mrp).toFixed(2)}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">Division</p>
            <p className="text-base font-bold leading-tight">{scan.division || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-0.5">By</p>
            <p className="text-base font-bold leading-tight">{scan.scannedByName || '—'}</p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Shared feedback banners ─────────────────────────────────────────────

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

  return (
    <main className="min-h-screen bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6">

        {/* Header */}
        <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('warehouseScanner')}</h1>
            <p className="text-sm text-muted-foreground">
              {userName
                ? `${t('welcomeGreeting')} ${userName}! ${t('goodDay')}`
                : t('scannerSubtitle')}
            </p>
          </div>
          <div className="flex gap-2 items-center shrink-0 justify-end">
            <LanguageToggle />
            <Button variant="outline" size="sm" onClick={() => router.push('/dashboard')}>
              {t('dashboardLink')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              {t('signOut')}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="camera" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="camera">{t('cameraTab')}</TabsTrigger>
            <TabsTrigger value="manual">{t('manualTab')}</TabsTrigger>
            <TabsTrigger value="recent">{t('recentScansTab')}</TabsTrigger>
          </TabsList>

          {/* ── Camera Tab ──────────────────────────────────────────────── */}
          <TabsContent value="camera" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base sm:text-lg">{t('qrCodeScanner')}</CardTitle>
                    <CardDescription className="text-xs sm:text-sm">{t('qrScannerDesc')}</CardDescription>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 rounded-full border px-2 sm:px-3 py-1.5 bg-background shadow-sm shrink-0">
                    <span className="text-xs font-medium text-muted-foreground">OFF</span>
                    <button
                      type="button"
                      aria-label="Toggle flashlight"
                      onClick={toggleFlashlight}
                      className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus-visible:outline-none ${
                        isFlashlightOn ? 'bg-green-500' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform ${
                          isFlashlightOn ? 'translate-x-7' : 'translate-x-0.5'
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
                    <span className={`text-xs font-medium ${isFlashlightOn ? 'text-green-600' : 'text-muted-foreground'}`}>ON</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  {!isCameraActive && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <div className="text-center">
                        <p className="text-white mb-4">{t('cameraNotActive')}</p>
                        <Button onClick={startCamera} size="lg">{t('startCamera')}</Button>
                      </div>
                    </div>
                  )}
                  {isCameraActive && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="absolute inset-0 border-4 border-green-400 rounded-lg animate-pulse" />
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-green-300 text-xs font-medium px-3 py-1 rounded-full">
                        {t('cameraScanning')}
                      </div>
                    </div>
                  )}
                </div>
                {isCameraActive && (
                  <Button onClick={stopCamera} variant="outline" className="w-full">{t('stopCamera')}</Button>
                )}
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
                  <LastScannedCard scan={lastCameraScan} label="Last Scanned" />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Manual Entry Tab ─────────────────────────────────────────── */}
          <TabsContent value="manual" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('manualEntryTitle')}</CardTitle>
                <CardDescription>{t('manualEntryDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleManualForm} className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="m-artNumber">{t('artNumber')}</Label>
                      <Input
                        id="m-artNumber"
                        placeholder={t('artNumberPlaceholder')}
                        value={manualForm.artNumber}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, artNumber: e.target.value }))}
                        disabled={manualLoading}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="m-colorNumber">{t('colorNumber')}</Label>
                      <Input
                        id="m-colorNumber"
                        placeholder={t('colorNumberPlaceholder')}
                        value={manualForm.colorNumber}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, colorNumber: e.target.value }))}
                        disabled={manualLoading}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="m-sizeNumber">{t('sizeNumber')}</Label>
                      <Input
                        id="m-sizeNumber"
                        placeholder={t('sizeNumberPlaceholder')}
                        value={manualForm.sizeNumber}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, sizeNumber: e.target.value }))}
                        disabled={manualLoading}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="m-quantity">{t('quantity')}</Label>
                      <Input
                        id="m-quantity"
                        type="number"
                        min="1"
                        value={manualForm.quantity}
                        onChange={(e) =>
                          setManualForm((prev) => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))
                        }
                        disabled={manualLoading}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="m-notes">{t('notes')}</Label>
                      <Input
                        id="m-notes"
                        placeholder={t('notesPlaceholder')}
                        value={manualForm.notes}
                        onChange={(e) => setManualForm((prev) => ({ ...prev, notes: e.target.value }))}
                        disabled={manualLoading}
                      />
                    </div>
                  </div>
                  <Banners />
                  {lastManualEntry && (
                    <LastScannedCard scan={lastManualEntry} label="Last Added" />
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" className="w-full" disabled={manualLoading}>
                      {manualLoading ? t('recording') : t('addEntry')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={manualLoading}
                      onClick={() => setManualForm({ artNumber: '', colorNumber: '', sizeNumber: '', quantity: 1, notes: '' })}
                    >
                      {t('cancel')}
                    </Button>
                  </div>
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
                  <Button variant="outline" size="sm" onClick={loadRecentScans} disabled={recentLoading}>
                    ↻
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-0 sm:px-6">
                {recentLoading ? (
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
