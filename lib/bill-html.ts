/**
 * lib/bill-html.ts
 *
 * Single source of truth for the Shayona Shoe Palace invoice HTML.
 * Used by both the Billing Scanner (MRP lines from QR scans) and the
 * Biller Dashboard (MRP lines reconstructed from saved scannedQrs).
 *
 * The format is identical to the original billing-scanner-page.tsx invoice.
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface InvoiceVendor {
  name:    string
  phone?:  string | null
  area?:   string | null   // vendor.code
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

export interface BuildInvoiceOptions {
  vendor:       InvoiceVendor
  order:        InvoiceOrder
  lines:        MrpLine[]
  /** Per-unit column discount %. Default 30. */
  lineDiscPct?: number
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
}: BuildInvoiceOptions): string {

  const LINE_DISC_PCT = lineDiscPct
  const DISC_PCT      = 4.75
  const CGST_PCT      = 2.50
  const SGST_PCT      = 2.50

  // ── Financials ──────────────────────────────────────────────────────────────
  const totalQty  = lines.reduce((s, l) => s + l.qty, 0)
  const subTotal  = lines.reduce((s, l) => s + Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100)) * l.qty, 0)
  const discAmt   = Math.round(subTotal * DISC_PCT / 100 * 100) / 100
  const afterDisc = subTotal - discAmt
  const cgstAmt   = Math.round(afterDisc * CGST_PCT / 100 * 100) / 100
  const sgstAmt   = Math.round(afterDisc * SGST_PCT / 100 * 100) / 100
  const netAmt    = Math.round((afterDisc + cgstAmt + sgstAmt) * 100) / 100

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

  // ── Item rows — group by artNumber so description only shows once ───────────
  // Build grouped map: artNumber → lines[]
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
        <td style="text-align:center;font-weight:700;font-size:14px">${l.qty}</td>
        <td style="text-align:right;font-weight:600">${fmt(rate)}</td>
        <td style="text-align:right;font-weight:700">${fmt(amt)}</td>
      </tr>`
    })
  })

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Bill ${billNo} — ${vName}</title>
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

  /* ── BOTTOM SECTION — 3 columns: bank (1) | qr (1) | summary (2) ── */
  .bottom { display: flex; gap: 0; margin-bottom: 10px; align-items: stretch; border: 1px solid #c8c8c8; border-radius: 4px; overflow: hidden; }

  /* Bank column */
  .bank { flex: 0.9 0.9 0; padding: 12px 14px; border-right: 1px solid #c8c8c8; }
  .bank-title { font-size: 13px; font-weight: 800; color: #0a0a0a; margin-bottom: 10px; }
  .bank-detail { font-size: 11px; line-height: 2; color: #333; }
  .bank-detail .brow { display: flex; gap: 0; }
  .bank-detail .bk { display: inline-block; width: 52px; color: #555; }
  .bank-detail .bsep { margin: 0 6px; color: #999; }

  /* QR column */
  .qr-col { flex: 0.9 0.9 0; padding: 12px 14px; border-right: 1px solid #c8c8c8; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 8px; }
  .qr-col-title { font-size: 13px; font-weight: 800; color: #0a0a0a; }
  .qr-box {
    width: 100px; height: 100px; border: 1px solid #bbb; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; color: #aaa; background: #fafafa;
  }
  .scan-label { font-size: 10px; color: #666; text-align: center; }

  /* Summary column */
  .summary { flex: 2.2 2.2 0; display: flex; flex-direction: column; }
  .summary-title { font-size: 13px; font-weight: 800; color: #0a0a0a; padding: 12px 14px 8px; }
  .s-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 5px 14px; border-top: 1px solid #f0f0f0; font-size: 11.5px; color: #444;
  }
  .s-row .s-val { font-weight: 500; color: #1a1a1a; }
  .s-row.disc .s-val { color: #c0392b; }
  .s-total {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 14px; background: #f5f5f5; border-top: 1.5px solid #bbb; margin-top: auto;
  }
  .s-total .t-label { font-size: 12px; font-weight: 700; color: #0a0a0a; }
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
    <div class="bill-no-val">${billNo}</div>
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

<!-- ═══ BOTTOM: BANK | QR | SUMMARY ═══ -->
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
    <div class="s-row"><span class="s-label">CGST ${CGST_PCT}%</span><span class="s-val">${fmt(cgstAmt)}</span></div>
    <div class="s-row"><span class="s-label">SGST ${SGST_PCT}%</span><span class="s-val">${fmt(sgstAmt)}</span></div>
    <div class="s-total">
      <span class="t-label">Total Amount (INR)</span>
      <span class="t-value">₹${fmt(netAmt)}</span>
    </div>
  </div>
</div>

<!-- ═══ AMOUNT IN WORDS ═══ -->
<div class="words-box">
  <div class="words-label">Amount in Words</div>
  <div class="words-text">${amountInWords(netAmt)}</div>
</div>

<!-- ═══ FOOTER STUB ═══ -->
<div class="stub">
  <div class="stub-left">
    <div class="row"><span class="sk">Party</span><span>:&nbsp;</span><span class="sv">${vName}${vPhone ? ' (' + vPhone + ')' : ''}</span></div>
    ${vArea ? `<div class="row"><span class="sk"></span><span>&nbsp;&nbsp;</span><span class="sv">${vArea}</span></div>` : ''}
    <div class="row" style="margin-top:4px">
      <span class="sk">Bill No.</span><span>:&nbsp;</span><span class="sv">${billNo}</span>
      <span style="margin:0 16px;color:#ccc">|</span>
      <span class="sk" style="width:auto">Date</span><span>:&nbsp;</span><span class="sv">${dateStr}</span>
      <span style="margin:0 16px;color:#ccc">|</span>
      <span class="sk" style="width:auto">Amt.</span><span>:&nbsp;</span><span class="sv">${fmt(netAmt)}</span>
    </div>
    <div class="row"><span class="sk">Pair</span><span>:&nbsp;</span><span class="sv">${totalQty}</span></div>
  </div>
  <div class="stub-right">
    <div class="sig-line"></div>
    Receiver Signature
  </div>
</div>

<!-- ═══ THANK YOU ═══ -->
<div class="thankyou">Thank You For Your Business</div>

</body></html>`
}

// ─── Print helper ─────────────────────────────────────────────────────────────

/**
 * Open a print window for one or more bills.
 * Single bill → full standalone page.
 * Multiple bills → all in one window separated by page-breaks.
 */
export function printInvoices(bills: Array<BuildInvoiceOptions>) {
  if (bills.length === 0) return

  if (bills.length === 1) {
    const html = buildInvoiceHtml(bills[0])
    const win  = window.open('', '_blank', 'width=860,height=1000')
    if (!win) return
    win.document.write(html); win.document.close(); win.focus()
    win.onload = () => win.print()
    return
  }

  // Multi-bill: extract <body> from each, share the CSS from the first
  const firstHtml = buildInvoiceHtml(bills[0])
  const styleMatch = firstHtml.match(/<style>([\s\S]*?)<\/style>/)
  const sharedCss  = styleMatch ? styleMatch[1] : ''

  const pages = bills
    .map(b => {
      const html      = buildInvoiceHtml(b)
      const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/)
      return bodyMatch ? bodyMatch[1] : ''
    })
    .join('\n<div style="page-break-after:always"></div>\n')

  const multiHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bills (${bills.length})</title>
<style>${sharedCss}</style>
</head><body>
${pages}
</body></html>`

  const win = window.open('', '_blank', 'width=860,height=1000')
  if (!win) return
  win.document.write(multiHtml); win.document.close(); win.focus()
  win.onload = () => win.print()
}
