import logoPdfAsset from '../LogoPdf.jpg'

export const PDF_MARGIN_MM = 25.4

export const PDF_PAGE_FORMAT = 'a4'
export const PDF_PAGE_WIDTH_MM = 210
export const PDF_PAGE_HEIGHT_MM = 297

let cachedPdfLogo = null

export function formatDisplayDate(isoDate) {
  if (!isoDate) {
    return '—'
  }
  const [year, month, day] = String(isoDate).split('-')
  if (!year || !month || !day) {
    return String(isoDate)
  }
  return `${day}/${month}/${year}`
}

/** Pre-sized JPEG (white background). Embed as-is — never run PNG pixel processing on it. */
export async function loadPdfLogo() {
  if (cachedPdfLogo) {
    return cachedPdfLogo
  }

  const response = await fetch(logoPdfAsset)
  if (!response.ok) {
    throw new Error(`Unable to fetch PDF logo asset (${response.status})`)
  }
  const blob = await response.blob()
  if (blob.type && !blob.type.includes('jpeg') && !blob.type.includes('jpg')) {
    throw new Error(`PDF logo asset must be JPEG, received ${blob.type || 'unknown type'}`)
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise((resolve, reject) => {
      const logoImage = new Image()
      logoImage.onload = () => resolve(logoImage)
      logoImage.onerror = reject
      logoImage.src = objectUrl
    })
    cachedPdfLogo = {
      bytes,
      format: 'JPEG',
      width: image.naturalWidth,
      height: image.naturalHeight,
    }
    return cachedPdfLogo
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function embedLogoInPdf(pdf, logoBox) {
  const logo = await loadPdfLogo()
  if (!logo?.bytes || !logo.width || !logo.height) {
    return
  }

  const logoAspectRatio = logo.width / logo.height
  let logoWidth = logoBox.width
  let logoHeight = logoWidth / logoAspectRatio
  if (logoHeight > logoBox.height) {
    logoHeight = logoBox.height
    logoWidth = logoHeight * logoAspectRatio
  }
  const logoX = logoBox.x + (logoBox.width - logoWidth) / 2
  const logoY = logoBox.y + (logoBox.height - logoHeight) / 2
  pdf.addImage(
    logo.bytes,
    logo.format,
    logoX,
    logoY,
    logoWidth,
    logoHeight,
    undefined,
    'FAST',
  )
}

export function drawPdfField(pdf, options) {
  const {
    labelX,
    valueX,
    valueWidth,
    y,
    lineHeight,
    label,
    value,
    labelBold = true,
  } = options
  const valueLines = pdf.splitTextToSize(String(value ?? ''), valueWidth)
  pdf.setFont('helvetica', labelBold ? 'bold' : 'normal')
  pdf.text(label, labelX, y)
  pdf.setFont('helvetica', 'normal')
  valueLines.forEach((line, index) => {
    pdf.text(line, valueX, y + index * lineHeight)
  })
  return y + Math.max(valueLines.length, 1) * lineHeight
}

export async function drawMananasiCompanyHeader(pdf) {
  const pageWidth = PDF_PAGE_WIDTH_MM
  const left = PDF_MARGIN_MM
  const top = PDF_MARGIN_MM
  const contentWidth = pageWidth - PDF_MARGIN_MM * 2
  const right = left + contentWidth

  try {
    await embedLogoInPdf(pdf, { x: right - 81, y: top, width: 81, height: 51 })
  } catch (error) {
    console.error('Unable to load logo for PDF export:', error)
  }

  pdf.setTextColor(0, 0, 0)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12.5)
  pdf.text('Mananasi Fibre Limited', left, top + 8)

  pdf.setFontSize(9)
  pdf.text('Address:', left, top + 15)
  pdf.setFont('helvetica', 'normal')
  pdf.text('P.O Box 14483', left + 28, top + 15)
  pdf.text('Nairobi 00800', left + 28, top + 19.5)
  pdf.text('Kenya', left + 28, top + 24)

  pdf.setFont('helvetica', 'bold')
  pdf.text('KRA PIN', left, top + 31)
  pdf.setFont('helvetica', 'normal')
  pdf.text('P052141076P', left + 28, top + 31)

  pdf.setFont('helvetica', 'bold')
  pdf.text('Contact', left, top + 38)
  pdf.setFont('helvetica', 'normal')
  pdf.text('info@mananasi-fibre.com', left + 28, top + 38)
  pdf.text('+254717903799', left + 28, top + 42.5)

  return { left, top, right, contentWidth, pageWidth }
}
