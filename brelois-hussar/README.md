# Brelois Hussar Tailor

A Roblox classic clothing generator for a light cavalry trooper of the Kingdom of Brelois
(World of Austeria, c. 1805–1815). Every pixel of the Shirt and Pants is painted by code
with Canvas 2D onto the official 585 × 559 clothing template. Nothing is traced or AI-generated.

| File | What it is |
| --- | --- |
| `index.html` | The generator. A single self-contained page (HTML, CSS, JS, no dependencies). |
| `Brelois_Hussar_Shirt.png` | Upload-ready Classic Shirt (dolman), 585 × 559 RGBA. |
| `Brelois_Hussar_Pants.png` | Upload-ready Classic Pants (breeches and boots), 585 × 559 RGBA. |
| `tools/export-pngs.mjs` | Optional headless exporter that regenerates the two PNGs. |

## Use it

1. Open `index.html` in any current browser. It works offline. The Google Fonts only style
   the page and fall back to system fonts.
2. Pick a colour scheme or adjust individual colours and options. The previews and the
   R6 fitting-room dummy update live.
3. Click **Download Shirt PNG** and **Download Pants PNG**.
4. Upload in Roblox Studio or the Creator Hub as a Classic Shirt and Classic Pants.

The committed PNGs use the default *Brelois Hussars (proposed)* scheme, seed `1809`.

## What is painted

**Dolman (shirt):** crimson standing collar with silver lace, piping and embroidered rosettes;
a configurable number of chest braid rows (default 14) that taper from chest to waist, each
ending in pointed frog loops; three columns of domed silver buttons (centre plus two symmetric
columns); laced front opening and pointed hem; laced back seams with side-body panel seams and a
Hungarian knot at the small of the back; twisted shoulder cords; crimson armhole piping; laced
rear sleeve seams; crimson pointed cuffs with double silver braid and a Hungarian knot above
the point; barrel sash with silver barrels and a tasselled knot at the left hip; black pouch
belt over the left shoulder with shield plate, chains and prickers; crowned-cypher cartridge
pouch on the back; and a pelisse slung over the left shoulder, with fur trim, its own frogging
and an empty hanging sleeve. Folds sit at the shoulders, elbows and waist.

**Breeches (pants):** navy breeches with Hungarian spearhead knots on both thighs; a crimson
side stripe edged in silver; folds at the hips and knees; heart-topped hussar boots with silver
edging and a front tassel; polished leather highlights, ankle creases, side seams, heel block,
welt, leather soles, spurs with straps and rowels; and a sabretache with a crowned cypher on
the left leg. Without a shirt, the pants torso shows a linen shirt with braces.

## Editing through code

Everything is defined at the top of the `<script>` in `index.html`:

- `PRESETS` sets colour schemes. The Brelois colours are provisional proposals, not
  established Austerian canon.
- `DEFAULT_OPTIONS` turns the pelisse, pouch belt, sash and sabretache on or off, and sets the
  cuff point (`front` or historically strict `outer`), bare hands or gloves, braid rows and the
  cloth grain seed. The same seed always gives byte-identical PNGs.
- The **Copy as JSON** button exports the current settings in the same shape.

## Template mapping

`UV` in `index.html` holds the face rectangles measured from the official template.
Torso: up `231,8`, right `165,74`, front `231,74`, left `361,74`, back `427,74`,
down `231,204`. Right limb: L `19`, B `85`, R `151`, F `217` (y `355`), U/D above and below
F. Left limb: F `308`, L `374`, B `440`, R `506`, U/D above and below F. Pants use the same
rectangles, with the legs in the arm slots.

Each body part is painted on one continuous "wrap strip" (R|F|L|B for the torso,
F|outer|B|inner for a limb), so braid, belts, cuffs and boot tops line up across the edges
before the strip is sliced into the template. The right limb is the exact mirror of the left
limb's strip, so decorations never appear reversed and every height matches. Each face also
bleeds one pixel into the template gutter so texture filtering cannot open a seam. Pixels
outside the faces stay fully transparent, and the hands are left transparent so the avatar's
skin shows.

## Regenerating the PNGs headlessly

```sh
npm i -D playwright && npx playwright install chromium
node tools/export-pngs.mjs                  # writes the two PNGs next to index.html
node tools/export-pngs.mjs out/ cfg.json    # cfg.json: {"colors": {...}, "options": {...}}
```
