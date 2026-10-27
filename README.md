# Minty, web version

Minty is the mint-haired Café Shop maid from the banner, as a small pet that lives on the edge of a web page.
She is the web counterpart of the [Codex desktop pet](https://github.com/cafeshop-ai/minty): the same drawings,
re-cut for a page where she must stay out of the way.

<img src="preview.gif" width="360" alt="Minty notices the pointer, gets a head pat, waves, is carried and dropped, then walks behind the menu, peeks out and walks back">

- **Small:** about 33 x 57 CSS px on screen. Only a narrow pill over her body takes the pointer; the page around her
  stays clickable.
- **Light:**

  | File | Size |
  | --- | --- |
  | Atlas (`minty.avif`, 588x596, 35 frames) | 92 KB |
  | WebP fallback, only for browsers without AVIF | 102 KB |
  | Script | 5.2 KB gzipped |
  | Styles | 1.5 KB gzipped |

  No dependencies, no canvas or WebGL. Nothing animates frame by frame while she stands still, except an
  occasional blink.
- **Mouse only:** she never speaks.

## What she does

| You | Minty |
| --- | --- |
| Move the pointer near her | Notices it with wide eyes, and smiles while it is over her |
| Rub back and forth over her head, or click it | Head pat: closed-eye smile and hearts, then a happy pose |
| Click her body | Waves |
| Click her five times in a row | Crouches and sobs for a moment; a pat cheers her up sooner |
| Drag her | Struggles, facing the way you pull, and swings with the speed |
| Let go or throw | Falls, bounces off the window sides, slides to a stop; a hard landing leaves her dizzy. Landed over the menu, she steps out beside it |
| Drop her on the menu | Lands, finds her feet, steps out beside it and walks behind its edge to hide |
| Leave her alone | Blinks and breathes, and now and then smiles, waves or works on a laptop. After 90 s without input she dozes off |
| Click the small button over her head | Waves goodbye and walks, carrying a cup of coffee, behind the menu edge or the right side of the window, whichever is nearer; the button's arrow shows which. Out of sight, she turns round and slowly leans out until half her face and her bow show |
| Hover or click the peek | She leans out further and smiles; a click makes her duck in and walk back out to where she stood |
| Click, pat or hold her while she walks | She stops, reacts, then walks on. Carry her off and she gives up the errand: on her way to hide, she stays out |

She never jumps from place to place. She walks at an unhurried 45 px/s, easing into her first step and out of her
last, with her steps following the floor; a long way, she walks briskly, so no walk takes more than 6 s. Each lean
eases in and out, and poses change at a calm pace, from 120 ms a frame for walking to 400 ms for sobbing. Being carried
or thrown has its own leaping frames.

The state (hidden, where she stood, and the side she hides on) goes to `onChange`, so a page can keep it. With
`prefers-reduced-motion`, pass `reducedMotion: true`. She then has no breathing, blinking, idles, particles or
flights, and changes pose only when you act.

## Use

```ts
import { createMinty } from './dist/minty.js' // or src/minty.ts in a TypeScript build
import './dist/minty.css'
import manifest from './dist/minty.json'

const minty = await createMinty({
  sheet: { avif: '/minty.avif', webp: '/minty.webp' },
  manifest,
  edge: () => document.querySelector('nav')!.getBoundingClientRect().right, // the menu edge; she also hides at the right
  state: JSON.parse(localStorage.getItem('minty') || '{}'),
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  onChange: (state) => localStorage.setItem('minty', JSON.stringify(state)),
  labels: { hide: 'Hide Minty', summon: 'Call Minty' },
})
// minty.hide(), minty.summon(), minty.hidden; minty.relayout() when the edge moves; minty.destroy()
```

She is meant for a desktop page with a mouse. Leave her out on touch screens and narrow windows, for example
behind `matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)')`. Her layer uses `z-index: 45`:
above a sidebar at 40, below popovers and dialogs. Change it with `zIndex`.

`demo/index.html` shows her beside a sidebar that folds, in both themes. Serve the repository root and open
`/demo/`.

## How the atlas is made

`scripts/build-atlas.mjs` builds `dist/` from `spritesheet.webp` of
[cafeshop-ai/minty](https://github.com/cafeshop-ai/minty) at `dbab7c6b`. The script checks its SHA-256 first.

1. **Pick:** 35 of the source's 69 frames. Breathing and bobbing are drawn in code instead, and near-duplicate
   frames are dropped. The look directions (rows 9 and 10) are left out: they draw her with a smaller head on a
   longer body. The drag rows (1 and 2) are one leaping pose, used for being carried and thrown. The walk is row 6,
   her only walk cycle, carrying coffee; it heads left and is mirrored to head right.
2. **Crop:** each frame to its own outline, keeping the point between her feet as its anchor.
3. **Scale:** each frame to the same head size, for 56 CSS px at 2x. The source draws some poses smaller than idle
   (head pats and sulks by about a ninth). `scripts/measure-heads.mjs` measures the front-facing rows. The drag
   rows lean too far for it and were measured by hand. The walk is the exception: its head is drawn about 13%
   smaller at the same height, so it is scaled to her standing height. Matched by the head, she would grow as she
   walked.
   ![Her poses at one head size, on the light and dark console](preview.webp)
4. **Pack:** the frames into one sheet with 4 px gutters.
5. **Encode:** AVIF q48 (4:2:0), plus a WebP fallback. A 128-colour palette was smaller, but it lost her amber
   eyes, the blush and the brooch.

```sh
npm install
node scripts/measure-heads.mjs ../minty/spritesheet.webp # head sizes for HEADS in build-atlas.mjs (minutes)
node scripts/build-atlas.mjs ../minty/spritesheet.webp   # dist/minty.{avif,webp,json}
npm run build                                            # dist/minty.{js,css}
node scripts/preview.mjs                                 # preview.webp
npm run check                                            # tsc
```

`preview.gif` is a recording of `dist/` driven by a scripted pointer in headless Chromium, with a drawn cursor.

## License

MIT, © 2026 Café Shop, like the desktop pet the drawings come from. See [LICENSE](LICENSE).
