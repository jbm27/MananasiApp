import { formatDisplayDate } from './documentPdfHeader.js'

const STAMP_BLUE = { r: 0, g: 70, b: 160 }

export function drawMananasiStamp(pdf, options) {
  const { x, y, width = 62, height = 28, stampDate } = options
  pdf.setDrawColor(STAMP_BLUE.r, STAMP_BLUE.g, STAMP_BLUE.b)
  pdf.setLineWidth(0.45)
  pdf.rect(x, y, width, height)

  const centerX = x + width / 2
  pdf.setTextColor(STAMP_BLUE.r, STAMP_BLUE.g, STAMP_BLUE.b)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7.5)
  pdf.text('MANANASI FIBRE LTD', centerX, y + 7, { align: 'center' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6.5)
  pdf.text('P.O. Box 14483-00800', centerX, y + 12.5, { align: 'center' })
  pdf.text('NAIROBI - KENYA', centerX, y + 17.5, { align: 'center' })

  const dateText = stampDate ? formatDisplayDate(stampDate) : ''
  pdf.setFontSize(6.5)
  if (dateText) {
    pdf.text(`Date: ${dateText}`, x + 2.5, y + height - 3.5)
  } else {
    pdf.text('Date:........................................', x + 2.5, y + height - 3.5)
  }

  pdf.setTextColor(0, 0, 0)
  pdf.setDrawColor(0, 0, 0)
}

export function isFinalizedCommercialDocument(document) {
  return document?.status === 'finalized' || document?.status === 'confirmed'
}
