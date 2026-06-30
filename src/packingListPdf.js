import { jsPDF } from 'jspdf'
import {
  PDF_PAGE_FORMAT,
  drawMananasiCompanyHeader,
  drawPdfField,
  formatDisplayDate,
} from './documentPdfHeader.js'
import { drawMananasiStamp, isFinalizedCommercialDocument } from './documentPdfStamp.js'
import { computePackingListTotals } from './packingList.js'

function formatPackingNumber(value, fractionDigits = 0) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

export async function printPackingListPdf(document) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: PDF_PAGE_FORMAT })
  const { left, top, right, contentWidth } = await drawMananasiCompanyHeader(pdf)
  const labelX = left
  const valueX = left + 36
  const valueWidth = contentWidth - 36
  const metaLabelX = left + 92
  const metaValueX = left + 122
  const lineHeight = 5

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('Packing list for:', left, top + 55)
  pdf.setFontSize(9)
  pdf.text('Packing list no:', metaLabelX, top + 55)
  pdf.setFont('helvetica', 'normal')
  pdf.text(String(document.documentNumber), metaValueX, top + 55)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Date:', metaLabelX, top + 62)
  pdf.setFont('helvetica', 'normal')
  pdf.text(formatDisplayDate(document.invoiceDate), metaValueX, top + 62)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Origin', metaLabelX, top + 69)
  pdf.setFont('helvetica', 'normal')
  pdf.text(String(document.origin ?? ''), metaValueX, top + 69)

  pdf.setFont('helvetica', 'bold')
  pdf.text(document.customerName, left, top + 62)
  pdf.setFont('helvetica', 'normal')
  const customerLines = pdf.splitTextToSize(document.customerAddress, 78)
  pdf.text(customerLines, left, top + 68)
  const customerBlockHeight = Math.max(customerLines.length, 1) * lineHeight
  pdf.text(
    `Company registration: ${document.customerRegistration}`,
    left,
    top + 68 + customerBlockHeight + 2,
  )

  const tableTop = top + 88
  const rowH = 7
  const itemCount = document.items.length
  const tableRowCount = itemCount + 2
  const colX = {
    product: left,
    description: left + 18,
    bales: left + 58,
    cbm: left + 78,
    gross: left + 102,
    net: left + 128,
    end: right,
  }

  pdf.setDrawColor(0)
  pdf.setLineWidth(0.5)
  pdf.rect(left, tableTop, contentWidth, rowH * tableRowCount)
  ;[colX.description, colX.bales, colX.cbm, colX.gross, colX.net].forEach((x) => {
    pdf.line(x, tableTop, x, tableTop + rowH * tableRowCount)
  })
  for (let rowIndex = 1; rowIndex < tableRowCount; rowIndex += 1) {
    pdf.line(left, tableTop + rowH * rowIndex, right, tableTop + rowH * rowIndex)
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7.5)
  pdf.text('Product', colX.product + 1, tableTop + 4.8)
  pdf.text('Description', colX.description + 1, tableTop + 4.8)
  pdf.text('Bales/bags', colX.bales + 1, tableTop + 4.8)
  pdf.text('Total CBM', colX.cbm + 1, tableTop + 4.8)
  pdf.text('Gross (kg)', colX.gross + 1, tableTop + 4.8)
  pdf.text('Net (kg)', colX.net + 1, tableTop + 4.8)

  const totals = document.totals ?? computePackingListTotals(document.items)
  pdf.setFont('helvetica', 'normal')
  document.items.forEach((item, index) => {
    const y = tableTop + rowH * (index + 1) + 4.8
    pdf.text(String(item.product), colX.product + 1, y)
    pdf.text(pdf.splitTextToSize(String(item.description), 38)[0] ?? '', colX.description + 1, y)
    pdf.text(formatPackingNumber(item.baleCount), colX.bales + 1, y)
    pdf.text(formatPackingNumber(item.totalCbm, 2), colX.cbm + 1, y)
    pdf.text(formatPackingNumber(item.grossKg), colX.gross + 1, y)
    pdf.text(formatPackingNumber(item.netKg), colX.net + 1, y)
  })

  const totalRowY = tableTop + rowH * (itemCount + 1)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Total', colX.description + 1, totalRowY + 4.8)
  pdf.text(formatPackingNumber(totals.baleCount), colX.bales + 1, totalRowY + 4.8)
  pdf.text(formatPackingNumber(totals.totalCbm, 2), colX.cbm + 1, totalRowY + 4.8)
  pdf.text(formatPackingNumber(totals.grossKg), colX.gross + 1, totalRowY + 4.8)
  pdf.text(formatPackingNumber(totals.netKg), colX.net + 1, totalRowY + 4.8)

  pdf.setFontSize(9)
  let footerY = tableTop + rowH * tableRowCount + 10
  footerY = drawPdfField(pdf, {
    labelX,
    valueX,
    valueWidth,
    y: footerY,
    lineHeight,
    label: 'HS Code',
    value: document.hsCode,
  })
  footerY += 6
  pdf.setFont('helvetica', 'bold')
  pdf.text('Authorised by:', labelX, footerY)
  pdf.setFont('helvetica', 'normal')
  pdf.text('James Boyd-Moss (Director)', valueX, footerY)
  footerY += 10
  pdf.text('Authorised Signature', labelX, footerY)

  if (isFinalizedCommercialDocument(document)) {
    const stampDate = document.finalizedAt?.slice(0, 10) ?? document.invoiceDate
    drawMananasiStamp(pdf, {
      x: right - 64,
      y: footerY - 18,
      width: 62,
      height: 28,
      stampDate,
    })
  }

  pdf.save(`packing-list-${document.documentNumber}.pdf`)
}
