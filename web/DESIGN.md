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

Three hues carry the interface, 60 / 30 / 10 — plus one small categorical palette for movement
patterns, described below.

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

### The categorical palette

One dimension in this app is coloured by category — **movement pattern** — and nothing else is.

| Token | Value | Pattern |
| --- | --- | --- |
| `--push` | `#e07a62` | Push |
| `--pull` | `#4e9ec4` | Pull |
| `--legs` | `#8f84d0` | Legs |
| `--core` | `#c97ba3` | Core |
| `--cardio` | `#5fa87b` | Cardio |

These are defined once in `src/lib/patterns.ts` and imported by every screen, so a colour cannot
mean push on the calendar and pull on the lifts list. Rules that keep it from becoming the
rainbow dashboard it could easily be:

- **It encodes exactly one thing.** Muscle regions, meal types and weeks all stay monochrome. If
  a second dimension gets colours, the first one stops meaning anything. Macros are the one
  refinement of this, and they are still monochrome — see the ramp below.
- **Colour is redundant, never load-bearing.** Slot position is fixed and a text label is always
  present, so the palette reinforces a reading you could already get without it. That is also
  what makes it safe for colour-vision deficiency — and why push and cardio, the red/green pair,
  differ in lightness as well as hue.
- **None of them is the signal amber.** Chrome — active tab, focus ring, today's outline, the
  current value — stays `--signal`, so interface colour and data colour never compete.
- Hues sit ~65° apart and are pulled toward the warm ground, so they read as one set rather than
  five saturated defaults.

Semantic colours are kept separate from both, so "good" never has to borrow the brand:

| Token | Value | Role |
| --- | --- | --- |
| `--fault` | `#C4553D` | Rust. Something is broken: a failed section, a rejected edit |
| `--flag` | `#C9A227` | Low-confidence data needing review |

**Direction is never coloured.** A change is a triangle and a sign, in plain ink, whichever way
it went.

This replaced a moss `--up` and a rust `--down`, and the note that used to sit here claimed they
were read as direction rather than judgement. They were not. Green-up and red-down mean good and
bad no matter what a palette intends, and the figure they mostly coloured was bodyweight — where
neither direction is either, and where the app showed rust for a cut and moss for a bulk. A
convention that strong cannot be opted out of by declaring it; it can only be not used.

The app reports; it does not cheer, and it does not tut.

### The macro ramp

Macros are the one place a second dimension is distinguished by colour, and it is a **lightness
ramp of a single warm golden stone**, not a second palette — so the categorical budget is still
spent entirely on movement pattern.

| Token | Value | Role |
| --- | --- | --- |
| `--macro-protein` | `#D4CAAF` | Protein. The lightest step |
| `--macro-carbs` | `#B6A47C` | Carbs |
| `--macro-fat` | `#8C784F` | Fat. The darkest step, and still above `--ink-faint` |

Why a ramp rather than three hues: adjacent segments of a split bar separate better by lightness
than by hue at equal lightness, and a ramp survives any colour-vision deficiency by construction
rather than by luck. Six hues are already spoken for — five patterns plus the amber chrome — so
three more would land beside push and legs on the wheel and cost the pattern palette its meaning.

**The chroma is load-bearing and was got wrong once.** The first version of this ramp was
near-neutral and read as three greys: drab, and out of character in an app whose personality is
amber on warm charcoal. These carry real warmth instead. What keeps them from *becoming* amber is
hue and saturation together — they sit around 40–44° against the signal's 31°, at under half
its saturation, so they read as stone and gold rather than as a dimmer accent.

**Calories are amber and are not a fourth macro.** They are the axis these three are drawn on —
protein and carbs ×4, fat ×9 — so the nutrition chart's bars are `--signal-low`, going `--signal`
when selected. None of the ramp may be amber. Before it existed, protein was `--signal` and fat
was `--signal-low`, which meant fat on one screen was drawn in exactly the colour calories are
drawn in on another.

The floor is load-bearing: these tones also carry the P/C/F letters at 11px, so the darkest step
sits just above `--ink-faint` rather than at the bottom of the range. A wider ramp would separate
the bar slightly better and make one of the three letters unreadable.

`MACROS` in `src/lib/macros.ts` is the single source, holding each macro's tone *and* its calories
per gram — the two are always used together, and a bar drawn from one and coloured from the other
is exactly where they would drift apart.

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
| Nutrition bars | Fill colour, 180ms, on scrub | The one motion that answers *you* rather than page load |

Rules that constrain all of it:

- **Only `transform`, `opacity`, `stroke-dashoffset` and `fill`.** Never width, height, top or
  left. Nothing animated may cause layout during a scroll.
- **Nothing in the background moves, or is there at all.** A parallax measurement grid lived
  behind the content for a while. It was subtle and it was still wrong: a screen made almost
  entirely of hairlines and thin bars does not need more horizontal lines behind it, and a
  static texture competing with the data is a texture that wins. The ground is flat.
- **Recharts' built-in animation stays off.** It replays on prop change and the scrub handler
  changes props every frame; the bars are animated once from CSS instead.
- **Correct values are always in the server HTML.** `Counter` rewrites `textContent` on a ref
  rather than holding the number in state, so no JavaScript means no animation — never a blank.
- **A reveal must never be able to hide data.** `Reveal` resolves immediately under reduced
  motion and force-shows itself after 1600ms if the observer never fires.
- **`prefers-reduced-motion: reduce` means none, not faster.** Hidden states are reset outright
  outright; zeroing durations alone would strand `.reveal` at `opacity: 0`.

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

And on motion specifically: parallax of any kind · background texture · bounce or spring
easing · anything animating `width`/`height`/`top`/`left` · looping or idle animation · hover
effects (there is no cursor) · an animation that must finish before a number can be read.
