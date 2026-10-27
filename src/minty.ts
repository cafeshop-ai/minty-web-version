// Minty, a small mouse-driven web pet. No dependencies: one atlas, a few DOM nodes and timers.
//
// She stands on the bottom of the window beside a "menu edge" (any vertical line the page names, usually a
// sidebar). She notices the pointer, loves head pats (rub or click her head), waves when poked and sulks
// when poked too often, struggles when dragged, falls and bounces when dropped or thrown, and fills quiet moments
// with small idles. Hidden, she walks behind the menu edge or the right side of the window, whichever is nearer, and
// peeks out; a click on the peek, or summon(), makes her duck in and walk back out. Every move between places eases
// in and out; she never jumps, and a click or a pat stops her on the way. Timers stop while the tab is in the
// background, and the frame loop runs only while she moves.

export type MintyFrame = [x: number, y: number, w: number, h: number, ax: number, ay: number]
export type MintyAnim = 'idle' | 'blink' | 'smile' | 'notice' | 'pat' | 'wave' | 'walk' | 'dragRight' | 'dragLeft' | 'sulk' | 'happy' | 'laptop'
export interface MintyManifest {
  version: 1
  /** Atlas pixels per CSS pixel. */
  density: number
  size: [number, number]
  frames: MintyFrame[]
  anims: Record<MintyAnim, number[]>
}
export interface MintyState {
  hidden: boolean
  /** Her place on the floor, as a fraction of the window width. */
  x: number
  /** Where she hides: behind the menu edge, or behind the right side of the window, whichever is nearer to her. */
  side?: 'left' | 'right'
}
export interface MintyOptions {
  sheet: { avif?: string; webp: string }
  manifest: MintyManifest
  /** The x of the menu edge, in viewport pixels; asked again on relayout(). Default 0, the window edge. She hides behind
   *  it or behind the right side of the window, whichever is nearer. */
  edge?: () => number
  labels?: { hide?: string; summon?: string }
  /** Where she was last time; by default she stands beside the edge. */
  state?: Partial<MintyState>
  /** No breathing, blinking, idles, particles or flights: she changes only when you act, and without motion. */
  reducedMotion?: boolean
  /** Called when she settles somewhere new, hides or comes back, to store the state. */
  onChange?: (state: MintyState) => void
  /** Stacking order of her layer. */
  zIndex?: number
  /** Element that receives her layer (default document.body). */
  parent?: HTMLElement
}
export interface Minty {
  readonly hidden: boolean
  hide(): void
  summon(): void
  /** Call when the edge moved or the layout changed; window resizes and page scrollbars are handled already. */
  relayout(): void
  destroy(): void
}

// 1x1 AVIF: browsers that cannot show it get the WebP atlas without downloading the AVIF one first.
const AVIF_PROBE =
  'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAXBtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAANGlsb2MAAAAAREAAAgABAAAAAAGUAAEAAAAAAAAAGAACAAAAAAGsAAEAAAAAAAAAEAAAADhpaW5mAAAAAAACAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAFWluZmUCAAAAAAIAAGF2MDEAAAAAr2lwcnAAAACKaXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAcAAAAAA5waXhpAAAAAAEIAAAAOGF1eEMAAAAAdXJuOm1wZWc6bXBlZ0I6Y2ljcDpzeXN0ZW1zOmF1eGlsaWFyeTphbHBoYQAAAAAdaXBtYQAAAAAAAAACAAEDgQIDAAIEhAIFhgAAABppcmVmAAAAAAAAAA5hdXhsAAIAAQABAAAAMG1kYXQSAAoHOAAOUBDQaTILGAAAAEAADBc40zoSAAoEGAAOVTIGGAAAARAP'

const FLOOR = 6 // gap between her feet and the bottom of the window
const SIDE = 18 // half her standing width, plus a little air
const HEAD = 0.42 // the top share of her height that counts as her head
const NEAR = 200 // she notices a pointer closer than this
const PEEK = 8 // hidden, how far her tucked outline reaches past the edge before she leans out
const PACE = 0.045 // her walking pace, px per ms
const STEP = 5.5 // floor covered per walking frame, px
const AMBLE = 6000 // the longest walk, ms; further than that she walks briskly
const FRAME = 130 // the shortest time a dragged or flying frame shows, ms
const GRAVITY = 2600
const NAP = 90_000 // no input for this long and she dozes off

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
const random = (min: number, max: number) => min + Math.random() * (max - min)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const pingpong = (frames: number[]) => [...frames, ...frames.slice(1, -1).reverse()]
// A walk, as the share of the way covered at time t from 0 to 1: she speeds up over the first share a of the time,
// keeps her pace, and slows to a stop over the last share b. `pace` is her speed then, as a share of full pace.
const glide = (t: number, a: number, b: number) => {
  const v = 1 / (1 - a / 2 - b / 2)
  if (t < a) return (v * t * t) / (2 * a)
  if (t > 1 - b) return 1 - (v * (1 - t) ** 2) / (2 * b)
  return v * (t - a / 2)
}
const pace = (t: number, a: number, b: number) => clamp(Math.min(t / a, (1 - t) / b), 0, 1)
const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2
const heart = '<svg viewBox="0 0 10 9" aria-hidden="true"><path d="M5 9 1.1 5.2A2.6 2.6 0 0 1 5 1.7a2.6 2.6 0 0 1 3.9 3.5z"/></svg>'
const tuck =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1.5v9M10 6H4.5m2.5-2.5L4.5 6 7 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export async function createMinty(options: MintyOptions): Promise<Minty> {
  const { manifest } = options,
    { anims } = manifest,
    d = manifest.density,
    edgeOf = options.edge ?? (() => 0),
    calm = !!options.reducedMotion
  const avif = !!options.sheet.avif && (await load(AVIF_PROBE).then(() => true, () => false))
  const sheet = await load(avif ? options.sheet.avif! : options.sheet.webp)

  // A fixed stage from the edge to the right of the window; while she hides it clips her at the edge.
  const element = (tag: string, className: string) => Object.assign(document.createElement(tag), { className })
  const stage = element('div', 'minty'),
    body = element('div', 'minty-body'),
    pose = element('div', 'minty-pose'),
    sprite = element('div', 'minty-sprite'),
    hit = element('div', 'minty-hit'),
    hideButton = element('button', 'minty-hide') as HTMLButtonElement,
    peek = element('button', 'minty-peek') as HTMLButtonElement
  if (options.zIndex !== undefined) stage.style.zIndex = String(options.zIndex)
  hideButton.type = peek.type = 'button'
  hideButton.innerHTML = tuck
  for (const [button, label] of [
    [hideButton, options.labels?.hide ?? 'Hide Minty'],
    [peek, options.labels?.summon ?? 'Call Minty'],
  ] as const) {
    button.title = label
    button.setAttribute('aria-label', label)
  }
  sprite.style.backgroundImage = `url("${sheet.src}")`
  sprite.style.backgroundSize = `${manifest.size[0] / d}px ${manifest.size[1] / d}px`
  pose.append(sprite)
  pose.addEventListener('animationend', (event) => event.animationName === 'minty-land' && pose.classList.remove('is-landing'))
  body.append(pose, hit, hideButton)
  stage.append(body, peek)
  ;(options.parent ?? document.body).append(stage)

  // Where she is: the point between her feet, in viewport pixels.
  let edge = edgeOf(),
    x = 0,
    y = 0,
    hopY = 0,
    tilt = 0,
    origin = '0px 0px'
  // The window's width without a page scrollbar, the right side of her layer.
  const width = () => document.documentElement.clientWidth || window.innerWidth
  const floor = () => window.innerHeight - FLOOR,
    left = () => edge + SIDE,
    right = () => width() - SIDE
  const place = () => {
    stage.style.left = `${edge}px`
    body.style.transformOrigin = origin
    body.style.transform = `translate3d(${x - edge}px, ${y + hopY}px, 0)${tilt ? ` rotate(${tilt}deg)` : ''}`
  }
  // A frame, drawn as it is or mirrored about her feet.
  let frame = -1,
    mirrored = false
  const show = (index: number, mirror = false) => {
    if (index === frame && mirror === mirrored) return
    frame = index
    mirrored = mirror
    const [fx, fy, w, h, ax, ay] = manifest.frames[index],
      s = sprite.style
    s.width = `${w / d}px`
    s.height = `${h / d}px`
    s.transform = `${mirror ? 'scaleX(-1) ' : ''}translate(${-ax / d}px, ${-ay / d}px)`
    s.backgroundPosition = `${-fx / d}px ${-fy / d}px`
    // The hit area follows the pose: a pill as tall as the frame and a little narrower.
    const width = Math.min((w / d) * 0.72, 30),
      height = (h / d) * 0.96
    hit.style.width = `${width}px`
    hit.style.height = `${height}px`
    hit.style.transform = `translate(${-width / 2}px, ${-height}px)`
    hideButton.style.transform = `translate(${width / 2 - 4}px, ${-height - 6}px)`
  }

  // One timer steps the current sequence. `loop` is true, false or how many milliseconds to keep looping.
  let timer = 0
  const stop = () => {
    window.clearTimeout(timer)
    timer = 0
  }
  const play = (frames: number[], fps: number, loop: boolean | number, then?: () => void) => {
    stop()
    if (calm) {
      // One telling frame instead of motion.
      show(frames[Math.floor(frames.length / 2)])
      if (then && loop !== true) timer = window.setTimeout(then, typeof loop === 'number' ? Math.min(loop, 1200) : 900)
      return
    }
    let i = 0
    const started = performance.now()
    const step = () => {
      show(frames[i++])
      if (i >= frames.length) {
        if (!(loop === true || (typeof loop === 'number' && performance.now() - started < loop))) return void (then && (timer = window.setTimeout(then, 1000 / fps)))
        i = 0
      }
      timer = window.setTimeout(step, 1000 / fps)
    }
    step()
  }
  // The single "what next" timer of an activity.
  let next = 0
  const later = (run: (() => void) | null, ms = 0) => {
    window.clearTimeout(next)
    next = run ? window.setTimeout(run, ms) : 0
  }

  type Mode = 'stand' | 'drag' | 'fall' | 'travel' | 'hidden'
  type Activity = 'idle' | 'notice' | 'pat' | 'happy' | 'wave' | 'sulk' | 'laptop' | 'doze' | 'smile'
  let mode: Mode = 'stand',
    activity: Activity = 'idle',
    hidden = !!options.state?.hidden,
    rest = options.state?.x ?? 0,
    side: 'left' | 'right' = options.state?.side === 'right' ? 'right' : 'left',
    lastInput = performance.now(),
    paused = document.visibilityState !== 'visible'
  const poseClass = (name: string, on: boolean) => pose.classList.toggle(name, on && !calm)
  const save = () => options.onChange?.({ hidden, x: rest, side })
  const standing = () => mode === 'stand' && !paused

  // Blinks and small idles while nothing else happens.
  let idleTimer = 0,
    blinkTimer = 0
  const scheduleIdle = () => {
    window.clearTimeout(idleTimer)
    if (!calm && standing()) idleTimer = window.setTimeout(fidget, random(16_000, 34_000))
  }
  const blink = (times: number) => {
    if (activity !== 'idle' || !standing()) return
    show(anims.blink[0])
    blinkTimer = window.setTimeout(() => {
      if (activity !== 'idle' || !standing()) return
      show(anims.idle[0])
      blinkTimer = times > 1 ? window.setTimeout(() => blink(times - 1), 150) : window.setTimeout(() => blink(Math.random() < 0.2 ? 2 : 1), random(2400, 6000))
    }, 130)
  }
  const scheduleBlink = () => {
    window.clearTimeout(blinkTimer)
    if (!calm && standing()) blinkTimer = window.setTimeout(() => blink(1), random(2400, 6000))
  }
  const act = (now: Activity) => {
    activity = now
    later(null)
    // A pat that is still running would turn whatever comes next into its happy ending.
    if (now !== 'pat') window.clearInterval(patTimer)
    poseClass('is-dozing', false)
    poseClass('is-breathing', now === 'idle' || now === 'notice' || now === 'happy' || now === 'smile')
  }
  // Where she was going when a click or a pat stopped her; she carries on once she has reacted.
  let errand: (() => void) | null = null
  const idle = () => {
    stop()
    act('idle')
    if (errand && standing()) {
      const go = errand
      errand = null
      return go()
    }
    show(anims.idle[0])
    scheduleIdle()
    scheduleBlink()
  }
  function fidget() {
    if (activity !== 'idle' || !standing()) return scheduleIdle()
    const roll = Math.random()
    if (roll < 0.3) {
      act('smile')
      show(anims.smile[0])
      later(idle, 1300)
    } else if (roll < 0.5) {
      act('happy')
      play(anims.happy, 2.2, 1800, idle)
    } else if (roll < 0.78) {
      act('laptop')
      play(anims.laptop, 2.5, 5000, idle)
    } else {
      act('wave')
      play(pingpong(anims.wave), 5, false, idle)
    }
    scheduleIdle()
  }

  // Hearts for pats, a "z" while she naps; a few at a time, each removed when its animation ends.
  const puff = (kind: 'heart' | 'z') => {
    if (calm || body.querySelectorAll('.minty-puff').length > 3) return
    const particle = element('span', `minty-puff is-${kind}`)
    if (kind === 'heart') particle.innerHTML = heart
    else particle.textContent = 'z'
    particle.style.left = `${random(-10, 6)}px`
    particle.style.top = `${-random(48, 58)}px`
    particle.addEventListener('animationend', () => particle.remove())
    body.append(particle)
  }

  // A pointer close by: wide eyes, and a smile while it is over her. She settles again once it leaves or rests.
  const notice = (px: number, py: number) => {
    const distance = Math.hypot(px - x, py - (y - 30))
    if (distance > NEAR) {
      if (activity === 'notice') later(idle, 500)
      return
    }
    if (activity !== 'notice') {
      stop()
      window.clearTimeout(blinkTimer)
      act('notice')
    }
    show(distance < 34 ? anims.smile[0] : anims.notice[0])
    later(idle, 1600)
  }

  // Head pats: rub back and forth over her head, or click it. A pat also ends a sulk early.
  let patUntil = 0,
    patTimer = 0,
    rubX = 0,
    rubSign = 0,
    turns: number[] = []
  const pat = (ms: number) => {
    patUntil = Math.max(patUntil, performance.now() + ms)
    if (activity === 'pat') return
    act('pat')
    play(pingpong(anims.pat), 5, true)
    puff('heart')
    window.clearInterval(patTimer)
    patTimer = window.setInterval(() => {
      if (performance.now() < patUntil) return void (Math.random() < 0.6 && puff('heart'))
      window.clearInterval(patTimer)
      act('happy')
      play(anims.happy, 2.2, 1300, idle)
    }, 650)
  }
  const cheer = (ms: number) => {
    if (mode === 'travel' && reachable()) pause()
    if (!standing() || activity === 'doze') return
    if (activity !== 'sulk') return pat(ms)
    puff('heart')
    act('happy')
    poseClass('is-dizzy', false)
    play(anims.happy, 2.2, 1300, idle)
  }
  const rub = (px: number) => {
    const dx = px - rubX
    if (Math.abs(dx) < 2) return
    rubX = px
    if (Math.sign(dx) === rubSign) return
    rubSign = Math.sign(dx)
    const now = performance.now()
    turns = turns.filter((t) => now - t < 800)
    if (turns.push(now) >= 2) cheer(500)
  }

  // Pokes: a wave, but five in a row and she crouches and sobs for a while.
  let pokes: number[] = []
  const poke = () => {
    if (!standing()) return
    const now = performance.now()
    pokes = pokes.filter((t) => now - t < 2500)
    if (pokes.push(now) >= 5) {
      pokes = []
      act('sulk')
      const [down, crouch, sobA, sobB, up] = anims.sulk
      return play([down, crouch], 4, false, () => play([sobA, sobB], 2.5, 3000, () => play([crouch, up], 3.5, false, idle)))
    }
    if (activity === 'sulk' || activity === 'pat') return
    act('wave')
    play(pingpong(anims.wave), 5, false, idle)
  }

  // Naps: no input for a while and she dozes off; any input wakes her.
  const wake = () => {
    lastInput = performance.now()
    if (activity !== 'doze') return
    act('smile')
    show(anims.smile[0])
    later(idle, 900)
  }
  const napTimer = window.setInterval(() => {
    if (calm || !standing()) return
    if (activity === 'doze') return puff('z')
    if (activity !== 'idle' || performance.now() - lastInput < NAP) return
    stop()
    window.clearTimeout(blinkTimer)
    act('doze')
    show(anims.blink[0])
    poseClass('is-dozing', true)
    puff('z')
  }, 2400)

  // In the air: gravity, walls at the sides of the window, one small bounce, then a slide to a stop. Landed over the
  // menu, she steps out of it afterwards.
  let raf = 0,
    vx = 0,
    vy = 0,
    last = 0,
    bounced = false,
    // The way she last moved; she keeps facing it in the air until she moves the other way.
    facing = 1
  const halt = () => {
    cancelAnimationFrame(raf)
    raf = 0
  }
  const fly = (now: number) => {
    const dt = clamp((now - last) / 1000, 0, 0.032)
    last = now
    vy += GRAVITY * dt
    x += vx * dt
    y += vy * dt
    // The lean she had while carried fades as she falls.
    tilt *= Math.exp(-8 * dt)
    if ((x < SIDE && vx < 0) || (x > right() && vx > 0)) {
      x = clamp(x, SIDE, right())
      vx = -vx * 0.45
    }
    if (y >= floor()) {
      y = floor()
      if (vy > 1100) return land(true)
      if (vy > 320 && !bounced) {
        bounced = true
        vy = -vy * 0.28
      } else {
        vy = 0
        vx *= Math.exp(-9 * dt)
        show(anims.idle[0])
        if (Math.abs(vx) < 25) return land(false)
      }
    } else {
      if (Math.abs(vx) > 40) facing = Math.sign(vx)
      show((facing > 0 ? anims.dragRight : anims.dragLeft)[Math.floor(now / FRAME) % anims.dragRight.length])
    }
    place()
    raf = requestAnimationFrame(fly)
  }
  const drop = (speedX: number, speedY: number) => {
    if (calm) return land(false)
    vx = clamp(speedX, -2600, 2600)
    vy = clamp(speedY, -2600, 2600)
    mode = 'fall'
    bounced = false
    last = performance.now()
    raf = requestAnimationFrame(fly)
  }
  const land = (hard: boolean) => {
    halt()
    vx = vy = 0
    tilt = 0
    origin = '0px 0px'
    y = floor()
    place()
    mode = 'stand'
    pose.classList.remove('is-landing')
    void pose.offsetWidth
    poseClass('is-landing', true)
    // Dropped on the menu she goes to hide; down over it or past the window side, she steps back to her floor. Either
    // way she first finds her feet.
    if (hidden || x < left() || x > right()) {
      errand = hidden ? retreat : () => travel(clamp(x, left(), right()), () => settle(false))
      show(anims.idle[0])
      return later(idle, calm ? 0 : 450)
    }
    settle(hard)
  }
  const settle = (hard: boolean) => {
    mode = 'stand'
    rest = x / width()
    save()
    if (!hard || calm) return idle()
    // A hard landing: a dizzy crouch.
    act('sulk')
    poseClass('is-dizzy', true)
    const [, crouch, sobA, , up] = anims.sulk
    play([crouch, sobA, crouch, up], 3.5, false, () => {
      poseClass('is-dizzy', false)
      idle()
    })
  }

  // Along the floor at an unhurried walk: to hide, to come back or to step off the menu. She eases into her first
  // step and out of her last, and the frames follow the floor she covers, so her feet neither skate nor tread on the
  // spot; a long way, she walks briskly rather than for ages. The drawn walk heads left; going right, it is mirrored.
  // Out in the open, a press stops her (see `pause`).
  let goal = 0,
    walking: (() => void) | null = null
  const travel = (target: number, done: () => void) => {
    halt()
    stop()
    later(null)
    mode = 'travel'
    activity = 'idle'
    window.clearInterval(patTimer)
    poseClass('is-breathing', false)
    poseClass('is-dozing', false)
    tilt = 0
    origin = '0px 0px'
    y = floor()
    goal = target
    walking = () => travel(target, done)
    const from = x,
      distance = Math.abs(target - from),
      mirror = target > from,
      duration = calm || distance < 1 ? 0 : clamp(distance / PACE, 500, AMBLE),
      // About a step to get going, and a little more to come to a stop.
      a = Math.min(0.4, 380 / duration),
      b = Math.min(0.45, 480 / duration),
      start = performance.now()
    let phase = 0,
      then = start
    const step = (now: number) => {
      const t = duration ? clamp((now - start) / duration, 0, 1) : 1,
        next = t < 1 ? from + (target - from) * glide(t, a, b) : target
      // A frame per STEP of floor, but none shorter than 70 ms: walking briskly, she takes longer strides.
      phase += Math.min(Math.abs(next - x) / STEP, Math.max(0, now - then) / 70)
      then = now
      x = next
      if (duration) show(anims.walk[Math.floor(phase) % anims.walk.length], mirror)
      // A slight rise with each step.
      hopY = -Math.abs(Math.sin((phase * Math.PI) / 3)) * 0.8 * pace(t, a, b)
      place()
      if (t < 1) return void (raf = requestAnimationFrame(step))
      raf = 0
      walking = null
      hopY = 0
      place()
      done()
    }
    if (!duration) return step(start)
    raf = requestAnimationFrame(step)
  }
  // A press while she walks stops her where she is. She carries on once she has reacted (see `idle`), or gives up
  // if carried off. Half behind an edge she is out of reach.
  const reachable = () => !(stage.classList.contains('is-clipping') && (x < left() || x > right()))
  const pause = () => {
    halt()
    errand = walking
    walking = null
    mode = 'stand'
    hopY = 0
    show(anims.idle[0])
    place()
  }

  // Hidden: she stands behind the menu edge, or behind the right side of the window, in her idle pose; on the right
  // she is mirrored. `out` is how far she leans out, from 0, out of sight, to 1, where her outline reaches PEEK past
  // the edge and she leans so half her face and the bow show. It always eases, so she ducks in and peeks out rather
  // than jumping. The peek button covers her face; she smiles while it is hovered.
  const nearest = () => (x - edge <= width() - x ? 'left' : 'right')
  // How far frames, drawn as they are or mirrored, reach right of her feet, and where she stands with them just out of
  // sight behind the edge of her side:
  const reach = (frames: number[], mirror: boolean) =>
    Math.max(...frames.map((i) => (mirror ? manifest.frames[i][4] : manifest.frames[i][2] - manifest.frames[i][4]) / d))
  const behind = (frames: number[], mirror = false) =>
    side === 'left' ? edge - reach(frames, mirror) - 3 : width() + reach(frames, !mirror) + 3
  let out = 0,
    lean = 13,
    leanTo = 13
  const tucked = () => {
    const dir = side === 'left' ? 1 : -1
    x = behind(anims.idle, side === 'right') + dir * (PEEK + 3) * out
    y = floor()
    tilt = calm ? 0 : dir * lean * out
    origin = '0px 0px'
    place()
    peek.style.transform = `translate(${side === 'left' ? 0 : width() - edge - 18}px, ${floor() - 62}px)`
  }
  const peekTo = (to: number, ms: number, then?: () => void) => {
    halt()
    const fromOut = out,
      fromLean = lean,
      duration = calm ? 0 : ms,
      start = performance.now()
    const step = (now: number) => {
      const t = duration ? clamp((now - start) / duration, 0, 1) : 1
      out = fromOut + (to - fromOut) * ease(t)
      lean = fromLean + (leanTo - fromLean) * ease(t)
      tucked()
      if (t < 1) return void (raf = requestAnimationFrame(step))
      raf = 0
      then?.()
    }
    if (!duration) return step(start)
    raf = requestAnimationFrame(step)
  }
  const dock = (at: number) => {
    halt()
    stop()
    later(null)
    window.clearTimeout(idleTimer)
    window.clearTimeout(blinkTimer)
    window.clearInterval(patTimer)
    errand = walking = null
    mode = 'hidden'
    activity = 'idle'
    stage.classList.add('is-hidden', 'is-clipping')
    stage.classList.toggle('is-right', side === 'right')
    poseClass('is-breathing', false)
    show(leanTo > 13 ? anims.smile[0] : anims.idle[0], side === 'right')
    out = at
    lean = leanTo
    tucked()
  }
  // Out of sight behind the edge she turns round, and after a breath peeks out.
  const duck = () => {
    dock(calm ? 1 : 0)
    if (!calm) later(() => peekTo(1, 650), 300)
  }
  // To hide she walks behind the nearer edge; from over the menu she first steps out beside it.
  const retreat = () => {
    side = nearest()
    save()
    if (side === 'left' && !stage.classList.contains('is-clipping') && x < left()) return travel(left(), retreat)
    stage.classList.add('is-clipping')
    travel(behind(anims.walk, side === 'right'), duck)
  }
  const hide = () => {
    if (hidden) return
    hidden = true
    save()
    later(null)
    // Carried or falling, she hides once she is down.
    if (mode === 'drag' || mode === 'fall') return
    // Ducking in to come out: she peeks again instead.
    if (mode === 'hidden') {
      stage.classList.add('is-hidden')
      return peekTo(1, 650)
    }
    if (calm || mode === 'travel') return retreat()
    // A wave goodbye, then off she goes.
    errand = retreat
    act('wave')
    play([...anims.wave.slice(1), anims.wave[2]], 5, false, idle)
  }
  const summon = () => {
    if (!hidden) return
    hidden = false
    errand = null
    later(null)
    stage.classList.remove('is-hidden')
    save()
    if (mode === 'drag' || mode === 'fall') return
    const home = () =>
      travel(clamp(rest * width(), left(), right()), () => {
        stage.classList.remove('is-clipping')
        mode = 'stand'
        act('wave')
        play(pingpong(anims.wave), 5, false, idle)
      })
    // On her way to hide she turns back; hidden, she ducks in and walks out from behind the edge.
    if (mode !== 'hidden') return home()
    peekTo(0, 260, () => {
      x = behind(anims.walk, side === 'left')
      home()
    })
  }
  const leanOut = (more: boolean) => {
    leanTo = more ? 20 : 13
    if (mode !== 'hidden' || !hidden) return
    later(null)
    show(more ? anims.smile[0] : anims.idle[0], side === 'right')
    peekTo(1, 220 + 430 * (1 - out))
  }

  // The layer lets every click through; only the pill, the hide button and the peek take the pointer.
  let press: { id: number; sx: number; sy: number; gx: number; gy: number; head: boolean } | null = null,
    samples: { t: number; x: number; y: number }[] = []
  const overHead = (event: PointerEvent) => {
    const rect = hit.getBoundingClientRect()
    return event.clientY < rect.top + rect.height * HEAD
  }
  // The pointer's speed over the last 0.1 s: held still before letting go, she drops straight down.
  const velocity = (now: number) => {
    const recent = samples.filter((sample) => now - sample.t < 100)
    if (recent.length < 2) return { vx: 0, vy: 0 }
    const first = recent[0],
      lastSample = recent[recent.length - 1],
      dt = Math.max(16, now - first.t) / 1000
    return { vx: (lastSample.x - first.x) / dt, vy: (lastSample.y - first.y) / dt }
  }
  hit.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    if (mode === 'travel' && reachable()) pause()
    if (mode !== 'stand' && mode !== 'fall') return
    event.preventDefault()
    hit.setPointerCapture(event.pointerId)
    if (mode === 'fall') {
      // Caught in the air.
      halt()
      mode = 'stand'
    }
    press = { id: event.pointerId, sx: event.clientX, sy: event.clientY, gx: event.clientX - x, gy: event.clientY - y, head: overHead(event) }
    samples = [{ t: performance.now(), x: event.clientX, y: event.clientY }]
  })
  hit.addEventListener('pointermove', (event) => {
    if (!press) {
      if (mode !== 'stand' && mode !== 'travel') return
      const head = overHead(event)
      hit.classList.toggle('is-head', head)
      if (head) rub(event.clientX)
      return
    }
    if (event.pointerId !== press.id) return
    const now = performance.now()
    samples.push({ t: now, x: event.clientX, y: event.clientY })
    samples = samples.filter((sample) => now - sample.t < 100)
    if (mode !== 'drag') {
      if (Math.hypot(event.clientX - press.sx, event.clientY - press.sy) < 5) return
      mode = 'drag'
      // Carried off, she gives up where she was going; on her way to hide, she stays out.
      if (errand) {
        errand = null
        if (hidden) {
          hidden = false
          save()
        }
      }
      stage.classList.remove('is-clipping')
      stop()
      window.clearInterval(patTimer)
      act('idle')
      poseClass('is-breathing', false)
      stage.classList.add('is-dragging')
      origin = `${press.gx}px ${press.gy}px`
      facing = 1
      show(anims.dragRight[0])
    }
    x = event.clientX - press.gx
    y = Math.min(event.clientY - press.gy, floor())
    const { vx: speed } = velocity(now)
    if (Math.abs(speed) > 40) {
      facing = Math.sign(speed)
      show((facing > 0 ? anims.dragRight : anims.dragLeft)[Math.floor(now / FRAME) % anims.dragRight.length])
    }
    tilt = calm ? 0 : clamp(-speed * 0.012, -14, 14)
    place()
  })
  const release = (event: PointerEvent, cancelled: boolean) => {
    if (!press || event.pointerId !== press.id) return
    const { head } = press
    press = null
    stage.classList.remove('is-dragging')
    if (mode !== 'drag') {
      // Caught in the air and let go again: she falls on.
      if (y < floor() - 0.5) return drop(0, 0)
      if (cancelled) return void (errand && idle())
      return head ? cheer(1200) : poke()
    }
    // Dropped on the menu: once down, she goes to hide behind its edge.
    if (!cancelled && !hidden && event.clientX < edge) {
      hidden = true
      save()
    }
    const speed = cancelled ? { vx: 0, vy: 0 } : velocity(performance.now())
    drop(speed.vx, speed.vy)
  }
  hit.addEventListener('pointerup', (event) => release(event, false))
  hit.addEventListener('pointercancel', (event) => release(event, true))
  hit.addEventListener('pointerleave', () => hit.classList.remove('is-head'))
  // The button's arrow points to the side she would hide on.
  const aim = () => hideButton.classList.toggle('is-right', nearest() === 'right')
  hit.addEventListener('pointerenter', aim)
  hideButton.addEventListener('focus', aim)
  hideButton.addEventListener('click', hide)
  peek.addEventListener('click', summon)
  peek.addEventListener('pointerenter', () => leanOut(true))
  peek.addEventListener('pointerleave', () => leanOut(false))
  peek.addEventListener('focus', () => leanOut(true))
  peek.addEventListener('blur', () => leanOut(false))

  const onMove = (event: PointerEvent) => {
    wake()
    if (!calm && standing() && (activity === 'idle' || activity === 'notice')) notice(event.clientX, event.clientY)
  }
  const onInput = () => wake()
  const onVisibility = () => {
    paused = document.visibilityState !== 'visible'
    if (!paused) return void (mode === 'stand' && idle())
    stop()
    later(null)
    window.clearTimeout(idleTimer)
    window.clearTimeout(blinkTimer)
    window.clearInterval(patTimer)
    // Whatever was under way ends where it was going.
    if (hidden) return dock(1)
    if (mode === 'stand' || mode === 'drag') return
    halt()
    stage.classList.remove('is-clipping')
    x = clamp(mode === 'fall' ? x : mode === 'travel' ? goal : rest * width(), left(), right())
    land(false)
  }
  function relayout() {
    edge = edgeOf()
    if (mode === 'hidden') return tucked()
    if (mode === 'stand') {
      x = clamp(x, left(), right())
      y = floor()
    }
    place()
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('keydown', onInput, { passive: true })
  window.addEventListener('wheel', onInput, { passive: true })
  window.addEventListener('resize', relayout)
  // A page scrollbar that comes or goes changes the width she uses without a resize event.
  const page = new ResizeObserver(() => relayout())
  page.observe(document.documentElement)
  document.addEventListener('visibilitychange', onVisibility)

  // First appearance.
  y = floor()
  if (hidden) dock(1)
  else {
    x = clamp(rest * width(), left(), right())
    place()
    idle()
  }
  requestAnimationFrame(() => stage.classList.add('is-ready'))

  return {
    get hidden() {
      return hidden
    },
    hide,
    summon,
    relayout,
    destroy() {
      stop()
      later(null)
      halt()
      window.clearTimeout(idleTimer)
      window.clearTimeout(blinkTimer)
      window.clearInterval(patTimer)
      window.clearInterval(napTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('keydown', onInput)
      window.removeEventListener('wheel', onInput)
      window.removeEventListener('resize', relayout)
      page.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      stage.remove()
    },
  }
}
