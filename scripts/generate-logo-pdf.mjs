import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logoPath = path.join(__dirname, '..', 'LogoStandard.png')
const outPath = path.join(__dirname, '..', 'LogoPdf.jpg')

const jpegBuffer = await sharp(logoPath)
  .flatten({ background: '#ffffff' })
  .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 90 })
  .toBuffer()

fs.writeFileSync(outPath, jpegBuffer)
console.log(`Wrote ${outPath} (${(jpegBuffer.length / 1024).toFixed(1)} KB)`)
