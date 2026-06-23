import { jsPDF } from 'jspdf'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logoPath = path.join(__dirname, '..', 'LogoStandard.png')
const outPath = path.join(__dirname, '..', 'LogoPdf.jpg')

const jpegBuffer = await sharp(logoPath)
  .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 90 })
  .toBuffer()

fs.writeFileSync(outPath, jpegBuffer)
console.log(`Wrote ${outPath} (${(jpegBuffer.length / 1024).toFixed(1)} KB)`)

function pdfSizeDataUrl(bytes, label) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`
  pdf.addImage(dataUrl, 'JPEG', 120, 25, 81, 51)
  const out = pdf.output('arraybuffer')
  console.log(`${label}: ${(out.byteLength / 1024).toFixed(1)} KB`)
}

function pdfSizeUint8(bytes, label, compression) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const uint8 = new Uint8Array(bytes)
  pdf.addImage(uint8, 'JPEG', 120, 25, 81, 51, undefined, compression)
  const out = pdf.output('arraybuffer')
  console.log(`${label}: ${(out.byteLength / 1024).toFixed(1)} KB`)
}

pdfSizeDataUrl(jpegBuffer, 'Small JPEG via data URL')
pdfSizeUint8(jpegBuffer, 'Small JPEG Uint8Array FAST', 'FAST')
pdfSizeUint8(jpegBuffer, 'Small JPEG Uint8Array SLOW', 'SLOW')

// Compare with full PNG
const pngBuffer = fs.readFileSync(logoPath)
const pngDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
{
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  pdf.addImage(pngDataUrl, 'PNG', 120, 25, 81, 51)
  const out = pdf.output('arraybuffer')
  console.log(`Full PNG as data URL: ${(out.byteLength / 1024 / 1024).toFixed(2)} MB`)
}
