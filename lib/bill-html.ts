/**
 * lib/bill-html.ts
 *
 * Single source of truth for the Shayona Shoe Palace invoice HTML.
 * Supports:
 *   - A4 / A5 page sizes
 *   - city bill (with CGST/SGST) vs outside-city/town bill (with IGST, different layout)
 *   - Fixed header at top, fixed footer at bottom via position:fixed in @media print
 *   - Body padded to avoid overlap; table fills remaining space with blank filler rows
 *   - Multi-page support: if items exceed MAX_ROWS, overflow pages show
 *     "Continued on next page…" instead of footer; last page shows full footer
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface InvoiceVendor {
  name:      string
  nameHindi?: string | null
  phone?:    string | null
  area?:     string | null
  address?:  string | null
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
  const vName      = vendor.name
  const vNameHindi = vendor.nameHindi ?? ''
  const vPhone     = vendor.phone     ?? ''
  const vArea      = vendor.area      ?? ''
  const vAddress   = vendor.address   ?? ''

  // ── Font & page sizing ───────────────────────────────────────────────────────
  const isA5       = pageSize === 'A5'
  const baseFontPx = isA5 ? 10 : 11.5

  const ROW_HEIGHT    = isA5 ? 19 : 24
  const MAX_ROWS_LAST = isA5 ? 17 : 24

  // ── Flatten all lines into sequential rows ────────────────────────────────────
  const artGroupMap = new Map<string, MrpLine[]>()
  for (const l of lines) {
    if (!artGroupMap.has(l.artNumber)) artGroupMap.set(l.artNumber, [])
    artGroupMap.get(l.artNumber)!.push(l)
  }

  interface FlatRow { rowNum: number; artNumber: string; showArt: boolean; l: MrpLine }
  const flatRows: FlatRow[] = []
  let globalRowNum = 0
  artGroupMap.forEach((artLines, artNumber) => {
    artLines.forEach((l, li) => {
      globalRowNum++
      flatRows.push({ rowNum: globalRowNum, artNumber, showArt: li === 0, l })
    })
  })

  const chunks: FlatRow[][] = []
  let pos = 0
  while (pos < Math.max(flatRows.length, 1)) {
    const slice = flatRows.slice(pos, pos + MAX_ROWS_LAST)
    chunks.push(slice)
    pos += slice.length || 1
    if (pos >= flatRows.length) break
  }
  const totalPages = chunks.length

  function buildTbody(chunk: FlatRow[], isLastPage: boolean): string {
    let html = ''
    chunk.forEach(({ rowNum, showArt, artNumber, l }) => {
      const rate    = Math.ceil(l.mrp * (1 - LINE_DISC_PCT / 100))
      const amt     = rate * l.qty
      const evenRow = rowNum % 2 === 0
      html += `<tr style="background:${evenRow ? '#f9f9f9' : '#ffffff'}">
        <td style="text-align:center;color:#555">${rowNum}</td>
        <td style="font-weight:600">${showArt ? artNumber : ''}</td>
        <td style="text-align:right;color:#666">${l.mrp > 0 ? fmt(l.mrp) : '—'}</td>
        <td style="text-align:center;font-weight:700;font-size:${baseFontPx + 1}px">${l.qty}</td>
        <td style="text-align:right;font-weight:600">${fmt(rate)}</td>
        <td style="text-align:right;font-weight:700">${fmt(amt)}</td>
      </tr>`
    })
    if (isLastPage) {
      const fillerCount = Math.max(0, MAX_ROWS_LAST - chunk.length)
      const fillerStart = chunk.length > 0 ? chunk[chunk.length - 1].rowNum : 0
      for (let f = 0; f < fillerCount; f++) {
        const idx     = fillerStart + f + 1
        const evenRow = idx % 2 === 0
        html += `<tr style="background:${evenRow ? '#f9f9f9' : '#ffffff'}">
          <td style="text-align:center;color:#555">${idx}</td>
          <td>&nbsp;</td><td>&nbsp;</td>
          <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
        </tr>`
      }
    }
    return html
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

  // ── Page dimensions & spacers ────────────────────────────────────────────────
  const pageW  = isA5 ? '148mm' : '210mm'
  const pageH  = isA5 ? '210mm' : '297mm'
  const mTop   = isA5 ? '4mm'   : '6mm'
  const mSide  = isA5 ? '5mm'   : '8mm'
  const mBot   = isA5 ? '4mm'   : '6mm'

  // ── Shared CSS ───────────────────────────────────────────────────────────────
  // Layout strategy: each .bill-page is a flex column exactly one page tall.
  // Header and footer are the first/last flex children (flex-shrink:0).
  // The table section is flex:1 so it fills all remaining space between them.
  // This avoids position:fixed conflicts when multiple .bill-page divs coexist.
  const pageHeightCss = isA5 ? '210mm' : '297mm'
  const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    background: #fff;
    margin: 0; padding: 0;
  }

  body {
    font-family: 'Arial', 'Helvetica Neue', Helvetica, sans-serif;
    font-size: ${baseFontPx}px;
    color: #1a1a1a;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /*
   * Each .bill-page is one physical page:
   *   - exact page height so content never overflows
   *   - flex column: header (shrink-0) | body (flex-1) | footer (shrink-0)
   */
  .bill-page {
    display: flex;
    flex-direction: column;
    height: ${pageHeightCss};
    overflow: hidden;
    padding: ${mTop} ${mSide} ${mBot};
    page-break-after: always;
  }
  .bill-page:last-child { page-break-after: avoid; }

  /* ── PAGE HEADER — fixed top section of each page ── */
  .page-header {
    flex-shrink: 0;
    padding-bottom: ${isA5 ? '2px' : '4px'};
  }

  /* ── PAGE MIDDLE — grows to fill space between header and footer ── */
  .page-body {
    flex: 1 1 0;
    overflow: hidden;
    min-height: 0;
  }

  /* ── PAGE FOOTER — full footer (last page) ── */
  .page-footer {
    flex-shrink: 0;
    padding-top: 4px;
  }

  /* ── PAGE FOOTER — "Continued" notice (non-last pages) ── */
  .page-footer-cont {
    flex-shrink: 0;
    padding-top: 8px;
    border-top: 1.5px solid #c8c8c8;
    text-align: center;
    font-size: ${baseFontPx + 0.5}px;
    font-weight: 700;
    color: #555;
    letter-spacing: 0.5px;
  }

  /* ── SCREEN PREVIEW ── */
  @media screen {
    .bill-page { border: 1px solid #e0e0e0; margin: 0 auto 16px; }
  }

  /* ── HEADER INNER ── */
  .header { text-align: center; padding-bottom: 6px; border-bottom: 2px solid #1a1a1a; margin-bottom: ${isA5 ? '3px' : '5px'}; }
  .tagline { font-size: ${baseFontPx + 0.5}px; font-weight: 900; letter-spacing: 2.5px; color: #111; margin-bottom: 4px; }
  .shop-name { font-size: ${baseFontPx + 13.5}px; font-weight: 900; letter-spacing: 2px; line-height: 1.1; color: #0a0a0a; }
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
  table { width: 100%; border-collapse: collapse; margin-top: ${isA5 ? '3px' : '6px'}; }
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

  @media print {
    @page {
      size: ${pageW} ${pageH};
      margin: 0;
    }
    html, body { margin: 0; padding: 0; }
  }`

  // ── Shared header HTML (identical on every page) ──────────────────────────────
  const headerHtml = `
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
      <div class="meta-name">M/s. ${vName}${vNameHindi ? ' (' + vNameHindi + ')' : ''}${vPhone ? ' (' + vPhone + ')' : ''}</div>
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
</div>`

  // ── Table column headers ──────────────────────────────────────────────────────
  const theadHtml = `<thead>
      <tr>
        <th style="width:${isA5 ? '30px' : '38px'};text-align:center">#</th>
        <th style="text-align:left">Description</th>
        <th style="width:${isA5 ? '76px' : '100px'};text-align:right">MRP (₹)</th>
        <th style="width:${isA5 ? '46px' : '60px'};text-align:center">QTY</th>
        <th style="width:${isA5 ? '82px' : '105px'};text-align:right">Rate (₹)</th>
        <th style="width:${isA5 ? '88px' : '115px'};text-align:right">Amount (₹)</th>
      </tr>
    </thead>`

  // ── Full footer (last page only) ──────────────────────────────────────────────
  const fullFooterHtml = `
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
</div>`

  // ── "Continued" footer (non-last pages) ──────────────────────────────────────
  const contFooterHtml = `
<div class="page-footer-cont">
  Continued on next page&hellip;
</div>`

  // ── Build each page block ─────────────────────────────────────────────────────
  const pageBlocks = chunks.map((chunk, pageIdx) => {
    const isLastPage = pageIdx === totalPages - 1

    // Transport strip only on the last page for outside-city bills
    const transportStrip = (isLastPage && billType === 'outside') ? `
  <div class="transport-strip">
    <div class="ts-col"><div class="ts-label">Transport</div><div class="ts-val">&nbsp;</div></div>
    <div class="ts-col"><div class="ts-label">Vehicle No.</div><div class="ts-val">&nbsp;</div></div>
    <div class="ts-col"><div class="ts-label">Destination State</div><div class="ts-val">&nbsp;</div></div>
    <div class="ts-col"><div class="ts-label">E-Way Bill No.</div><div class="ts-val">&nbsp;</div></div>
  </div>` : ''

    return `<div class="bill-page">
  ${headerHtml}
  <div class="page-body">
    <table>${theadHtml}
      <tbody>${buildTbody(chunk, isLastPage)}</tbody>
    </table>${transportStrip}
  </div>
  ${isLastPage ? fullFooterHtml : contFooterHtml}
</div>`
  })

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Bill ${billNo} — ${vName}</title>
<style>${css}</style>
</head><body>
${pageBlocks.join('\n')}
</body></html>`
}

// ─── Print helper ─────────────────────────────────────────────────────────────

export interface PrintConfig {
  pageSize: PageSize
  billType: BillType
}

/**
 * Transliterate a single English name to Hindi script using Google Input Tools.
 * Returns the Hindi string, or null if the request fails.
 */
async function transliterateToHindi(name: string): Promise<string | null> {
  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(name)}&itc=hi-t-i0-und&num=1`
    const res  = await fetch(url)
    if (!res.ok) return null
    // Response shape: ["SUCCESS", [["<input>", ["<hindi>"], [], {...}]]]
    const data = await res.json() as [string, Array<[string, string[]]>]
    if (data[0] !== 'SUCCESS') return null
    return data[1]?.[0]?.[1]?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Open a print window for one or more bills.
 * Fetches Hindi transliterations for all vendor names before opening the window.
 */
export async function printInvoices(bills: Array<BuildInvoiceOptions>, config?: PrintConfig) {
  if (bills.length === 0) return

  // Deduplicate vendor names and fetch Hindi transliterations in parallel
  const uniqueNames = [...new Set(bills.map(b => b.vendor.name))]
  const hindiResults = await Promise.all(uniqueNames.map(n => transliterateToHindi(n)))
  const hindiMap = new Map(uniqueNames.map((n, i) => [n, hindiResults[i]]))

  const billsWithConfig = bills.map(b => ({
    ...b,
    pageSize:  config?.pageSize ?? b.pageSize ?? 'A4',
    billType:  config?.billType ?? b.billType ?? 'city',
    vendor: {
      ...b.vendor,
      nameHindi: b.vendor.nameHindi ?? hindiMap.get(b.vendor.name) ?? null,
    },
  }))

  function openWindow(html: string) {
    const win = window.open('', '_blank', 'width=860,height=1000')
    if (!win) return
    win.document.write(html); win.document.close(); win.focus()
    win.onload = () => win.print()
  }

  if (billsWithConfig.length === 1) {
    openWindow(buildInvoiceHtml(billsWithConfig[0]))
    return
  }

  // Multi-bill: combine all page blocks into one document
  const combined = billsWithConfig.map(b => {
    const html      = buildInvoiceHtml(b)
    const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/)
    return bodyMatch ? bodyMatch[1].trim() : ''
  }).join('\n')

  const firstHtml  = buildInvoiceHtml(billsWithConfig[0])
  const styleMatch = firstHtml.match(/<style>([\s\S]*?)<\/style>/)
  const sharedCss  = styleMatch ? styleMatch[1] : ''

  openWindow(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bills (${billsWithConfig.length})</title>
<style>${sharedCss}</style>
</head><body>
${combined}
</body></html>`)
}
