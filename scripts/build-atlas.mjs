// Builds the web atlas from the Codex pet atlas of cafeshop-ai/minty (MIT, Café Shop).
// usage: node scripts/build-atlas.mjs <minty>/spritesheet.webp
//   -> dist/minty.avif, dist/minty.webp, dist/minty.json
//
// The Codex atlas is 8x11 cells of 192x208 for a desktop window. The web pet stands 56 CSS px tall, so it keeps
// 29 of the 69 frames (breathing and hops are drawn in code instead), crops each frame to its own outline, scales
// it to a common head size for 2x screens and packs the frames tightly. Every frame keeps the cell's foot point as
// its anchor, so poses that crouch or lean stay where the source put them.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const SOURCE_SHA256 = '4fdba773d9977e1a9ac640ee169c0cdfb8a24d577a7938705829932015671b66' // minty@dbab7c6b
const CELL = { w: 192, h: 208 }
const FOOT = { x: 96, y: 202 } // the floor line and centre of a standing figure in a source cell
const FIGURE = 195 // source height of the standing figure
const HEIGHT = 112 // its height in the web atlas: 56 CSS px at 2x
const SCALE = HEIGHT / FIGURE
const GUTTER = 4 // transparent pixels between frames, so downscaled sampling never reaches a neighbour
// The source draws her at slightly different sizes from pose to pose (the head-pat and sulk rows about a ninth
// smaller than idle). Each frame is scaled by its head size relative to idle's, so her face stays the same size
// whatever she does. Front-facing rows: scripts/measure-heads.mjs. The drag rows lean too far for it; measured by
// hand (headband to chin 85-87 px against idle's 86, bow and headband the same size), they match idle.
const HEADS = {
  '0,0': 1, '0,1': 0.985, '0,2': 0.98, '0,4': 0.965,
  '3,0': 0.975, '3,1': 0.98, '3,2': 0.995, '3,3': 0.965,
  '4,1': 0.89, '4,2': 0.885, '4,3': 0.87, '4,4': 0.88,
  '1,0': 1, '1,2': 1, '1,4': 1, '1,6': 1,
  '2,0': 1, '2,2': 1, '2,4': 1, '2,6': 1,
  '5,1': 0.9, '5,2': 0.89, '5,3': 0.89, '5,4': 0.89, '5,6': 0.875,
  '8,0': 0.93, '8,2': 0.91,
  '7,0': 0.965, '7,2': 0.955,
}

// [row, column] in the source atlas. The look-direction rows (9 and 10) and the coffee walk (row 6) are left out:
// they are drawn with a smaller head on a longer body, so no single scale matches them to the other poses.
const ANIMS = {
  idle: [[0, 0]],
  blink: [[0, 1]],
  smile: [[0, 2]],
  notice: [[0, 4]],
  pat: [[4, 1], [4, 2], [4, 3], [4, 4]],
  wave: [[3, 0], [3, 1], [3, 2], [3, 3]],
  dragRight: [[1, 0], [1, 2], [1, 4], [1, 6]],
  dragLeft: [[2, 0], [2, 2], [2, 4], [2, 6]],
  sulk: [[5, 1], [5, 2], [5, 3], [5, 4], [5, 6]],
  happy: [[8, 0], [8, 2]],
  laptop: [[7, 0], [7, 2]],
}

const source = process.argv[2]
if (!source) throw new Error('usage: node scripts/build-atlas.mjs <minty>/spritesheet.webp')
const hash = createHash('sha256').update(readFileSync(source)).digest('hex')
if (hash !== SOURCE_SHA256) throw new Error(`${source} is ${hash}, expected minty@dbab7c6b ${SOURCE_SHA256}`)
const { data: atlas, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

async function frame([row, col]) {
  const left = col * CELL.w, top = row * CELL.h
  let x0 = CELL.w, y0 = CELL.h, x1 = -1, y1 = -1
  for (let y = 0; y < CELL.h; y++)
    for (let x = 0; x < CELL.w; x++)
      if (atlas[((top + y) * info.width + left + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) throw new Error(`cell ${row},${col} is empty`)
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const head = HEADS[`${row},${col}`]
  if (!head) throw new Error(`cell ${row},${col} has no measured head size`)
  const scale = SCALE / head
  const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale))
  const { data } = await sharp(atlas, { raw: info })
    .extract({ left: left + x0, top: top + y0, width: w, height: h })
    .resize(tw, th, { kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  // Drop the faint alpha the resize spreads around the outline: invisible, but it costs bytes.
  for (let i = 3; i < data.length; i += 4) if (data[i] < 10) data[i] = data[i - 1] = data[i - 2] = data[i - 3] = 0
  return { cell: [row, col], w: tw, h: th, ax: (FOOT.x - x0) * scale, ay: (FOOT.y - y0) * scale, data }
}

const frames = []
const anims = {}
for (const [name, cells] of Object.entries(ANIMS)) {
  anims[name] = []
  for (const cell of cells) {
    let index = frames.findIndex((f) => f.cell[0] === cell[0] && f.cell[1] === cell[1])
    if (index < 0) index = frames.push(await frame(cell)) - 1
    anims[name].push(index)
  }
}

// Shelf packing, tallest first, into the narrowest power-of-two-free width that keeps the atlas near square.
const order = frames.map((_, i) => i).sort((a, b) => frames[b].h - frames[a].h || frames[b].w - frames[a].w)
const area = frames.reduce((sum, f) => sum + (f.w + GUTTER) * (f.h + GUTTER), 0)
const width = Math.ceil(Math.sqrt(area) * 1.08 / 4) * 4
let x = GUTTER, y = GUTTER, shelf = 0
for (const i of order) {
  const f = frames[i]
  if (x + f.w + GUTTER > width) {
    x = GUTTER
    y += shelf + GUTTER
    shelf = 0
  }
  f.x = x
  f.y = y
  x += f.w + GUTTER
  shelf = Math.max(shelf, f.h)
}
const height = Math.ceil((y + shelf + GUTTER) / 4) * 4

const composite = frames.map((f) => ({ input: f.data, raw: { width: f.w, height: f.h, channels: 4 }, left: f.x, top: f.y }))
const sheet = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composite)
  .png()
  .toBuffer()
mkdirSync('dist', { recursive: true })
// AVIF q48 4:2:0 keeps the amber eyes, blush and brooch; a 128-colour palette lost them. WebP is the fallback.
const avif = await sharp(sheet).avif({ quality: 48, effort: 9 }).toBuffer()
const webp = await sharp(sheet).webp({ quality: 72, alphaQuality: 80, effort: 6 }).toBuffer()
writeFileSync('dist/minty.avif', avif)
writeFileSync('dist/minty.webp', webp)
const round = (n) => Math.round(n * 100) / 100
const manifest = {
  version: 1,
  density: 2,
  size: [width, height],
  // [x, y, width, height, anchor x, anchor y] in atlas pixels; the anchor is the point between her feet.
  frames: frames.map((f) => [f.x, f.y, f.w, f.h, round(f.ax), round(f.ay)]),
  anims,
}
writeFileSync('dist/minty.json', JSON.stringify(manifest) + '\n')
console.log(`${frames.length} frames, ${width}x${height}; avif ${(avif.length / 1024).toFixed(1)} KB, webp ${(webp.length / 1024).toFixed(1)} KB`)
