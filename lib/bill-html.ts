/**
 * lib/bill-html.ts
 *
 * Single source of truth for the Shayona Shoe Palace invoice HTML.
 * Supports:
 *   - A4 / A5 page sizes
 *   - city bill (with CGST/SGST) vs outside-city/town bill (with IGST, different layout)
 *   - Fixed header at top, fixed footer at bottom via position:fixed in @media print
 *   - Body padded to avoid overlap; table fills remaining space with blank filler rows
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface InvoiceVendor {
  name:    string
  phone?:  string | null
  area?:   string | null
  address?: string | null
}

export interface InvoiceOrder {
  orderNumber:    string
  billedAt?:      Date | null
}

/** One line in the financial invoice — artNumber + MRP + qty */
export interface MrpLine {
  artNumber: string
  mrp:       number   // rupees, e.g. 499.00
  qty:       number
}

export type PageSize  = 'A4' | 'A5'
export type BillType  = 'city' | 'outside'   // city = within city (CGST+SGST); outside = IGST

export interface BuildInvoiceOptions {
  vendor:       InvoiceVendor
  order:        InvoiceOrder
  lines:        MrpLine[]
  /** Per-unit column discount %. Default 30. */
  lineDiscPct?: number
  pageSize?:    PageSize   // default A4
  billType?:    BillType   // default city
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function amountInWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function words(num: number): string {
    if (num === 0)       return ''
    if (num < 20)        return ones[num] + ' '
    if (num < 100)       return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '') + ' '
    if (num < 1000)      return ones[Math.floor(num / 100)] + ' Hundred ' + words(num % 100)
    if (num < 100000)    return words(Math.floor(num / 1000))    + 'Thousand ' + words(num % 1000)
    if (num < 10000000)  return words(Math.floor(num / 100000))  + 'Lakh '     + words(num % 100000)
    return                      words(Math.floor(num / 10000000)) + 'Crore '    + words(num % 10000000)
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

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildInvoiceHtml({
  vendor,
  order,
  lines,
  lineDiscPct = 30,
  pageSize    = 'A4',
  billType    = 'city',
}: BuildInvoiceOptions): string {

  const LINE_DISC_PCT = lineDiscPct
  const DISC_PCT      = 4.75
  const CGST_PCT      = billType === 'city' ? 2.50 : 0
  const SGST_PCT      = billType === 'city' ? 2.50 : 0
  const IGST_PCT      = billType === 'outside' ? 5.00 : 0

  // ── Financials ──────────────────────────────────────────────────────────────
  const totalQty  = lines.reduce((s, l) => s + l.qty, 0)
  const subTotal  = lines.reduce((s, l) => s + Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100)) * l.qty, 0)
  const discAmt   = Math.round(subTotal * DISC_PCT / 100 * 100) / 100
  const afterDisc = subTotal - discAmt
  const cgstAmt   = Math.round(afterDisc * CGST_PCT / 100 * 100) / 100
  const sgstAmt   = Math.round(afterDisc * SGST_PCT / 100 * 100) / 100
  const igstAmt   = Math.round(afterDisc * IGST_PCT / 100 * 100) / 100
  const netAmt    = Math.round((afterDisc + cgstAmt + sgstAmt + igstAmt) * 100) / 100

  // ── Bill number & date ──────────────────────────────────────────────────────
  const refDate = order.billedAt ? new Date(order.billedAt) : new Date()
  const yy   = String(refDate.getFullYear()).slice(2)
  const mm0  = String(refDate.getMonth() + 1).padStart(2, '0')
  const dd0  = String(refDate.getDate()).padStart(2, '0')
  const hh   = String(refDate.getHours()).padStart(2, '0')
  const mi   = String(refDate.getMinutes()).padStart(2, '0')
  const ss   = String(refDate.getSeconds()).padStart(2, '0')
  const billNo  = `${yy}${mm0}${dd0}${hh}${mi}${ss}`
  const dateStr = `${dd0}/${mm0}/${refDate.getFullYear()}`

  // ── Vendor ──────────────────────────────────────────────────────────────────
  const vName    = vendor.name
  const vPhone   = vendor.phone   ?? ''
  const vArea    = vendor.area    ?? ''
  const vAddress = vendor.address ?? ''

  // ── Font & page sizing ───────────────────────────────────────────────────────
  const isA5       = pageSize === 'A5'
  const baseFontPx = isA5 ? 10 : 11.5

  // ── Row count & height ───────────────────────────────────────────────────────
  // A4: 22 rows × 6.0mm = 132mm  (budget 172mm — fits with 40mm spare for thead+gaps)
  // A5: 15 rows × 5.0mm =  75mm  (budget  99mm — fits with 24mm spare)
  // px = mm × 3.7795 (96dpi); round up to ensure minimum height.
  //   A4: ceil(6.0 × 3.7795) = ceil(22.68) = 23px
  //   A5: ceil(5.0 × 3.7795) = ceil(18.90) = 19px
  const ROW_HEIGHT = isA5 ? 19 : 24   // px
  const MAX_ROWS   = isA5 ? 15 : 22

  // ── Item rows ────────────────────────────────────────────────────────────────
  const artGroupMap = new Map<string, MrpLine[]>()
  for (const l of lines) {
    if (!artGroupMap.has(l.artNumber)) artGroupMap.set(l.artNumber, [])
    artGroupMap.get(l.artNumber)!.push(l)
  }

  let rowNum = 0
  let rows = ''
  artGroupMap.forEach((artLines, artNumber) => {
    artLines.forEach((l, li) => {
      rowNum++
      const rate    = Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100))
      const amt     = rate * l.qty
      const evenRow = rowNum % 2 === 0
      rows += `<tr style="background:${evenRow ? '#f9f9f9' : '#ffffff'}">
        <td style="text-align:center;color:#555">${rowNum}</td>
        <td style="font-weight:600">${li === 0 ? artNumber : ''}</td>
        <td style="text-align:right;color:#666">${l.mrp > 0 ? fmt(l.mrp) : '—'}</td>
        <td style="text-align:center;font-weight:700;font-size:${baseFontPx + 1}px">${l.qty}</td>
        <td style="text-align:right;font-weight:600">${fmt(rate)}</td>
        <td style="text-align:right;font-weight:700">${fmt(amt)}</td>
      </tr>`
    })
  })

  // Filler rows to fill the remaining space
  const fillerCount = Math.max(0, MAX_ROWS - rowNum)
  for (let f = 0; f < fillerCount; f++) {
    const idx     = rowNum + f + 1
    const evenRow = idx % 2 === 0
    rows += `<tr style="background:${evenRow ? '#f9f9f9' : '#ffffff'}">
      <td style="text-align:center;color:#555">${idx}</td>
      <td>&nbsp;</td><td>&nbsp;</td>
      <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
    </tr>`
  }

  // ── Tax summary rows ─────────────────────────────────────────────────────────
  const taxRows = billType === 'city'
    ? `<div class="s-row"><span class="s-label">CGST ${CGST_PCT}%</span><span class="s-val">${fmt(cgstAmt)}</span></div>
       <div class="s-row"><span class="s-label">SGST ${SGST_PCT}%</span><span class="s-val">${fmt(sgstAmt)}</span></div>`
    : `<div class="s-row"><span class="s-label">IGST ${IGST_PCT}%</span><span class="s-val">${fmt(igstAmt)}</span></div>`

  // ── Outside-city header badge ─────────────────────────────────────────────────
  const billTypeLabel = billType === 'outside'
    ? `<div class="bill-type-badge">TAX INVOICE — OUTSIDE CITY / TOWN</div>`
    : ''

  // ── Page sizes ───────────────────────────────────────────────────────────────
  // Margins: A4 6mm/8mm, A5 4mm/5mm
  // header-height / footer-height must match the rendered sizes below exactly.
  // We use generous mm values and let position:fixed do the clamping.
  const pageW  = isA5 ? '148mm' : '210mm'
  const pageH  = isA5 ? '210mm' : '297mm'
  const mTop   = isA5 ? '4mm'   : '6mm'
  const mSide  = isA5 ? '5mm'   : '8mm'
  const mBot   = isA5 ? '4mm'   : '6mm'

  // Spacer heights in px (screen-reliable — mm units in spacers are viewport-relative on screen).
  // Values are measured rendered heights + ~10px buffer.
  //   A4 header: mTop(23) + tagline(20) + shopname(29) + rule(10) + addr(30) + .header-margins(13)
  //             + meta-row(52) + pb(4) = ~181 → use 200px
  //   A4 footer: pt(4) + bottom-panel(105) + mb(5) + words(38) + mb(5) + stub(55) + mb(5)
  //             + thankyou(17) + mBot(23) = ~257 → use 270px
  //   A5 header: mTop(15) + tagline(18) + shopname(27) + rule(10) + addr(26) + margins(13)
  //             + meta-row(45) + pb(4) = ~158 → use 175px
  //   A5 footer: pt(4) + bottom(90) + mb(5) + words(32) + mb(5) + stub(48) + mb(5)
  //             + thankyou(15) + mBot(15) = ~219 → use 235px
  const headerH = isA5 ? '175px' : '200px'
  const footerH = isA5 ? '235px' : '270px'

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Bill ${billNo} — ${vName}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body { height: 100%; background: #fff; }

  body {
    font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif;
    font-size: ${baseFontPx}px;
    color: #1a1a1a;
    background: #fff;
    margin: 0; padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── FIXED HEADER — pinned top in both screen and print ── */
  .page-header {
    position: fixed;
    top: 0; left: 0; right: 0;
    background: #fff;
    padding: ${mTop} ${mSide} 4px;
    z-index: 10;
  }

  /* ── FIXED FOOTER — pinned bottom in both screen and print ── */
  .page-footer {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: #fff;
    padding: 4px ${mSide} ${mBot};
    z-index: 10;
  }

  /*
   * Spacers push body content clear of the fixed panels.
   * Heights must be >= rendered height of .page-header / .page-footer.
   * These are plain block elements — reliable in both screen and print.
   */
  .header-spacer { height: ${headerH}; display: block; }
  .footer-spacer { height: ${footerH}; display: block; }

  /* ── BODY CONTENT ── */
  .page-body {
    padding: 0 ${mSide};
  }

  /* ── HEADER INNER ── */
  .header { text-align: center; padding-bottom: 6px; border-bottom: 2px solid #1a1a1a; margin-bottom: 5px; }
  .tagline { font-size: ${baseFontPx + 1.5}px; font-weight: 900; letter-spacing: 2.5px; color: #111; margin-bottom: 4px; }
  .shop-name { font-size: ${baseFontPx + 14.5}px; font-weight: 900; letter-spacing: 2px; line-height: 1.1; color: #0a0a0a; }
  .header-rule { width: 60px; height: 2.5px; background: #1a1a1a; margin: 3px auto 4px; }
  .shop-addr { font-size: ${baseFontPx - 1.5}px; color: #444; line-height: 1.5; }
  .bill-type-badge {
    display: inline-block; margin-top: 4px;
    font-size: ${baseFontPx - 1}px; font-weight: 800; letter-spacing: 1.5px;
    color: #fff; background: #1a1a1a; padding: 2px 10px; border-radius: 2px;
    text-transform: uppercase;
  }

  /* ── BILL META ── */
  .meta-row {
    display: flex; border: 1px solid #c8c8c8; border-radius: 3px;
    margin-bottom: 0; overflow: hidden;
  }
  .bill-to { padding: 5px 10px; flex: 1; border-right: 1px solid #c8c8c8; }
  .bill-no-box { padding: 5px 10px; min-width: ${isA5 ? '140px' : '175px'}; background: #fafafa; }
  .meta-label {
    font-size: ${baseFontPx - 3}px; color: #999; text-transform: uppercase;
    letter-spacing: 0.9px; margin-bottom: 1px; font-weight: 700;
  }
  .meta-name { font-size: ${baseFontPx + 1.5}px; font-weight: 800; color: #0a0a0a; line-height: 1.25; }
  .meta-sub { font-size: ${baseFontPx - 0.5}px; color: #444; margin-top: 1px; line-height: 1.4; }
  .bill-no-val { font-size: ${baseFontPx + 6}px; font-weight: 900; color: #0a0a0a; line-height: 1.1; letter-spacing: 0.5px; }
  .bill-date-val { font-size: ${baseFontPx + 1}px; font-weight: 700; color: #0a0a0a; margin-top: 1px; }

  /* ── ITEMS TABLE ── */
  table { width: 100%; border-collapse: collapse; margin-top: ${isA5 ? '4px' : '6px'}; }
  thead tr { background: #f0f0f0; }
  th {
    padding: 4px 7px; font-size: ${baseFontPx - 2}px; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.5px;
    border: 1px solid #c8c8c8; color: #333;
  }
  td {
    padding: 0 7px; border: 1px solid #ddd;
    font-size: ${baseFontPx}px; line-height: 1.3;
    color: #1a1a1a; vertical-align: middle;
    height: ${ROW_HEIGHT}px;
  }
  tbody tr:last-child td { border-bottom: 1px solid #c8c8c8; }

  /* ── BOTTOM SECTION ── */
  .bottom { display: flex; gap: 0; margin-bottom: 5px; align-items: stretch; border: 1px solid #c8c8c8; border-radius: 4px; overflow: hidden; }

  /* Bank column */
  .bank { flex: 0.9 0.9 0; padding: 8px 10px; border-right: 1px solid #c8c8c8; }
  .bank-title { font-size: ${baseFontPx + 1.5}px; font-weight: 800; color: #0a0a0a; margin-bottom: 5px; }
  .bank-detail { font-size: ${baseFontPx - 0.5}px; line-height: 1.75; color: #333; }
  .bank-detail .brow { display: flex; gap: 0; }
  .bank-detail .bk { display: inline-block; width: 52px; color: #555; }
  .bank-detail .bsep { margin: 0 5px; color: #999; }

  /* QR column */
  .qr-col { flex: 0.9 0.9 0; padding: 8px 10px; border-right: 1px solid #c8c8c8; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 5px; }
  .qr-col-title { font-size: ${baseFontPx + 1.5}px; font-weight: 800; color: #0a0a0a; }
  .qr-box {
    width: ${isA5 ? '72px' : '88px'}; height: ${isA5 ? '72px' : '88px'};
    border: 1px solid #bbb; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; color: #aaa; background: #fafafa;
  }
  .scan-label { font-size: ${baseFontPx - 1.5}px; color: #666; text-align: center; }

  /* Summary column */
  .summary { flex: 2.2 2.2 0; display: flex; flex-direction: column; }
  .summary-title { font-size: ${baseFontPx + 1.5}px; font-weight: 800; color: #0a0a0a; padding: 8px 10px 5px; }
  .s-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 3px 10px; border-top: 1px solid #f0f0f0; font-size: ${baseFontPx}px; color: #444;
  }
  .s-row .s-val { font-weight: 500; color: #1a1a1a; }
  .s-row.disc .s-val { color: #c0392b; }
  .s-total {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 10px; background: #f5f5f5; border-top: 1.5px solid #bbb; margin-top: auto;
  }
  .s-total .t-label { font-size: ${baseFontPx + 0.5}px; font-weight: 700; color: #0a0a0a; }
  .s-total .t-value { font-size: ${baseFontPx + 8}px; font-weight: 900; color: #0a0a0a; }

  /* ── AMOUNT IN WORDS ── */
  .words-box {
    border: 1px solid #c8c8c8; border-radius: 3px;
    padding: 4px 10px; margin-bottom: 5px; background: #fafafa;
  }
  .words-label { font-size: ${baseFontPx - 3}px; color: #999; text-transform: uppercase; letter-spacing: 0.9px; font-weight: 700; margin-bottom: 2px; }
  .words-text { font-size: ${baseFontPx + 1.5}px; font-weight: 800; color: #0a0a0a; line-height: 1.35; }

  /* ── FOOTER STUB ── */
  .stub {
    border: 1px solid #c8c8c8; border-radius: 3px;
    padding: 5px 10px; margin-bottom: 5px;
    display: flex; gap: 12px; align-items: flex-end;
    background: #fafafa;
  }
  .stub-left { flex: 1; font-size: ${baseFontPx - 0.5}px; line-height: 1.65; color: #222; }
  .stub-left .row { display: flex; gap: 0; flex-wrap: wrap; }
  .stub-left .sk { display: inline-block; width: 64px; font-weight: 700; color: #444; }
  .stub-left .sv { font-weight: 500; }
  .stub-right { text-align: right; font-size: ${baseFontPx - 1}px; color: #555; }
  .sig-line { border-top: 1px solid #999; width: 110px; margin-left: auto; margin-bottom: 3px; }

  /* ── OUTSIDE-CITY EXTRA: transport / state details strip ── */
  .transport-strip {
    border: 1px solid #c8c8c8; border-radius: 3px;
    padding: 4px 10px; margin-bottom: 5px; background: #fafafa;
    display: flex; gap: 20px; flex-wrap: wrap;
  }
  .ts-col { flex: 1; min-width: 90px; }
  .ts-label { font-size: ${baseFontPx - 3}px; color: #999; text-transform: uppercase; letter-spacing: 0.9px; font-weight: 700; margin-bottom: 1px; }
  .ts-val { font-size: ${baseFontPx}px; font-weight: 600; color: #0a0a0a; min-height: 14px; border-bottom: 1px solid #ddd; padding-bottom: 2px; }

  /* ── THANK YOU ── */
  .thankyou {
    text-align: center; font-size: ${baseFontPx - 1}px; font-weight: 800;
    letter-spacing: 3px; color: #555; padding-top: 6px;
    border-top: 1px solid #c8c8c8; text-transform: uppercase;
  }

  /* ── PRINT-SPECIFIC ── */
  @media print {
    @page {
      size: ${pageW} ${pageH};
      margin: ${mTop} ${mSide} ${mBot};
    }
    html, body { height: 100%; }
    .page-header, .page-footer { position: fixed; }
  }

  /* ── SCREEN PREVIEW: constrain width to match print output ── */
  @media screen {
    body { max-width: ${isA5 ? '148mm' : '210mm'}; margin: 0 auto; }
  }
</style>
</head><body>

<!-- ═══ FIXED HEADER ═══ -->
<div class="page-header">
  <div class="header">
    <div class="tagline">!! JAY SHREE SWAMINARAYAN !!</div>
    <div class="shop-name">SHAYONA SHOE PALACE</div>
    <div class="header-rule"></div>
    <div class="shop-addr">
      PLOT NO 16,17, SAHKAR GROUP SOCIETY, OPP HARINAGAR, UDHNA<br>
      GST NO : 24ABEPA6540L1ZV
    </div>
    ${billTypeLabel}
  </div>
  <div class="meta-row">
    <div class="bill-to">
      <div class="meta-label">Bill To</div>
      <div class="meta-name">M/s. ${vName}${vPhone ? ' (' + vPhone + ')' : ''}</div>
      ${vArea    ? `<div class="meta-sub">${vArea}</div>`    : ''}
      ${vAddress ? `<div class="meta-sub">${vAddress}</div>` : ''}
      <div class="meta-sub" style="margin-top:3px;color:#888">GSTIN: &nbsp;—</div>
    </div>
    <div class="bill-no-box">
      <div class="meta-label">Bill No.</div>
      <div class="bill-no-val">${billNo}</div>
      <div style="margin-top:4px">
        <div class="meta-label">Date</div>
        <div class="bill-date-val">${dateStr}</div>
      </div>
    </div>
  </div>
</div>
<!-- END FIXED HEADER -->

<!-- Spacer: pushes body content below the fixed header -->
<div class="header-spacer"></div>

<!-- ═══ BODY — items table ═══ -->
<div class="page-body">
  <table>
    <thead>
      <tr>
        <th style="width:${isA5 ? '30px' : '38px'};text-align:center">#</th>
        <th style="text-align:left">Description</th>
        <th style="width:${isA5 ? '76px' : '100px'};text-align:right">MRP (₹)</th>
        <th style="width:${isA5 ? '46px' : '60px'};text-align:center">QTY</th>
        <th style="width:${isA5 ? '82px' : '105px'};text-align:right">Rate (₹)</th>
        <th style="width:${isA5 ? '88px' : '115px'};text-align:right">Amount (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  ${billType === 'outside' ? `
  <div class="transport-strip">
    <div class="ts-col"><div class="ts-label">Transport</div><div class="ts-val">&nbsp;</div></div>
    <div class="ts-col"><div class="ts-label">Vehicle No.</div><div class="ts-val">&nbsp;</div></div>
    <div class="ts-col"><div class="ts-label">Destination State</div><div class="ts-val">&nbsp;</div></div>
    <div class="ts-col"><div class="ts-label">E-Way Bill No.</div><div class="ts-val">&nbsp;</div></div>
  </div>
  ` : ''}
</div>
<!-- END BODY -->

<!-- Spacer: pushes body content above the fixed footer -->
<div class="footer-spacer"></div>

<!-- ═══ FIXED FOOTER ═══ -->
<div class="page-footer">
  <div class="bottom">
    <div class="bank">
      <div class="bank-title">Bank Details</div>
      <div class="bank-detail">
        <div class="brow"><span class="bk">Bank</span><span class="bsep">:</span>ICICI BANK</div>
        <div class="brow"><span class="bk">A/C No.</span><span class="bsep">:</span>183605003484</div>
        <div class="brow"><span class="bk">IFSC</span><span class="bsep">:</span>ICIC0001836</div>
        <div class="brow"><span class="bk">Branch</span><span class="bsep">:</span>VED ROAD</div>
      </div>
    </div>
    <div class="qr-col">
      <div class="qr-col-title">Scan for Payment</div>
      <div class="qr-box">QR Code</div>
      <div class="scan-label">Scan &amp; Pay</div>
    </div>
    <div class="summary">
      <div class="summary-title">Summary</div>
      <div class="s-row"><span class="s-label">Sub Total</span><span class="s-val">${fmt(subTotal)}</span></div>
      <div class="s-row disc"><span class="s-label">Discount (-) ${DISC_PCT}%</span><span class="s-val">${fmt(discAmt)}</span></div>
      ${taxRows}
      <div class="s-total">
        <span class="t-label">Total Amount (INR)</span>
        <span class="t-value">₹${fmt(netAmt)}</span>
      </div>
    </div>
  </div>

  <div class="words-box">
    <div class="words-label">Amount in Words</div>
    <div class="words-text">${amountInWords(netAmt)}</div>
  </div>

  <div class="stub">
    <div class="stub-left">
      <div class="row"><span class="sk">Party</span><span>:&nbsp;</span><span class="sv">${vName}${vPhone ? ' (' + vPhone + ')' : ''}</span></div>
      ${vArea ? `<div class="row"><span class="sk"></span><span>&nbsp;&nbsp;</span><span class="sv">${vArea}</span></div>` : ''}
      <div class="row" style="margin-top:2px">
        <span class="sk">Bill No.</span><span>:&nbsp;</span><span class="sv">${billNo}</span>
        <span style="margin:0 12px;color:#ccc">|</span>
        <span class="sk" style="width:auto">Date</span><span>:&nbsp;</span><span class="sv">${dateStr}</span>
        <span style="margin:0 12px;color:#ccc">|</span>
        <span class="sk" style="width:auto">Amt.</span><span>:&nbsp;</span><span class="sv">${fmt(netAmt)}</span>
      </div>
      <div class="row"><span class="sk">Pair</span><span>:&nbsp;</span><span class="sv">${totalQty}</span></div>
    </div>
    <div class="stub-right">
      <div class="sig-line"></div>
      Receiver Signature
    </div>
  </div>

  <div class="thankyou">Thank You For Your Business</div>
</div>
<!-- END FIXED FOOTER -->

</body></html>`
}

// ─── Print helper ─────────────────────────────────────────────────────────────

export interface PrintConfig {
  pageSize: PageSize
  billType: BillType
}

/**
 * Open a print window for one or more bills.
 */
export function printInvoices(bills: Array<BuildInvoiceOptions>, config?: PrintConfig) {
  if (bills.length === 0) return

  const billsWithConfig = bills.map(b => ({
    ...b,
    pageSize: config?.pageSize ?? b.pageSize ?? 'A4',
    billType: config?.billType ?? b.billType ?? 'city',
  }))

  if (billsWithConfig.length === 1) {
    const html = buildInvoiceHtml(billsWithConfig[0])
    const win  = window.open('', '_blank', 'width=860,height=1000')
    if (!win) return
    win.document.write(html); win.document.close(); win.focus()
    win.onload = () => win.print()
    return
  }

  // Multi-bill: each bill gets its own isolated HTML so fixed positions don't bleed across pages
  const allHtml = billsWithConfig
    .map(b => buildInvoiceHtml(b))
    .join('\n<!-- PAGE BREAK -->\n')

  // For multi-bill we use an iframe approach: open each in its own page with page-break-after
  const firstHtml  = buildInvoiceHtml(billsWithConfig[0])
  const styleMatch = firstHtml.match(/<style>([\s\S]*?)<\/style>/)
  const sharedCss  = styleMatch ? styleMatch[1] : ''

  const pages = billsWithConfig
    .map(b => {
      const html      = buildInvoiceHtml(b)
      const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/)
      return bodyMatch
        ? `<div style="page-break-after:always;position:relative;">${bodyMatch[1]}</div>`
        : ''
    })
    .join('\n')

  const multiHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bills (${billsWithConfig.length})</title>
<style>${sharedCss}</style>
</head><body style="padding:0;margin:0;">
${pages}
</body></html>`

  const win = window.open('', '_blank', 'width=860,height=1000')
  if (!win) return
  win.document.write(multiHtml); win.document.close(); win.focus()
  win.onload = () => win.print()
}
