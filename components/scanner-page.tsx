'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { recordScan, getRecentScans, deleteScan, updateScanQuantity } from '@/app/actions/scan'
import { signOut } from '@/lib/auth-client'
import { useLanguage } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'

interface Scan {
  id: number
  artNumber?: string
  colorNumber?: string
  sizeNumber?: string
  quantity: number
  scannedAt: Date
}

export function ScannerPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [scans, setScans] = useState<Scan[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  async function handleLogout() {
    await signOut()
    router.push('/sign-in')
  }

  // Load recent scans on component mount
  useEffect(() => {
    loadScans()
  }, [])

  async function loadScans() {
    try {
      const result = await getRecentScans(50)
      setScans(result as Scan[])
    } catch (err) {
      console.error('Failed to load scans:', err)
    }
  }

  async function startCamera() {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setIsCameraActive(true)
        scanQRCode()
      }
    } catch (err) {
      setError(t('cameraPermissionError'))
      console.error('Camera error:', err)
    }
  }

  async function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setIsCameraActive(false)
  }

  function scanQRCode() {
    if (!isCameraActive || !videoRef.current || !canvasRef.current) return

    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight

    context.drawImage(videoRef.current, 0, 0)

    try {
      // Try to detect QR code using canvas data
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      const code = scanImageData(imageData)

      if (code) {
        handleScan(code)
        stopCamera()
        return
      }
    } catch (err) {
      console.error('QR scan error:', err)
    }

    // Continue scanning
    requestAnimationFrame(scanQRCode)
  }

  function scanImageData(imageData: ImageData): string | null {
    // Simplified QR code detection - in production use jsQR library
    // This is a placeholder that looks for patterns in the image
    // For now, we'll rely on manual input or text recognition
    return null
  }

  async function handleScan(qrCode: string) {
    setLoading(true)
    setError(null)

    try {
      const result = await recordScan(qrCode)
      setScans((prev) => [result as Scan, ...prev])
      setManualInput('')

      // Show confirmation
      setTimeout(() => setManualInput(''), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record scan')
    } finally {
      setLoading(false)
    }
  }

  async function handleManualInput(e: React.FormEvent) {
    e.preventDefault()
    if (!manualInput.trim()) return

    await handleScan(manualInput)
  }

  async function handleDeleteScan(scanId: number) {
    try {
      await deleteScan(scanId)
      setScans((prev) => prev.filter((s) => s.id !== scanId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete scan')
    }
  }

  async function handleUpdateQuantity(scanId: number, newQuantity: number) {
    if (newQuantity < 1) return

    try {
      const result = await updateScanQuantity(scanId, newQuantity)
      setScans((prev) =>
        prev.map((s) => (s.id === scanId ? { ...s, quantity: newQuantity } : s))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update quantity')
    }
  }

  // Group scans by art/color/size
  const groupedScans = scans.reduce(
    (acc, scan) => {
      const key = `${scan.artNumber}-${scan.colorNumber}-${scan.sizeNumber}`
      if (!acc[key]) {
        acc[key] = { ...scan, quantity: 0 }
      }
      acc[key].quantity += scan.quantity
      return acc
    },
    {} as Record<string, Scan>
  )

  return (
    <main className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('warehouseScanner')}</h1>
            <p className="text-muted-foreground">{t('scannerSubtitle')}</p>
          </div>
          <div className="flex gap-2 items-center">
            <LanguageToggle />
            <Button variant="outline" onClick={() => router.push('/dashboard')}>
              {t('dashboardLink')}
            </Button>
            <Button variant="outline" onClick={handleLogout}>
              {t('signOut')}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="camera" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="camera">{t('cameraTab')}</TabsTrigger>
            <TabsTrigger value="manual">{t('manualTab')}</TabsTrigger>
            <TabsTrigger value="inventory">{t('inventoryTab')}</TabsTrigger>
          </TabsList>

          {/* Camera Tab */}
          <TabsContent value="camera" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('qrCodeScanner')}</CardTitle>
                <CardDescription>{t('qrScannerDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  {!isCameraActive && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <div className="text-center">
                        <p className="text-white mb-4">{t('cameraNotActive')}</p>
                        <Button onClick={startCamera} size="lg">
                          {t('startCamera')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {isCameraActive && (
                  <Button onClick={stopCamera} variant="outline" className="w-full">
                    {t('stopCamera')}
                  </Button>
                )}

                {error && (
                  <div className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Manual Entry Tab */}
          <TabsContent value="manual" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('manualEntryTitle')}</CardTitle>
                <CardDescription>{t('manualEntryDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleManualInput} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="qr-code">{t('qrCodeLabel')}</Label>
                    <Input
                      id="qr-code"
                      placeholder={t('qrCodePlaceholder')}
                      value={manualInput}
                      onChange={(e) => setManualInput(e.target.value)}
                      disabled={loading}
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? t('recording') : t('recordScan')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Inventory Tab */}
          <TabsContent value="inventory" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('scannedInventory')}</CardTitle>
                <CardDescription>
                  {scans.length} {t('totalScannedItems')}, {Object.keys(groupedScans).length} {t('uniqueItemsScanned')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {scans.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t('noScansYet')}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('artNumberCol')}</TableHead>
                          <TableHead>{t('colorCol')}</TableHead>
                          <TableHead>{t('sizeCol')}</TableHead>
                          <TableHead className="text-right">{t('qtyCol')}</TableHead>
                          <TableHead className="text-right">{t('actionsCol')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scans.map((scan) => (
                          <TableRow key={scan.id}>
                            <TableCell className="font-mono text-sm">
                              {scan.artNumber || '-'}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {scan.colorNumber || '-'}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {scan.sizeNumber || '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleUpdateQuantity(scan.id, scan.quantity - 1)
                                  }
                                  disabled={scan.quantity <= 1}
                                >
                                  −
                                </Button>
                                <span className="w-8 text-center">{scan.quantity}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleUpdateQuantity(scan.id, scan.quantity + 1)
                                  }
                                >
                                  +
                                </Button>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteScan(scan.id)}
                              >
                                {t('delete')}
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
        </Tabs>
      </div>
    </main>
  )
}
