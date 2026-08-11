# Design system

Read this before writing or changing anything in `web/`.

The reason this file exists: when nothing states a direction, generated UI falls back to the
statistical average of everything it has seen — purple-to-blue gradients, a 1px gray border
around every card, Inter headlines, three feature cards in a row, `rounded-2xl shadow-lg p-6`.
That look isn't a style anyone chose; it's what you get when nobody chose. This file is the
choice, written down, so it survives.

---

## The device

**iPhone 13 Pro, added to the home screen, one user.** That is the entire target.

- 390 x 844 CSS px. Notch, not a Dynamic Island: top safe inset ~47px, bottom ~34px.
- **No breakpoints. No media queries for width. No desktop layout.** There is one screen size.
  A `grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))` here is dead code pretending
  to be flexibility.
- Runs in standalone mode, so it must feel like an app and not a web page in a frame: no
  address bar to fall back on, no browser back button, safe areas respected, tap targets 44px.
- Everything interactive sits in the bottom third where a thumb reaches. The top of a 6.1"
  screen is for reading, not touching.

## Direction

**Instrument panel.** A measuring device, not a dashboard. Warm charcoal ground, sodium-amber
signal, hairline rules, numerals in monospace so columns align and digits don't shift width as
values tick over.

Personality: *measured, unlit, precise, slightly industrial, unexcited.*

Anti-examples, stated so they can't creep back in: not a SaaS analytics dashboard, not a
fitness app with a celebratory ring animation, not a Stripe lookalike, not glassmorphism.

Dark is deliberate, not reflex. Two reasons: it is legible in gym lighting, and the 13 Pro's
OLED renders `#121110` as effectively off pixels. **There is no light mode and no theme
toggle** — one user, one lighting context, one decision.

## Colour

Three hues, 60 / 30 / 10.

| Token | Value | Role |
| --- | --- | --- |
| `--ground` | `#121110` | 60% — page ground. Warm near-black, never `#000` |
| `--panel` | `#191716` | Raised ground — used sparingly, a background shift instead of a border |
| `--rule` | `#2A2724` | Hairlines. The only "container" this design has |
| `--ink` | `#EDE6DA` | 30% — primary text. Warm off-white, never `#FFF` |
| `--ink-dim` | `#9A9189` | Secondary text, axis labels |
| `--ink-faint` | `#6E6862` | Captions, disabled. Never for anything you must read |
| `--signal` | `#E0913A` | 10% — sodium amber. The single accent. Current value, active tab, primary series |
| `--signal-low` | `#7A5124` | Amber at rest — bar troughs, inactive fills |

Semantic colours are kept separate from the accent, so "good" never has to borrow the brand:

| Token | Value | Role |
| --- | --- | --- |
| `--up` | `#7FA65C` | Moss. Increase — used neutrally, not as praise |
| `--down` | `#C4553D` | Rust. Decrease |
| `--flag` | `#C9A227` | Low-confidence data needing review |

Direction is not judgement. Bodyweight down is `--down` because the number went down, not
because that is bad. The app reports; it does not cheer.

## Type

Two families with a rule that decides between them, rather than a vibe:

- **Mono (Azeret Mono)** — anything *measured*. Every numeral, unit, date, axis tick, and the
  uppercase micro-labels above them. Tabular figures mean a column of weights lines up and a
  ticking value doesn't reflow.
- **Sans (IBM Plex Sans)** — anything *named*. Exercise names, food names, prose, empty states.

Not Inter, not Geist, not Poppins, not Space Grotesk. Weight carries hierarchy; a third family
is never the answer.

Scale, x1.28 from 13px: `11 / 13 / 16 / 20 / 26 / 34 / 44`.

- `11px` uppercase, `0.14em` tracking — micro-labels only. Never a sentence.
- `16px` minimum for anything you read as prose.
- Big numerals at `34–44px`, weight 500. **No gradient text, ever** — least of all on a metric.
- Measure caps at 60–70 characters, which on 390px happens naturally.

## Layout and structure

- **No cards.** Separation comes from whitespace first, then a hairline rule, then a background
  shift — in that order, and it almost never gets past the second.
- **No nesting.** If a thing is inside a thing inside a thing, the structure is wrong.
- **Radius 0** on panels and rules. `2px` on the few pressable pills. Nothing is a rounded rect.
- **No shadows.** They are invisible on this ground and `shadow-lg` is a tell.
- One focal point per screen. The hierarchy must survive being viewed as a thumbnail.
- Vary treatment down the page — a screen is not four instances of the same block. A big
  numeral, then a ledger of rows, then a chart, is a rhythm; three identical panels is wallpaper.
- Gutter is `20px`. Vertical rhythm on a 4px base: `4 8 12 16 20 24 32 48 64`.

## Charts

Recharts is available, but **it is not the default answer**. A horizontal bar row is two divs
and a width percentage; wrapping that in a charting library adds a client bundle and a set of
defaults to fight. Rule:

- **Hand-rolled CSS/SVG** for bar rows, sparklines, macro splits. These render on the server
  and ship no JavaScript.
- **Recharts** only where the interaction earns it — the bodyweight trend and the nutrition
  history, where scrubbing a value matters.

When Recharts is used, strip its defaults: no `CartesianGrid` boxes, no default tooltip chrome,
no legend, no rounded bar caps, no dot on every point. Axis ticks are mono `11px --ink-dim`.

## Motion

The app animates, and the test every animation has to pass is: **does the movement carry a
reading?** A bar growing to length is showing you its magnitude. A number settling is an
instrument finding its value. A marker sliding between tabs is telling you the four are one
row. Motion that only signals *this app has motion* is the thing to cut.

Easing is one curve, `--settle` (`cubic-bezier(.16,1,.3,1)`): fast off the mark, long slow
arrival. Things come to rest the way a needle does.

| What | How | Why it earns it |
| --- | --- | --- |
| Bars, all screens | `scaleX(0→1)`, 750ms, staggered 45–70ms down a list | The growth *is* the magnitude; the stagger reads as a list filling in |
| Sparkline | `stroke-dashoffset` draw, 1.1s, fill and end-marker behind it | Draws left to right, so it reads as time passing |
| Headline figures | Count to value, 900ms, `easeOutQuart` | A gauge powering on. Small values settle from ~97%; totals over 400 sweep from zero, where the sweep is the sense of scale |
| Sections | Rise 14px + fade on entering view, 60–180ms apart | The only scroll-triggered motion in the app |
| Tab marker | `translateX`, 340ms | One marker that moves, not four that blink |
| Backdrop grid | `translateY` at 0.18× scroll | The app's only parallax |
| Nutrition bars | Fill colour, 180ms, on scrub | The one motion that answers *you* rather than page load |

Rules that constrain all of it:

- **Only `transform`, `opacity`, `stroke-dashoffset` and `fill`.** Never width, height, top or
  left. Nothing animated may cause layout during a scroll.
- **Parallax goes behind the data, never through it.** The backdrop is a measurement grid at
  0.18× scroll, giving the numbers a plane to sit above. Content itself never moves at its own
  speed — a screen of figures sliding around is harder to read, which is the opposite of the job.
- **Recharts' built-in animation stays off.** It replays on prop change and the scrub handler
  changes props every frame; the bars are animated once from CSS instead.
- **Correct values are always in the server HTML.** `Counter` rewrites `textContent` on a ref
  rather than holding the number in state, so no JavaScript means no animation — never a blank.
- **A reveal must never be able to hide data.** `Reveal` resolves immediately under reduced
  motion and force-shows itself after 1600ms if the observer never fires.
- **`prefers-reduced-motion: reduce` means none, not faster.** Hidden states are reset outright
  and the parallax stops dead; zeroing durations alone would strand `.reveal` at `opacity: 0`.

## States

Every one of these is designed before the screen ships, because on a personal log they are all
routine — a cleared database hits all three at once:

- **Empty** — say what is missing and how it gets filled, in a sentence. Never a shrug emoji,
  never an illustration.
- **Error** — a rule, the word, and the reason. The section fails alone; the rest of the screen
  still renders.
- **Loading** — a static dimmed label. No skeleton shimmer.

Also: hover is irrelevant here, but `:active` and `:focus-visible` are not. Every pressable
thing has both.

## Not in this codebase

Stated explicitly so they don't reappear:

gradients of any kind · glassmorphism / backdrop blur · pure `#000` or `#FFF` · `border-radius`
above 2px · box-shadows · card outlines · nested cards · dark mode toggle · media queries on
width · icon libraries · emoji as UI · a chart component for a two-div bar · skeleton shimmer ·
"Welcome back" copy · congratulating the user on a workout.

And on motion specifically: content parallax (only the backdrop moves) · bounce or spring
easing · anything animating `width`/`height`/`top`/`left` · looping or idle animation · hover
effects (there is no cursor) · an animation that must finish before a number can be read.
