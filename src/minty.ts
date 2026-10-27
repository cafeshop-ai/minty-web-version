// Minty, a small mouse-driven web pet. No dependencies: one atlas, a few DOM nodes and timers.
//
// She stands on the bottom of the window beside a "menu edge" (any vertical line the page names, usually a
// sidebar). She notices the pointer, loves head pats (rub or click her head), waves when poked and sulks
// when poked too often, struggles when dragged, falls and bounces when dropped or thrown, and fills quiet moments
// with small idles. Hidden, she tucks behind the menu edge and peeks out; a click on the peek, or summon(),
// brings her back. Timers stop while the tab is in the background, and the frame loop runs only while she moves.

export type MintyFrame = [x: number, y: number, w: number, h: number, ax: number, ay: number]
export type MintyAnim = 'idle' | 'blink' | 'smile' | 'notice' | 'pat' | 'wave' | 'dragRight' | 'dragLeft' | 'sulk' | 'happy' | 'laptop'
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
}
export interface MintyOptions {
  sheet: { avif?: string; webp: string }
  manifest: MintyManifest
  /** The x of the edge she hides behind, in viewport pixels; asked again on relayout(). Default 0, the window edge. */
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
  /** Call when the edge moved or the layout changed; window resizes are handled already. */
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
  const floor = () => window.innerHeight - FLOOR,
    left = () => edge + SIDE,
    right = () => window.innerWidth - SIDE
  const place = () => {
    stage.style.left = `${edge}px`
    body.style.transformOrigin = origin
    body.style.transform = `translate3d(${x - edge}px, ${y + hopY}px, 0)${tilt ? ` rotate(${tilt}deg)` : ''}`
  }
  let frame = -1
  const show = (index: number) => {
    if (index === frame) return
    frame = index
    const [fx, fy, w, h, ax, ay] = manifest.frames[index],
      s = sprite.style
    s.width = `${w / d}px`
    s.height = `${h / d}px`
    s.transform = `translate(${-ax / d}px, ${-ay / d}px)`
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
    lastInput = performance.now(),
    paused = document.visibilityState !== 'visible'
  const poseClass = (name: string, on: boolean) => pose.classList.toggle(name, on && !calm)
  const save = () => options.onChange?.({ hidden, x: rest })
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
    poseClass('is-dozing', false)
    poseClass('is-breathing', now === 'idle' || now === 'notice' || now === 'happy' || now === 'smile')
  }
  const idle = () => {
    stop()
    act('idle')
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
      play(anims.happy, 3, 1600, idle)
    } else if (roll < 0.78) {
      act('laptop')
      play(anims.laptop, 4, 4200, idle)
    } else {
      act('wave')
      play(pingpong(anims.wave), 7, 1300, idle)
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
    play(pingpong(anims.pat), 8, true)
    puff('heart')
    window.clearInterval(patTimer)
    patTimer = window.setInterval(() => {
      if (performance.now() < patUntil) return void (Math.random() < 0.6 && puff('heart'))
      window.clearInterval(patTimer)
      act('happy')
      play(anims.happy, 3, 1100, idle)
    }, 650)
  }
  const cheer = (ms: number) => {
    if (!standing() || activity === 'doze') return
    if (activity !== 'sulk') return pat(ms)
    puff('heart')
    act('happy')
    poseClass('is-dizzy', false)
    play(anims.happy, 3, 1200, idle)
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
      return play([down, crouch], 6, false, () => play([sobA, sobB], 4, 2600, () => play([crouch, up], 5, false, idle)))
    }
    if (activity === 'sulk' || activity === 'pat') return
    act('wave')
    play(pingpong(anims.wave), 8, 900, idle)
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

  // In the air: gravity, walls at the edge and the window side, one small bounce, then a slide to a stop.
  let raf = 0,
    vx = 0,
    vy = 0,
    last = 0,
    bounced = false
  const halt = () => {
    cancelAnimationFrame(raf)
    raf = 0
  }
  const fly = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000)
    last = now
    vy += GRAVITY * dt
    x += vx * dt
    y += vy * dt
    if (x < left() || x > right()) {
      x = clamp(x, left(), right())
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
    } else show((vx >= 0 ? anims.dragRight : anims.dragLeft)[Math.floor(now / 90) % anims.dragRight.length])
    place()
    raf = requestAnimationFrame(fly)
  }
  const land = (hard: boolean) => {
    halt()
    vx = vy = 0
    tilt = 0
    origin = '0px 0px'
    y = floor()
    rest = x / window.innerWidth
    place()
    mode = 'stand'
    save()
    pose.classList.remove('is-landing')
    void pose.offsetWidth
    poseClass('is-landing', true)
    if (!hard || calm) return idle()
    // A hard landing: a dizzy crouch.
    act('sulk')
    poseClass('is-dizzy', true)
    const [, crouch, sobA, , up] = anims.sulk
    play([crouch, sobA, crouch, up], 5, false, () => {
      poseClass('is-dizzy', false)
      idle()
    })
  }

  // Along the floor in little hops, to hide or to come back.
  const travel = (target: number, done: () => void) => {
    halt()
    stop()
    later(null)
    mode = 'travel'
    activity = 'idle'
    poseClass('is-breathing', false)
    poseClass('is-dozing', false)
    tilt = 0
    y = floor()
    const from = x,
      distance = Math.abs(target - from),
      duration = calm ? 0 : clamp(distance / 0.6, 260, 1400),
      hops = Math.max(1, Math.round(distance / 70)),
      start = performance.now()
    const run = target > from ? anims.dragRight : anims.dragLeft
    show(run[1])
    const step = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1
      if (!calm) show(run[Math.floor(Math.max(0, now - start) / 110) % run.length])
      x = from + (target - from) * (1 - (1 - t) ** 2)
      hopY = calm ? 0 : -Math.abs(Math.sin(t * hops * Math.PI)) * 9
      place()
      if (t < 1) return void (raf = requestAnimationFrame(step))
      raf = 0
      hopY = 0
      place()
      done()
    }
    raf = requestAnimationFrame(step)
  }

  // Hidden: she stands behind the edge, her outline just past it, and leans out so half her face and the bow show.
  // The peek button covers them; she smiles while the pointer is on it.
  const peekFrame = manifest.frames[anims.idle[0]]
  const tucked = () => edge - (peekFrame[2] - peekFrame[4]) / d + PEEK
  let lean = 13
  const dock = () => {
    halt()
    stop()
    later(null)
    window.clearTimeout(idleTimer)
    window.clearTimeout(blinkTimer)
    window.clearInterval(patTimer)
    mode = 'hidden'
    activity = 'idle'
    stage.classList.add('is-hidden', 'is-clipping')
    poseClass('is-breathing', false)
    show(anims.idle[0])
    x = tucked()
    y = floor()
    tilt = calm ? 0 : lean
    origin = '0px 0px'
    place()
    peek.style.transform = `translate(0, ${floor() - 62}px)`
  }
  const hide = () => {
    if (hidden) return
    hidden = true
    save()
    halt()
    stage.classList.add('is-clipping')
    const go = () => travel(left(), () => travel(tucked(), dock))
    if (calm || mode !== 'stand') return go()
    act('wave')
    play(anims.wave.slice(1), 8, false, go)
  }
  const summon = () => {
    if (!hidden) return
    hidden = false
    stage.classList.remove('is-hidden')
    travel(left(), () => {
      stage.classList.remove('is-clipping')
      travel(clamp(rest * window.innerWidth, left(), right()), () => {
        mode = 'stand'
        save()
        act('wave')
        play(pingpong(anims.wave), 8, 1100, idle)
      })
    })
  }
  const leanOut = (more: boolean) => {
    lean = more ? 20 : 13
    if (mode !== 'hidden') return
    show(more ? anims.smile[0] : anims.idle[0])
    if (calm) return
    tilt = lean
    place()
  }

  // The layer lets every click through; only the pill, the hide button and the peek take the pointer.
  let press: { id: number; sx: number; sy: number; gx: number; gy: number; head: boolean } | null = null,
    samples: { t: number; x: number; y: number }[] = []
  const overHead = (event: PointerEvent) => {
    const rect = hit.getBoundingClientRect()
    return event.clientY < rect.top + rect.height * HEAD
  }
  const velocity = (now: number) => {
    const first = samples[0],
      lastSample = samples[samples.length - 1],
      dt = Math.max(16, now - first.t) / 1000
    return { vx: (lastSample.x - first.x) / dt, vy: (lastSample.y - first.y) / dt }
  }
  hit.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (mode !== 'stand' && mode !== 'fall')) return
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
      if (mode !== 'stand') return
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
      stop()
      window.clearInterval(patTimer)
      act('idle')
      poseClass('is-breathing', false)
      stage.classList.add('is-dragging')
      origin = `${press.gx}px ${press.gy}px`
      show(anims.dragRight[0])
    }
    x = event.clientX - press.gx
    y = Math.min(event.clientY - press.gy, floor())
    const { vx: speed } = velocity(now)
    if (Math.abs(speed) > 40) show((speed > 0 ? anims.dragRight : anims.dragLeft)[Math.floor(now / 85) % anims.dragRight.length])
    tilt = calm ? 0 : clamp(-speed * 0.012, -14, 14)
    place()
  })
  const release = (event: PointerEvent, cancelled: boolean) => {
    if (!press || event.pointerId !== press.id) return
    const { head } = press
    press = null
    stage.classList.remove('is-dragging')
    if (mode !== 'drag') {
      if (cancelled) return
      return head ? cheer(1200) : poke()
    }
    tilt = 0
    origin = '0px 0px'
    // Dropped on the menu: she tucks herself away.
    if (event.clientX < edge) {
      hidden = true
      save()
      stage.classList.add('is-clipping')
      y = floor()
      return travel(tucked(), dock)
    }
    const now = performance.now()
    if (cancelled || calm) {
      x = clamp(x, left(), right())
      return land(false)
    }
    ;({ vx, vy } = velocity(now))
    vx = clamp(vx, -2600, 2600)
    vy = clamp(vy, -2600, 2600)
    mode = 'fall'
    bounced = false
    last = now
    raf = requestAnimationFrame(fly)
  }
  hit.addEventListener('pointerup', (event) => release(event, false))
  hit.addEventListener('pointercancel', (event) => release(event, true))
  hit.addEventListener('pointerleave', () => hit.classList.remove('is-head'))
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
    // Whatever was moving finishes at once.
    if (mode === 'fall') land(false)
    else if (mode === 'travel') {
      if (hidden) dock()
      else {
        stage.classList.remove('is-clipping')
        x = clamp(rest * window.innerWidth, left(), right())
        land(false)
      }
    }
  }
  function relayout() {
    edge = edgeOf()
    if (mode === 'hidden') return dock()
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
  document.addEventListener('visibilitychange', onVisibility)

  // First appearance.
  y = floor()
  if (hidden) dock()
  else {
    x = clamp(rest * window.innerWidth, left(), right())
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
      document.removeEventListener('visibilitychange', onVisibility)
      stage.remove()
    },
  }
}
