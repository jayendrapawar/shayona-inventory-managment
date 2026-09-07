'use client'

import jsQR from 'jsqr'
import {
  useCallback, useEffect, useId, useImperativeHandle, useMemo,
  useRef, useState, forwardRef,
} from 'react'
import { useRouter } from 'next/navigation'
import { fuzzyFilter } from '@/lib/fuzzy'
import { SCAN_INTERVAL_MS, SCAN_MAX_DIM } from '@/components/scanner/constants'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isValidWarehouseQr, parseQr } from '@/lib/qr-parser'
import { signOut } from '@/lib/auth-client'

// ── Vendor type ────────────────────────────────────────────────────────────────

export interface BillingVendor {
  id: string
  name: string
  code: string | null   // area
  phone: string | null
  address: string | null
}

// ── Bill line ──────────────────────────────────────────────────────────────────
// Key = artNumber__mrpCents — same article at different MRP → separate line.

interface BillLine {
  key: string       // artNumber__mrpCents
  artNumber: string
  mrp: number
  division: string
  qty: number
  boxCodes: string[]
}

function lineKey(art: string, mrp: number) {
  return `${art}__${Math.round(mrp * 100)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// SearchCombobox — identical to salesman-dashboard
// ─────────────────────────────────────────────────────────────────────────────

interface SearchComboboxProps<T> {
  id?: string
  label: string
  required?: boolean
  placeholder: string
  inputValue: string
  onInputChange: (v: string) => void
  onSelect: (item: T) => void
  onClear: () => void
  results: T[]
  loading: boolean
  renderOption: (item: T, active: boolean) => React.ReactNode
  getKey: (item: T) => string | number
  disabled?: boolean
}

interface SearchComboboxHandle {
  focus: () => void
}

const SearchCombobox = forwardRef(function SearchComboboxInner<T>(
  {
    id, label, required, placeholder, inputValue, onInputChange,
    onSelect, onClear, results, loading, renderOption, getKey, disabled,
  }: SearchComboboxProps<T>,
  ref: React.Ref<SearchComboboxHandle>,
) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  useImperativeHandle(ref, () => ({
    focus: () => { inputRef.current?.focus(); inputRef.current?.select() },
  }))

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  useEffect(() => {
    if (!open || !listRef.current) return
    const activeEl = listRef.current.children[activeIdx] as HTMLElement | undefined
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  useEffect(() => {
    if (results.length > 0) {
      setActiveIdx(0)
      if (listRef.current) listRef.current.scrollTop = 0
    }
  }, [results])

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { setOpen(true); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[activeIdx]
      if (item) { onSelect(item); setOpen(false); inputRef.current?.blur() }
    } else if (e.key === 'Escape') {
      setOpen(false); inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative flex items-center">
        <svg className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && results[activeIdx] ? `${listId}-${activeIdx}` : undefined}
          value={inputValue}
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          onChange={e => { onInputChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        />
        {inputValue && !disabled && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => { onClear(); setOpen(false) }}
            className="absolute right-3 text-muted-foreground hover:text-foreground"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="absolute z-50 top-full mt-1 w-full rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-60 overflow-y-auto"
        >
          {loading && <li className="px-4 py-3 text-sm text-muted-foreground">Searching…</li>}
          {!loading && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">No results found</li>
          )}
          {!loading && results.map((item, i) => (
            <li
              key={getKey(item)}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={e => { e.preventDefault(); onSelect(item); setOpen(false); inputRef.current?.blur() }}
              className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${i === activeIdx ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {renderOption(item, i === activeIdx)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}) as <T>(props: SearchComboboxProps<T> & { ref?: React.Ref<SearchComboboxHandle> }) => React.ReactElement

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  vendors: BillingVendor[]
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function BillingScannerPage({ vendors }: Props) {
  const router = useRouter()

  // Guard: vendors may briefly be undefined during SSR/hydration
  const safeVendors = vendors ?? []

  // ── Vendor search ──────────────────────────────────────────────────────────
  const [skQuery, setSkQuery]               = useState('')
  const [selectedVendor, setSelectedVendor] = useState<BillingVendor | null>(null)

  const skResults = useMemo<BillingVendor[]>(() => {
    if (!skQuery.trim()) return safeVendors.slice(0, 20)
    return fuzzyFilter(
      safeVendors,
      skQuery,
      v => [v.name, v.code, v.phone, v.address],
    ).slice(0, 20)
  }, [skQuery, safeVendors])

  // ── Bill lines ─────────────────────────────────────────────────────────────
  const [billLines, setBillLines] = useState<BillLine[]>([])

  // ── Camera / scan refs ─────────────────────────────────────────────────────
  const videoRef            = useRef<HTMLVideoElement>(null)
  const canvasRef           = useRef<HTMLCanvasElement>(null)
  const scanCanvasRef       = useRef<HTMLCanvasElement | null>(null)
  const streamRef           = useRef<MediaStream | null>(null)
  const flashlightStreamRef = useRef<MediaStream | null>(null)
  const lastScanTimeRef     = useRef<number>(0)
  const scanningRef         = useRef(false)
  const scanPausedRef       = useRef(false)
  const fileInputRef        = useRef<HTMLInputElement>(null)

  const [isCameraActive, setIsCameraActive]     = useState(false)
  const [isFlashlightOn, setIsFlashlightOn]     = useState(false)
  const [qrDetected, setQrDetected]             = useState(false)
  const [uploadProcessing, setUploadProcessing] = useState(false)

  // ── Banners ────────────────────────────────────────────────────────────────
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [warnMsg, setWarnMsg]       = useState<string | null>(null)
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)
  const bannerTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Manual entry ───────────────────────────────────────────────────────────
  const [manualArt, setManualArt] = useState('')
  const [manualMrp, setManualMrp] = useState('')
  const [manualDiv, setManualDiv] = useState('')
  const [manualQty, setManualQty] = useState<number | ''>(1)

  // ── Bill number — timestamp-based (YYMMDDHHmmss), no state needed ─────────

  // ── Delete confirm ─────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      scanningRef.current = false
      if (bannerTimer.current) clearTimeout(bannerTimer.current)
      if (flashlightStreamRef.current) flashlightStreamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [])

  // ── Banner helpers ─────────────────────────────────────────────────────────

  function showSuccess(msg: string) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    setErrorMsg(null); setWarnMsg(null); setSuccessMsg(msg)
    bannerTimer.current = setTimeout(() => setSuccessMsg(null), 3000)
  }
  function showWarning(msg: string) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    setErrorMsg(null); setSuccessMsg(null); setWarnMsg(msg)
    bannerTimer.current = setTimeout(() => setWarnMsg(null), 5000)
  }
  function showError(msg: string) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    setSuccessMsg(null); setWarnMsg(null); setErrorMsg(msg)
  }

  // ── Audio / haptic ─────────────────────────────────────────────────────────

  function triggerFeedback() {
    try {
      const ctx  = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1046, ctx.currentTime)
      gain.gain.setValueAtTime(0.35, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.18)
      osc.onended = () => ctx.close()
    } catch { /* ignore */ }
    try { if (navigator.vibrate) navigator.vibrate(80) } catch { /* ignore */ }
  }

  // ── Bill line management ───────────────────────────────────────────────────

  function addScannedBox(art: string, mrp: number, division: string, rawQr: string) {
    const key = lineKey(art, mrp)
    setBillLines(prev => {
      const existing = prev.find(l => l.key === key)
      if (existing) {
        const boxCode = rawQr.split('-').pop() ?? rawQr
        if (existing.boxCodes.some(c => (c.split('-').pop() ?? c) === boxCode)) {
          showWarning(`Box already scanned: ${art}`)
          return prev
        }
        showSuccess(`+1 box: ${art}`)
        triggerFeedback()
        return prev.map(l => l.key === key
          ? { ...l, qty: l.qty + 1, boxCodes: [...l.boxCodes, rawQr] }
          : l
        )
      }
      showSuccess(`Added: ${art} @ ₹${mrp.toFixed(2)}`)
      triggerFeedback()
      return [...prev, { key, artNumber: art, mrp, division, qty: 1, boxCodes: [rawQr] }]
    })
  }

  function addManualLine(art: string, mrp: number, division: string, qty: number) {
    const key = lineKey(art, mrp)
    setBillLines(prev => {
      const existing = prev.find(l => l.key === key)
      if (existing) return prev.map(l => l.key === key ? { ...l, qty: l.qty + qty } : l)
      return [...prev, { key, artNumber: art, mrp, division, qty, boxCodes: [] }]
    })
    showSuccess(`Added ${qty}× ${art} @ ₹${mrp.toFixed(2)}`)
  }

  function removeLine(key: string) {
    setBillLines(prev => prev.filter(l => l.key !== key))
    setDeleteTarget(null)
  }

  function clearBill() {
    setBillLines([])
    setDeleteTarget(null)
  }

  // ── QR decode → bill ───────────────────────────────────────────────────────

  function handleQrDecode(raw: string) {
    if (!isValidWarehouseQr(raw)) {
      showWarning('QR code format not recognised — only warehouse box QR codes are accepted.')
      return
    }
    const p = parseQr(raw)
    addScannedBox(p.articleCode, p.mrp, p.division, raw)
  }

  // ── Camera helpers ─────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      setErrorMsg(null)
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
      showError('Camera permission denied or unavailable.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopCamera() {
    scanningRef.current = false
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    setIsCameraActive(false)
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
      sc = document.createElement('canvas'); sc.width = sw; sc.height = sh; scanCanvasRef.current = sc
    }
    const sctx = sc.getContext('2d', { willReadFrequently: true })
    if (!sctx) { requestAnimationFrame(() => scanLoop(video)); return }

    sctx.drawImage(video, 0, 0, sw, sh)
    try {
      const imageData = sctx.getImageData(0, 0, sw, sh)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code) {
        scanPausedRef.current = true; setQrDetected(true)
        setTimeout(() => { scanPausedRef.current = false; setQrDetected(false) }, 2000)
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
        if (flashlightStreamRef.current) { flashlightStreamRef.current.getTracks().forEach(t => t.stop()); flashlightStreamRef.current = null }
        showWarning('Flashlight not supported on this device.')
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
    if (!allowed.includes(file.type)) { showError('Invalid image file type.'); if (fileInputRef.current) fileInputRef.current.value = ''; return }
    setUploadProcessing(true)
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close()
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (!code) { showError('No QR code found in image.'); return }
      handleQrDecode(code.data)
    } catch { showError('Could not process image.') }
    finally { setUploadProcessing(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  // ── Manual entry submit ────────────────────────────────────────────────────

  function handleManualAdd(e: React.FormEvent) {
    e.preventDefault()
    const art = manualArt.trim().toUpperCase()
    const mrp = parseFloat(manualMrp) || 0
    const qty = Number(manualQty) || 1
    if (!art) { showError('Article number is required.'); return }
    addManualLine(art, mrp, manualDiv, qty)
    setManualQty(1)
  }

  // ── Group lines by artNumber (for display & print) ─────────────────────────
  const billGroups = useMemo(() => {
    const groups: { artNumber: string; lines: BillLine[] }[] = []
    const seen = new Map<string, BillLine[]>()
    for (const line of billLines) {
      if (!seen.has(line.artNumber)) {
        const g: BillLine[] = []
        seen.set(line.artNumber, g)
        groups.push({ artNumber: line.artNumber, lines: g })
      }
      seen.get(line.artNumber)!.push(line)
    }
    return groups
  }, [billLines])

  // ── Print ──────────────────────────────────────────────────────────────────

  function handlePrint() {
    if (!selectedVendor) { showError('Please select a vendor first.'); return }
    if (billLines.length === 0) { showError('No items scanned yet.'); return }

    // ── Financials ───────────────────────────────────────────────────────────
    const totalQtyP  = billLines.reduce((s, l) => s + l.qty, 0)
    const subTotalP  = billLines.reduce((s, l) => s + Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100)) * l.qty, 0)
    const discAmtP   = Math.round(subTotalP * DISC_PCT / 100 * 100) / 100
    const afterDiscP = subTotalP - discAmtP
    const cgstAmtP   = Math.round(afterDiscP * CGST_PCT / 100 * 100) / 100
    const sgstAmtP   = Math.round(afterDiscP * SGST_PCT / 100 * 100) / 100
    const netAmtP    = Math.round((afterDiscP + cgstAmtP + sgstAmtP) * 100) / 100

    // ── Bill number — derived from current timestamp (YYMMDDHHmmss) ──────────
    const now   = new Date()
    const yy    = String(now.getFullYear()).slice(2)
    const mm0   = String(now.getMonth() + 1).padStart(2, '0')
    const dd0   = String(now.getDate()).padStart(2, '0')
    const hh    = String(now.getHours()).padStart(2, '0')
    const mi    = String(now.getMinutes()).padStart(2, '0')
    const ss    = String(now.getSeconds()).padStart(2, '0')
    const currentBillNo = `${yy}${mm0}${dd0}${hh}${mi}${ss}`

    // ── Date ─────────────────────────────────────────────────────────────────
    const dd   = dd0
    const mm   = mm0
    const yyyy = now.getFullYear()
    const dateStr = `${dd}/${mm}/${yyyy}`

    // ── Amount in words ──────────────────────────────────────────────────────
    function amountInWords(n: number): string {
      const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
      const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
      function words(num: number): string {
        if (num === 0) return ''
        if (num < 20) return ones[num] + ' '
        if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '') + ' '
        if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred ' + words(num % 100)
        if (num < 100000) return words(Math.floor(num / 1000)) + 'Thousand ' + words(num % 1000)
        if (num < 10000000) return words(Math.floor(num / 100000)) + 'Lakh ' + words(num % 100000)
        return words(Math.floor(num / 10000000)) + 'Crore ' + words(num % 10000000)
      }
      const rupees = Math.floor(n)
      const paise  = Math.round((n - rupees) * 100)
      let result = 'Rupees ' + words(rupees).trim()
      if (paise > 0) result += ' and ' + words(paise).trim() + ' Paise'
      return result + ' Only'
    }

    function fmt(n: number) {
      return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    // ── Item rows (with original MRP column) ──────────────────────────────────
    let rowNum = 0
    const rows = billGroups.flatMap(g =>
      g.lines.map((l, li) => {
        rowNum++
        const rate = Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100))
        const amt  = rate * l.qty
        const isFirst = li === 0
        const evenRow = rowNum % 2 === 0
        return `<tr style="background:${evenRow ? '#f9f9f9' : '#ffffff'}">
          <td style="text-align:center;color:#555">${rowNum}</td>
          <td style="font-weight:600">${isFirst ? g.artNumber : ''}</td>
          <td style="text-align:right;color:#666">${l.mrp > 0 ? fmt(l.mrp) : '—'}</td>
          <td style="text-align:center;font-weight:700;font-size:14px">${l.qty}</td>
          <td style="text-align:right;font-weight:600">${fmt(rate)}</td>
          <td style="text-align:right;font-weight:700">${fmt(amt)}</td>
        </tr>`
      })
    ).join('')

    // ── Vendor details ────────────────────────────────────────────────────────
    const vName    = selectedVendor.name
    const vArea    = selectedVendor.code ?? ''
    const vPhone   = selectedVendor.phone ?? ''
    const vAddress = selectedVendor.address ?? ''

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Bill ${currentBillNo} — ${vName}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif;
    font-size: 11.5px; color: #1a1a1a; background: #fff;
    padding: 14px 18px; max-width: 820px; margin: auto;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* ── HEADER ── */
  .header { text-align: center; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 2px solid #1a1a1a; }
  .tagline { font-size: 13px; font-weight: 900; letter-spacing: 2.5px; color: #111; margin-bottom: 8px; }
  .shop-name { font-size: 26px; font-weight: 900; letter-spacing: 2px; line-height: 1.1; color: #0a0a0a; }
  .header-rule { width: 60px; height: 2.5px; background: #1a1a1a; margin: 4px auto 5px; }
  .shop-addr { font-size: 10px; color: #444; line-height: 1.6; }

  /* ── BILL META ── */
  .meta-row {
    display: flex; border: 1px solid #c8c8c8; border-radius: 3px;
    margin-bottom: 10px; overflow: hidden;
  }
  .bill-to { padding: 8px 12px; flex: 1; border-right: 1px solid #c8c8c8; }
  .bill-no-box { padding: 8px 12px; min-width: 190px; background: #fafafa; }
  .meta-label {
    font-size: 8.5px; color: #999; text-transform: uppercase;
    letter-spacing: 0.9px; margin-bottom: 2px; font-weight: 700;
  }
  .meta-name { font-size: 13px; font-weight: 800; color: #0a0a0a; line-height: 1.3; }
  .meta-sub { font-size: 11px; color: #444; margin-top: 2px; line-height: 1.45; }
  .bill-no-val { font-size: 18px; font-weight: 900; color: #0a0a0a; line-height: 1.15; letter-spacing: 0.5px; }
  .bill-date-val { font-size: 12.5px; font-weight: 700; color: #0a0a0a; margin-top: 1px; }

  /* ── ITEMS TABLE ── */
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  thead tr { background: #f0f0f0; }
  th {
    padding: 6px 8px; font-size: 9.5px; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.5px;
    border: 1px solid #c8c8c8; color: #333;
  }
  td { padding: 5px 8px; border: 1px solid #ddd; font-size: 11.5px; color: #1a1a1a; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: 1px solid #c8c8c8; }

  /* ── BOTTOM SECTION ── */
  .bottom { display: flex; gap: 14px; margin-bottom: 10px; align-items: flex-start; }

  /* Bank */
  .bank { flex: 0 0 185px; }
  .bank-title { font-size: 12px; font-weight: 800; color: #0a0a0a; margin-bottom: 5px; }
  .bank-detail { font-size: 11px; line-height: 1.75; color: #333; }
  .bank-detail span.k { display: inline-block; width: 48px; color: #555; }
  .qr-block { margin-top: 7px; }
  .qr-box {
    width: 76px; height: 76px; border: 1px solid #bbb; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; color: #aaa; background: #fafafa;
  }
  .scan-label { font-size: 9.5px; color: #666; margin-top: 3px; }

  /* Summary */
  .summary { flex: 1; border: 1px solid #c8c8c8; border-radius: 3px; overflow: hidden; }
  .s-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 12px; border-bottom: 1px solid #eaeaea; font-size: 11.5px;
  }
  .s-row .s-val { font-weight: 600; }
  .s-row.disc .s-val { color: #c0392b; }
  .s-row.tax .s-label { color: #555; }
  .s-total {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; background: #f5f5f5; border-top: 1.5px solid #bbb;
  }
  .s-total .t-label { font-size: 12px; font-weight: 700; }
  .s-total .t-value { font-size: 20px; font-weight: 900; color: #0a0a0a; }

  /* ── AMOUNT IN WORDS ── */
  .words-box {
    border: 1px solid #c8c8c8; border-radius: 3px;
    padding: 7px 12px; margin-bottom: 10px; background: #fafafa;
  }
  .words-label { font-size: 8.5px; color: #999; text-transform: uppercase; letter-spacing: 0.9px; font-weight: 700; margin-bottom: 3px; }
  .words-text { font-size: 13px; font-weight: 800; color: #0a0a0a; line-height: 1.4; }

  /* ── FOOTER STUB ── */
  .stub {
    border: 1px solid #c8c8c8; border-radius: 3px;
    padding: 8px 12px; margin-bottom: 10px;
    display: flex; gap: 16px; align-items: flex-end;
    background: #fafafa;
  }
  .stub-left { flex: 1; font-size: 11px; line-height: 1.8; color: #222; }
  .stub-left .row { display: flex; gap: 0; flex-wrap: wrap; }
  .stub-left .sk { display: inline-block; width: 64px; font-weight: 700; color: #444; }
  .stub-left .sv { font-weight: 500; }
  .stub-right { text-align: right; font-size: 10.5px; color: #555; }
  .sig-line { border-top: 1px solid #999; width: 120px; margin-left: auto; margin-bottom: 4px; }

  /* ── THANK YOU ── */
  .thankyou {
    text-align: center; font-size: 10.5px; font-weight: 800;
    letter-spacing: 3px; color: #555; padding-top: 8px;
    border-top: 1px solid #c8c8c8; text-transform: uppercase;
  }

  @media print {
    @page { margin: 6mm 8mm; size: A4; }
    body { padding: 0; font-size: 11px; }
  }
</style>
</head><body>

<!-- ═══ HEADER ═══ -->
<div class="header">
  <div class="tagline">!! JAY SHREE SWAMINARAYAN !!</div>
  <div class="shop-name">SHAYONA SHOE PALACE</div>
  <div class="header-rule"></div>
  <div class="shop-addr">
    PLOT NO 16,17, SAHKAR GROUP SOCIETY, OPP HARINAGAR, UDHNA<br>
    GST NO : 24ABEPA6540L1ZV
  </div>
</div>

<!-- ═══ BILL META ═══ -->
<div class="meta-row">
  <div class="bill-to">
    <div class="meta-label">Bill To</div>
    <div class="meta-name">M/s. ${vName}${vPhone ? ' (' + vPhone + ')' : ''}</div>
    ${vArea    ? `<div class="meta-sub">${vArea}</div>`    : ''}
    ${vAddress ? `<div class="meta-sub">${vAddress}</div>` : ''}
    <div class="meta-sub" style="margin-top:5px;color:#888">GSTIN: &nbsp;—</div>
  </div>
  <div class="bill-no-box">
    <div class="meta-label">Bill No.</div>
    <div class="bill-no-val">${currentBillNo}</div>
    <div style="margin-top:8px">
      <div class="meta-label">Date</div>
      <div class="bill-date-val">${dateStr}</div>
    </div>
  </div>
</div>

<!-- ═══ ITEMS TABLE ═══ -->
<table>
  <thead>
    <tr>
      <th style="width:38px;text-align:center">#</th>
      <th style="text-align:left">Description</th>
      <th style="width:100px;text-align:right">MRP (₹)</th>
      <th style="width:60px;text-align:center">QTY</th>
      <th style="width:105px;text-align:right">Rate (₹)</th>
      <th style="width:115px;text-align:right">Amount (₹)</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<!-- ═══ BOTTOM: BANK + SUMMARY ═══ -->
<div class="bottom">
  <div class="bank">
    <div class="bank-title">Bank Details</div>
    <div class="bank-detail">
      <span class="k">Bank</span>: ICICI BANK<br>
      <span class="k">A/c No</span>: 183605003484<br>
      <span class="k">IFSC</span>: ICIC0001836<br>
      <span class="k">Branch</span>: VED ROAD
    </div>
    <div class="qr-block">
      <div class="qr-box">QR Code</div>
      <div class="scan-label">Scan for Payment</div>
    </div>
  </div>
  <div class="summary">
    <div class="s-row"><span class="s-label">Sub Total</span><span class="s-val">${fmt(subTotalP)}</span></div>
    <div class="s-row disc"><span class="s-label">Discount (-) ${DISC_PCT}%</span><span class="s-val">${fmt(discAmtP)}</span></div>
    <div class="s-row tax"><span class="s-label">CGST ${CGST_PCT}%</span><span class="s-val">${fmt(cgstAmtP)}</span></div>
    <div class="s-row tax"><span class="s-label">SGST ${SGST_PCT}%</span><span class="s-val">${fmt(sgstAmtP)}</span></div>
    <div class="s-total">
      <span class="t-label">Total Amount (₹)</span>
      <span class="t-value">${fmt(netAmtP)}</span>
    </div>
  </div>
</div>

<!-- ═══ AMOUNT IN WORDS ═══ -->
<div class="words-box">
  <div class="words-label">Amount in Words</div>
  <div class="words-text">${amountInWords(netAmtP)}</div>
</div>

<!-- ═══ FOOTER STUB ═══ -->
<div class="stub">
  <div class="stub-left">
    <div class="row"><span class="sk">Party</span><span>:&nbsp;</span><span class="sv">${vName}${vPhone ? ' (' + vPhone + ')' : ''}</span></div>
    ${vArea ? `<div class="row"><span class="sk"></span><span>&nbsp;&nbsp;</span><span class="sv">${vArea}</span></div>` : ''}
    <div class="row" style="margin-top:4px">
      <span class="sk">Bill No.</span><span>:&nbsp;</span><span class="sv">${currentBillNo}</span>
      <span style="margin:0 16px;color:#ccc">|</span>
      <span class="sk" style="width:auto">Date</span><span>:&nbsp;</span><span class="sv">${dateStr}</span>
      <span style="margin:0 16px;color:#ccc">|</span>
      <span class="sk" style="width:auto">Amt.</span><span>:&nbsp;</span><span class="sv">${fmt(netAmtP)}</span>
    </div>
    <div class="row"><span class="sk">Pair</span><span>:&nbsp;</span><span class="sv">${totalQtyP}</span></div>
  </div>
  <div class="stub-right">
    <div class="sig-line"></div>
    Receiver Signature
  </div>
</div>

<!-- ═══ THANK YOU ═══ -->
<div class="thankyou">Thank You For Your Business</div>

</body></html>`

    const win = window.open('', '_blank', 'width=860,height=1000')
    if (!win) { showError('Pop-up blocked. Please allow pop-ups for this site.'); return }
    win.document.write(html); win.document.close(); win.focus()
    win.onload = () => win.print()
  }

  // ── Fixed charges ─────────────────────────────────────────────────────────
  const DISC_PCT = 4.75
  const CGST_PCT = 2.50
  const SGST_PCT = 2.50

  // Per-unit column discount — user-configurable via the Bill tab input
  const [lineDiscPct, setLineDiscPct] = useState<number | ''>(30)
  const LINE_DISC_PCT = lineDiscPct === '' ? 30 : Number(lineDiscPct)

  const totalQty   = billLines.reduce((s, l) => s + l.qty, 0)
  // Sub Total uses the discounted rate (same formula as printed invoice)
  const subTotal   = billLines.reduce((s, l) => s + Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100)) * l.qty, 0)
  const discAmt    = Math.round(subTotal * DISC_PCT / 100 * 100) / 100
  const afterDisc  = subTotal - discAmt
  const cgstAmt    = Math.round(afterDisc * CGST_PCT / 100 * 100) / 100
  const sgstAmt    = Math.round(afterDisc * SGST_PCT / 100 * 100) / 100
  const netAmt     = Math.round((afterDisc + cgstAmt + sgstAmt) * 100) / 100

  // ── Banners component ──────────────────────────────────────────────────────
  function Banners() {
    return (
      <>
        {successMsg && <div className="rounded-md bg-green-100 px-3 py-2 text-sm text-green-800 border border-green-300">{successMsg}</div>}
        {warnMsg    && <div className="rounded-md bg-yellow-100 px-3 py-2 text-sm text-yellow-800 border border-yellow-300">{warnMsg}</div>}
        {errorMsg   && <div className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">{errorMsg}</div>}
      </>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Billing Scanner</h1>
          <div className="flex gap-1.5 items-center shrink-0">
            <Button variant="outline" size="sm" className="text-xs px-2 sm:px-3" onClick={() => router.push('/home')}>← Home</Button>
            <Button variant="outline" size="sm" className="text-xs px-2 sm:px-3" onClick={async () => { await signOut(); router.push('/sign-in') }}>Sign Out</Button>
          </div>
        </div>

        {/* ── Vendor — identical card style as salesman dashboard ── */}
        <section aria-labelledby="vendor-heading" className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b border-border rounded-t-2xl">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <h2 id="vendor-heading" className="text-sm font-semibold text-foreground">Vendor</h2>
            </div>
            {selectedVendor && (
              <button type="button" onClick={() => { setSelectedVendor(null); setSkQuery('') }}
                className="text-xs text-primary hover:underline font-medium">
                Change
              </button>
            )}
          </div>
          <div className="p-4">
            {!selectedVendor ? (
              <SearchCombobox<BillingVendor>
                id="vendor-search"
                label="Search Vendor"
                required
                placeholder="Search vendor..."
                inputValue={skQuery}
                onInputChange={setSkQuery}
                onSelect={v => { setSelectedVendor(v); setSkQuery(v.name) }}
                onClear={() => { setSelectedVendor(null); setSkQuery('') }}
                results={skResults}
                loading={false}
                getKey={v => v.id}
                renderOption={(v, active) => (
                  <div className="flex items-center justify-between gap-4">
                    <span className={`font-medium ${active ? 'text-primary-foreground' : 'text-foreground'}`}>{v.name}</span>
                    <span className={`text-xs font-mono ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      {v.code ?? v.address ?? ''}
                    </span>
                  </div>
                )}
              />
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm flex-shrink-0">
                  {selectedVendor.name[0].toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">{selectedVendor.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[selectedVendor.code, selectedVendor.phone, selectedVendor.address].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Tabs ── */}
        <Tabs
          defaultValue="camera"
          className="w-full"
          onValueChange={tab => {
            if (tab === 'camera') { if (!isCameraActive) startCamera() }
            else stopCamera()
          }}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="camera" className="text-xs sm:text-sm">Camera</TabsTrigger>
            <TabsTrigger value="manual" className="text-xs sm:text-sm">Manual</TabsTrigger>
            <TabsTrigger value="bill"   className="text-xs sm:text-sm">
              Bill
              {billLines.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-600 px-1 text-[10px] font-bold text-white">
                  {billLines.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Camera ── */}
          <TabsContent value="camera" className="space-y-4">
            <Card>
              <CardHeader className="px-3 py-3 sm:px-6 sm:py-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm sm:text-base">Scan Box QR Code</CardTitle>
                    <CardDescription className="text-xs mt-0.5">Each scan adds one box to the bill.</CardDescription>
                  </div>
                  {/* Flashlight toggle */}
                  <div className="flex items-center gap-1 rounded-full border px-2 py-1 bg-background shadow-sm shrink-0">
                    <span className="text-[10px] font-medium text-muted-foreground">OFF</span>
                    <button type="button" aria-label="Toggle flashlight" onClick={toggleFlashlight}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isFlashlightOn ? 'bg-green-500' : 'bg-muted'}`}>
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${isFlashlightOn ? 'translate-x-5' : 'translate-x-0.5'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                          stroke={isFlashlightOn ? '#16a34a' : '#9ca3af'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                          <path d="M18 6l-6 6" /><path d="M7 17l1.5-1.5" /><path d="M10.5 20.5l1-1" />
                          <path d="M3.5 14.5l1-1" /><path d="M6 11l-2.5 2.5a4.95 4.95 0 0 0 7 7L13 18" /><path d="M22 2l-7 7" />
                        </svg>
                      </span>
                    </button>
                    <span className={`text-[10px] font-medium ${isFlashlightOn ? 'text-green-600' : 'text-muted-foreground'}`}>ON</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative bg-black rounded-lg overflow-hidden aspect-[4/3] sm:aspect-video">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  {isCameraActive && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className={`absolute inset-0 rounded-lg border-4 transition-colors duration-200 ${qrDetected ? 'border-green-400 animate-pulse' : 'border-white/20'}`} />
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white/70 text-xs font-medium px-3 py-1 rounded-full">
                        Scanning…
                      </div>
                    </div>
                  )}
                  {!isCameraActive && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
                      <p className="text-white/60 text-sm font-medium">Camera not active</p>
                    </div>
                  )}
                  <button type="button" aria-label={isCameraActive ? 'Stop camera' : 'Start camera'}
                    onClick={isCameraActive ? stopCamera : startCamera}
                    className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/75 transition-colors">
                    {isCameraActive ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                        <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    )}
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                <Button variant="outline" className="w-full" disabled={uploadProcessing || isCameraActive}
                  onClick={() => fileInputRef.current?.click()}>
                  {uploadProcessing ? 'Processing…' : 'Upload QR Image'}
                </Button>
                <Banners />
                {billLines.length > 0 && (
                  <div className="rounded-md bg-purple-50 border border-purple-200 px-3 py-2 text-xs text-purple-800">
                    <strong>{billLines.length}</strong> line{billLines.length !== 1 ? 's' : ''} · <strong>{totalQty}</strong> boxes · ₹{subTotal.toFixed(2)}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Manual ── */}
          <TabsContent value="manual" className="space-y-3">
            <Card>
              <CardHeader className="px-4 py-3 sm:px-6 sm:py-4">
                <CardTitle className="text-base">Manual Entry</CardTitle>
                <CardDescription className="text-xs">Add a line item manually without scanning.</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 sm:px-6">
                <form onSubmit={handleManualAdd} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="b-art" className="text-xs">Article No. *</Label>
                    <Input id="b-art" value={manualArt} onChange={e => setManualArt(e.target.value)} placeholder="FL0548L" className="h-8 text-sm" required />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="b-mrp" className="text-xs">MRP (₹)</Label>
                      <Input id="b-mrp" type="number" min="0" step="0.01" value={manualMrp}
                        onChange={e => setManualMrp(e.target.value)} placeholder="0.00" className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="b-qty" className="text-xs">Qty (Boxes)</Label>
                      <Input id="b-qty" type="number" min="1" value={manualQty}
                        onChange={e => setManualQty(e.target.value === '' ? '' : parseInt(e.target.value) || 1)}
                        placeholder="1" className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="b-div" className="text-xs">Division</Label>
                    <select id="b-div" value={manualDiv} onChange={e => setManualDiv(e.target.value)}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      <option value="">—</option>
                      <option value="Flite PU">Flite PU</option>
                      <option value="Flite EVA">Flite EVA</option>
                      <option value="Sparx">Sparx</option>
                      <option value="Bahamas">Bahamas</option>
                    </select>
                  </div>
                  <Banners />
                  <Button type="submit" className="w-full h-9 text-sm">Add to Bill</Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Bill ── */}
          <TabsContent value="bill" className="space-y-4">
            <Card>
              <CardHeader className="px-4 py-3 sm:px-6 sm:py-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      Bill Items
                      {selectedVendor && (
                        <span className="ml-2 text-muted-foreground font-normal text-sm">— {selectedVendor.name}</span>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {billLines.length === 0
                        ? 'No items yet. Scan boxes on the Camera tab.'
                        : `${billLines.length} line${billLines.length !== 1 ? 's' : ''} · ${totalQty} boxes · ₹${subTotal.toFixed(2)}`}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Configurable per-line discount */}
                    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2 py-1">
                      <label htmlFor="line-disc" className="text-[11px] text-muted-foreground whitespace-nowrap">Disc %</label>
                      <input
                        id="line-disc"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        placeholder="30"
                        value={lineDiscPct}
                        onChange={e => setLineDiscPct(e.target.value === '' ? '' : Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                        onBlur={() => { if (lineDiscPct === '') setLineDiscPct(30) }}
                        className="w-14 h-6 rounded border border-input bg-background px-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    {billLines.length > 0 && (
                      <Button size="sm" variant="outline" className="h-8 text-xs text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget('__all__')}>Clear All</Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="px-0 pb-0">
                {billLines.length === 0 ? (
                  <div className="px-4 pb-6 pt-2 text-center text-sm text-muted-foreground">No items scanned yet.</div>
                ) : (
                  <>
                    {/* ── Grouped table ── */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/20">
                            <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground border-r border-border/40 whitespace-nowrap">Article</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground border-r border-border/40 whitespace-nowrap">MRP</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground border-r border-border/40 whitespace-nowrap">Disc {LINE_DISC_PCT}% MRP</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground border-r border-border/40 whitespace-nowrap">Qty</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">Amt</th>
                            <th className="px-3 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {billGroups.map(group =>
                            group.lines.map((line, lineIdx) => (
                              <tr key={line.key} className="border-b border-border/40 hover:bg-primary/5 transition-colors">
                                {/* Article — only on the first row of each group */}
                                <td className="px-4 py-2.5 align-top border-r border-border/40 whitespace-nowrap">
                                  {lineIdx === 0 && (
                                    <span className="font-bold text-xs text-foreground">{group.artNumber}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 align-middle border-r border-border/40 whitespace-nowrap text-xs text-muted-foreground">
                                  ₹{line.mrp.toFixed(2)}
                                </td>
                                <td className="px-3 py-2.5 align-middle border-r border-border/40 whitespace-nowrap text-xs font-medium text-foreground">
                                  ₹{Math.ceil(line.mrp * (1 - LINE_DISC_PCT / 100)).toFixed(2)}
                                </td>
                                <td className="px-3 py-2.5 align-middle border-r border-border/40 text-right">
                                  <span className="font-bold text-sm text-foreground">{line.qty}</span>
                                </td>
                                <td className="px-3 py-2.5 align-middle text-right text-xs text-foreground whitespace-nowrap">
                                  ₹{(Math.ceil(line.mrp * (1 - LINE_DISC_PCT / 100)) * line.qty).toFixed(2)}
                                </td>
                                <td className="px-3 py-2.5 align-middle">
                                  <button type="button" onClick={() => setDeleteTarget(line.key)}
                                    className="text-muted-foreground hover:text-destructive transition-colors" aria-label="Remove line">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                      <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>

                      {/* Totals breakdown */}
                      <div className="border-t divide-y divide-border/40">
                        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
                          <span>Sub Total ({totalQty} boxes)</span>
                          <span>₹{subTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-2 text-xs text-red-600">
                          <span>Discount ({DISC_PCT}%)</span>
                          <span>− ₹{discAmt.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
                          <span>CGST ({CGST_PCT}%)</span>
                          <span>+ ₹{cgstAmt.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
                          <span>SGST ({SGST_PCT}%)</span>
                          <span>+ ₹{sgstAmt.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3 text-sm font-bold bg-muted/30">
                          <span>Net Payable</span>
                          <span>₹{netAmt.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="px-4 pb-4 pt-3">
                      {!selectedVendor && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
                          ⚠ Select a vendor above before printing.
                        </p>
                      )}
                      <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                        onClick={handlePrint} disabled={!selectedVendor}>
                        Generate &amp; Print Bill
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ── Confirm dialog ── */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-xl bg-background border border-border shadow-xl p-6 space-y-4">
              <h3 className="text-base font-semibold">
                {deleteTarget === '__all__' ? 'Clear all items?' : 'Remove this line?'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {deleteTarget === '__all__'
                  ? 'All scanned items will be removed from the bill.'
                  : 'This line item will be removed from the bill.'}
              </p>
              <div className="flex gap-2 pt-1">
                <Button variant="destructive" className="flex-1"
                  onClick={() => deleteTarget === '__all__' ? clearBill() : removeLine(deleteTarget)}>
                  {deleteTarget === '__all__' ? 'Clear All' : 'Remove'}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
