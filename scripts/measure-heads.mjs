// Measures how large the source draws her head in each cell, relative to idle (0,0), for HEADS in build-atlas.mjs.
// usage: node scripts/measure-heads.mjs <minty>/spritesheet.webp   (a few minutes)
//
// Idle's head, from the headband to the chin, is matched against each cell at half resolution by normalized
// cross-correlation over scale and a small rotation. Front-facing rows only: the drag rows (1 and 2) lean and turn
// too far for a reliable match and are measured by hand (see build-atlas.mjs).
import sharp from 'sharp'

const CELLS = [
  [0, 0], [0, 1], [0, 2], [0, 4], [3, 0], [3, 1], [3, 2], [3, 3], [4, 1], [4, 2], [4, 3], [4, 4],
  [5, 1], [5, 2], [5, 3], [5, 4], [5, 6],
  [8, 0], [8, 2], [7, 0], [7, 2],
]
const HEAD = { left: 48, top: 4, width: 96, height: 94 } // idle's head in its cell, bow included
const BG = { r: 244, g: 239, b: 230 }
const H = 2 // half resolution
const source = process.argv[2]
if (!source) throw new Error('usage: node scripts/measure-heads.mjs <minty>/spritesheet.webp')

async function cell(r, c, scale, angle = 0) {
  let img = await sharp(source).extract({ left: c * 192, top: r * 208, width: 192, height: 208 }).flatten({ background: BG }).toBuffer()
  if (angle) img = await sharp(img).rotate(angle, { background: BG }).toBuffer()
  const meta = await sharp(img).metadata()
  const { data, info } = await sharp(img)
    .resize(Math.round((meta.width * scale) / H), Math.round((meta.height * scale) / H), { kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}
const idle = await cell(0, 0, 1)
const tx = HEAD.left / H, ty = HEAD.top / H, tw = HEAD.width / H, th = HEAD.height / H, n = tw * th * 3
const T = new Float64Array(n)
for (let y = 0, k = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let ch = 0; ch < 3; ch++) T[k++] = idle.data[((ty + y) * idle.w + tx + x) * 3 + ch]
const mean = T.reduce((a, b) => a + b) / n
let variance = 0
for (let i = 0; i < n; i++) {
  T[i] -= mean
  variance += T[i] * T[i]
}
function best(img) {
  let top = -2
  for (let oy = 0; oy + th <= img.h; oy++)
    for (let ox = 0; ox + tw <= img.w; ox++) {
      let s = 0, s2 = 0, st = 0, i = 0
      for (let y = 0; y < th; y++)
        for (let p = ((oy + y) * img.w + ox) * 3, x = 0; x < tw * 3; x++, i++, p++) {
          const v = img.data[p]
          s += v
          s2 += v * v
          st += v * T[i]
        }
      const score = st / Math.sqrt((s2 - (s * s) / n) * variance || 1)
      if (score > top) top = score
    }
  return top
}

const rows = []
for (const [r, c] of CELLS) {
  // A cell whose head is `size` times idle's matches after scaling it by 1/size.
  let top = { score: -2 }
  for (const angle of [-12, -6, 0, 6, 12])
    for (let size = 0.7; size <= 1.36; size += 0.03) {
      const score = best(await cell(r, c, 1 / size, angle))
      if (score > top.score) top = { score, size, angle }
    }
  for (let angle = top.angle - 3; angle <= top.angle + 3; angle += 1.5)
    for (let size = top.size - 0.03; size <= top.size + 0.03; size += 0.005) {
      const score = best(await cell(r, c, 1 / size, angle))
      if (score > top.score) top = { score, size, angle }
    }
  rows.push(`'${r},${c}': ${+top.size.toFixed(3)}`)
  console.error(`${r},${c}`, top.size.toFixed(3), `score ${top.score.toFixed(2)}, ${top.angle}°`)
}
console.log(`const HEADS = { ${rows.join(', ')} }`)
