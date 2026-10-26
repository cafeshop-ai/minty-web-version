// Renders preview.webp: one frame of each animation at its true 2x size, on the light and the dark console canvas.
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const manifest = JSON.parse(readFileSync('dist/minty.json', 'utf8'))
const picks = [['idle', 0], ['look', 2], ['look', 7], ['pat', 2], ['happy', 0], ['wave', 2], ['dragRight', 1], ['sulk', 3], ['laptop', 0], ['coffee', 1]]
const sheet = sharp('dist/minty.webp')
const sheetBuffer = await sheet.png().toBuffer()
const gap = 28, pad = 24, rowHeight = 150
const parts = []
let x = pad
for (const [anim, i] of picks) {
  const [fx, fy, w, h, ax, ay] = manifest.frames[manifest.anims[anim][i]]
  const input = await sharp(sheetBuffer).extract({ left: fx, top: fy, width: w, height: h }).png().toBuffer()
  parts.push({ input, x: Math.round(x + 30 - ax), y: Math.round(rowHeight - 14 - ay) })
  x += 60 + gap
}
const width = Math.round(x + pad - gap)
const row = (background) =>
  sharp({ create: { width, height: rowHeight, channels: 4, background } })
    .composite(parts.map((p) => ({ input: p.input, left: p.x, top: p.y })))
    .png()
    .toBuffer()
const rows = [await row('#f5f3f0'), await row('#251d15')]
await sharp({ create: { width, height: rowHeight * 2, channels: 4, background: '#000' } })
  .composite(rows.map((input, i) => ({ input, left: 0, top: i * rowHeight })))
  .webp({ quality: 90 })
  .toFile('preview.webp')
console.log('preview.webp', width, 'x', rowHeight * 2)
