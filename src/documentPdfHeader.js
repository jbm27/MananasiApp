export const PDF_MARGIN_MM = 25.4

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

/** Same logo treatment as invoice PDFs: solid black MANANASI text, enhanced gold FIBRE LTD. */
export function prepareLogoForPdf(sourceImage) {
  const width = sourceImage.naturalWidth
  const height = sourceImage.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.drawImage(sourceImage, 0, 0)
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData
  const fibreRegionStartY = Math.floor(height * 0.62)
  const goldMask = new Uint8Array(width * height)

  function isGoldPixel(r, g, b) {
    return r > 95 && g > 70 && b < 130 && r >= g && g >= b
  }

  function brightenGold(r, g, b) {
    return [
      Math.min(255, Math.round(r * 1.1 + 30)),
      Math.min(255, Math.round(g * 1.05 + 20)),
      Math.max(0, Math.round(b * 0.5)),
    ]
  }

  for (let y = 0; y < fibreRegionStartY; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4
      const alpha = data[pixelIndex + 3]
      if (alpha < 16) {
        continue
      }
      const r = data[pixelIndex]
      const g = data[pixelIndex + 1]
      const b = data[pixelIndex + 2]
      if (r > 235 && g > 235 && b > 235) {
        continue
      }
      if (isGoldPixel(r, g, b)) {
        continue
      }
      data[pixelIndex] = 0
      data[pixelIndex + 1] = 0
      data[pixelIndex + 2] = 0
      data[pixelIndex + 3] = 255
    }
  }

  for (let y = fibreRegionStartY; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4
      const r = data[pixelIndex]
      const g = data[pixelIndex + 1]
      const b = data[pixelIndex + 2]
      const alpha = data[pixelIndex + 3]
      if (alpha < 16 || !isGoldPixel(r, g, b)) {
        continue
      }
      goldMask[y * width + x] = 1
      const [nextR, nextG, nextB] = brightenGold(r, g, b)
      data[pixelIndex] = nextR
      data[pixelIndex + 1] = nextG
      data[pixelIndex + 2] = nextB
    }
  }

  const sourceData = new Uint8ClampedArray(data)
  const boldOffsets = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]
  boldOffsets.forEach(([offsetX, offsetY]) => {
    for (let y = fibreRegionStartY; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const maskIndex = y * width + x
        if (!goldMask[maskIndex]) {
          continue
        }
        const sourceIndex = maskIndex * 4
        const targetX = x + offsetX
        const targetY = y + offsetY
        if (
          targetX < 0 ||
          targetY < fibreRegionStartY ||
          targetX >= width ||
          targetY >= height
        ) {
          continue
        }
        const targetIndex = (targetY * width + targetX) * 4
        data[targetIndex] = Math.max(data[targetIndex], sourceData[sourceIndex])
        data[targetIndex + 1] = Math.max(data[targetIndex + 1], sourceData[sourceIndex + 1])
        data[targetIndex + 2] = Math.min(data[targetIndex + 2], sourceData[sourceIndex + 2])
      }
    }
  })

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
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

export async function drawMananasiCompanyHeader(pdf, logoStandard) {
  const pageWidth = 210
  const left = PDF_MARGIN_MM
  const top = PDF_MARGIN_MM
  const contentWidth = pageWidth - PDF_MARGIN_MM * 2
  const right = left + contentWidth

  try {
    const response = await fetch(logoStandard)
    const blob = await response.blob()
    const logoDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const logoImage = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = logoDataUrl
    })
    const enhancedLogoDataUrl = prepareLogoForPdf(logoImage) ?? logoDataUrl
    const logoBox = { x: right - 81, y: top, width: 81, height: 51 }
    const logoAspectRatio = logoImage.naturalWidth / logoImage.naturalHeight
    let logoWidth = logoBox.width
    let logoHeight = logoWidth / logoAspectRatio
    if (logoHeight > logoBox.height) {
      logoHeight = logoBox.height
      logoWidth = logoHeight * logoAspectRatio
    }
    const logoX = logoBox.x + (logoBox.width - logoWidth) / 2
    const logoY = logoBox.y + (logoBox.height - logoHeight) / 2
    pdf.addImage(enhancedLogoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight)
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
