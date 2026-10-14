# What creature is your cat?

Upload a photo of your cat and find the creature in centuries of paintings, prints and old photographs that
looks most like it: a Dutch still-life owl, a fox from a Japanese print, a medieval lion, or a painted cat.
A side-by-side image is ready to share. Matching runs entirely in the visitor's browser: the photo never leaves
the device, and the whole thing is a static site.

The heavy lifting happens once, offline: collect openly licensed historical images from museum and image APIs,
filter and crop the animals, review the uncertain ones by hand, embed them with CLIP and ship a small index. The site runs the same CLIP model in the browser with
[Transformers.js](https://github.com/huggingface/transformers.js).

Built on open source:

| Job | Library |
| --- | --- |
| Image embeddings (offline and in the browser) | [CLIP ViT-B/32](https://huggingface.co/openai/clip-vit-base-patch32) via Transformers.js (`Xenova/clip-vit-base-patch32`) |
| Finding cats in artworks | [OWL-ViT](https://huggingface.co/google/owlvit-base-patch32) zero-shot detection via Transformers.js |
| Image decoding, resizing, cropping | [sharp](https://sharp.pixelplumbing.com/) |
| Color palettes | [culori](https://culorijs.org/) (Lab conversion) + [ml-kmeans](https://github.com/mljs/kmeans) |
| Crop boxes (site and review tool) | [Cropper.js](https://github.com/fengyuanchen/cropperjs) |
| iPhone HEIC photos in browsers that can't open them | [heic-to](https://github.com/hoppergee/heic-to) (libheif, LGPL-3.0), loaded only when needed |
| Site build | [Vite](https://vite.dev/) |
| Smoke test | [Playwright](https://playwright.dev/) |

## Layout

```
scripts/        pipeline steps (numbered, each idempotent and resumable)
scripts/lib/    shared pipeline code: paths, HTTP retry, model loaders, thresholds
shared/         code used by both the pipeline and the browser: scoring, palettes, config
review/         local review tool (static page + tiny Node server)
site/           Vite app; site/public/ receives index.bin, meta.json, crops/
eval/photos/    your own cat photos for tuning (gitignored)
data/           pipeline working files (gitignored)
tests/          unit tests (node:test) and the Playwright smoke test
```

## Setup

Node 20+.

```sh
npm install
```

The pipeline needs outbound HTTPS to `collectionapi.metmuseum.org`, `images.metmuseum.org`, `api.artic.edu`,
`www.artic.edu`, `openaccess-api.clevelandart.org`, `openaccess-cdn.clevelandart.org` and `huggingface.co`
(model weights, a few hundred MB on first run, then cached). Quick check:

```sh
curl -sI "https://collectionapi.metmuseum.org/public/collection/v1/search?q=cat" | head -1
curl -sI "https://api.artic.edu/api/v1/artworks/search?q=cat" | head -1
curl -sI "https://openaccess-api.clevelandart.org/api/artworks/?q=cat&limit=1" | head -1
curl -sI "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/config.json" | head -1
```

Behind an HTTPS proxy, set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses `HTTPS_PROXY`. If huggingface.co itself is
unreachable, set `HF_ENDPOINT` to a Hugging Face mirror.

## Sources and licenses

Only historical works go on the site: dated before 1960 (`HISTORICAL_BEFORE` in `shared/config.ts`), or undated
but from a museum or old-book source, or undated and judged old-looking by CLIP (`scripts/lib/historical.ts`).
Modern items are skipped by detection, hidden from review and left out of the index.

| Source | What | Key |
| --- | --- | --- |
| The Met, Art Institute of Chicago, Cleveland Museum of Art | Public-domain museum art of cats and other animals. The Met is slow (one request per object), so its animal terms only run with `MET_ANIMALS=1` | None |
| [Wikidata](https://www.wikidata.org) | Paintings, drawings and prints tagged with the animal they depict; images and licenses from Wikimedia Commons | None |
| [Wikimedia Commons](https://commons.wikimedia.org) | The "Animals in art" and "Cats in art" category trees, and files depicting a house cat | None |
| [Biodiversity Heritage Library](https://www.flickr.com/photos/biodivlibrary/) | Public-domain natural-history illustrations, via Flickr | `FLICKR_API_KEY`, free at <https://www.flickr.com/services/apps/create/> |
| [Europeana](https://www.europeana.eu) | Images of animals from thousands of European museums and archives, dated before 1960 | `EUROPEANA_API_KEY`, free at <https://pro.europeana.eu/page/get-api> |
| [Flickr](https://www.flickr.com) search | Creative Commons cat photos, mostly modern; only with `npm run fetch -- flickr` | `FLICKR_API_KEY` |

`npm run fetch` uses every source above except Flickr search, skipping ones whose key isn't set. Set keys for one
session in Command Prompt with `set FLICKR_API_KEY=...` (PowerShell: `$env:FLICKR_API_KEY="..."`,
macOS/Linux: `export FLICKR_API_KEY=...`). Caps keep runs manageable: `WIKIDATA_MAX` (default 15000),
`COMMONS_MAX` (8000), `BHL_MAX` (6000), `EUROPEANA_MAX` (3000), `FLICKR_MAX` (5000).

Accepted licenses: public domain, CC0, CC BY, CC BY-SA, CC BY-NC and CC BY-NC-SA (`scripts/lib/licenses.ts`).
NoDerivatives licenses are refused, since the site shows crops. Every match on the site credits its creator,
license (linked) and source. NonCommercial images mean the site itself must stay non-commercial: no ads, no paid
features.

## Pipeline

Every step can be stopped and re-run; it picks up where it left off.

| Phase | Command | Output |
| --- | --- | --- |
| 1. Scrape | `npm run fetch` (or `npm run fetch -- met aic`) | `data/raw/<source>.jsonl` |
| | `npm run download` | `data/images/<source>-<id>.jpg` (800px), `data/download-failures.jsonl` |
| 2. Filter and crop | `npm run classify` | `data/scores.json` (CLIP "artwork or photo of an animal" vs decoys, photo/art, old/modern look) |
| | `npm run detect` | `data/crops/*.jpg`, `data/crops.json` (OWL-ViT animal boxes, historical images only) |
| | `npm run contact-sheet` | `data/contact-sheet.html`: 100 random crops + near-threshold rejects |
| 3. Hand review | `npm run review` | `data/review.json` |
| 4. Embed and index | `npm run embed` | `data/final/*.jpg`, `data/embeddings.json` (int8) |
| | `npm run colors` | `data/colors.json` |
| | `npm run build:index` | `site/public/index.bin`, `site/public/meta.json`, `site/public/crops/` |
| 6. Tune | `npm run eval` (after `npm run build:index`) | `eval/report.html` |

Thresholds for Phase 2 live in `scripts/lib/thresholds.ts`. `npm run detect` rebuilds the crop list from saved
detections on every run, so changing `DETECT_MIN` or `FALLBACK_MIN` doesn't re-run the detector. Images
detected before animals were added keep their cat-only boxes, so their crop IDs and review decisions stay valid.
`catScore` is a historical name: it is the probability that an image shows an animal.

### Review tool

`npm run review`, then open <http://localhost:5174>. Crops are sorted by `catScore`, least confident first.

Crops where both models are confident (`catScore` >= 0.9 and detector score >= 0.3, set in
`scripts/lib/thresholds.ts`) are kept without review and listed in the **Auto-kept** tab. Skim it and press `X` on
any mistakes. Explicit decisions always win over auto-keep.

| Key | Action |
| --- | --- |
| Arrow keys | Move |
| `K` / `X` / `S` | Keep / reject / star (starred crops are featured on the landing page) |
| `U` | Clear the decision |
| `R` | Fix the crop: drag a new box on the full artwork, `Enter` to save |
| `PgUp` / `PgDn` | Previous / next page |
| Click, shift-click, ⌘/ctrl-click | Select; with a selection, `K`/`X`/`S` apply to all of it |

"Reject rest of page" rejects every undecided crop on the page. The Rescue tab lists images that produced no
crop, most animal-like first; keeping one adds the whole image (press `R` to box the creature). Only historical
works are listed. Hover or focus a tile to
see the full artwork. Every decision is saved immediately. Anything left undecided in the Review and Rescue tabs counts as rejected.

## Site

```sh
npm run dev       # http://localhost:5173
npm run build     # -> dist/
npm run preview   # serve dist/ on http://localhost:4173
```

On load the page starts downloading the CLIP vision model (about 90 MB at q8; the browser caches it) and the
index. The visitor picks a photo (HEIC is converted in the browser when needed), drags a box around the cat, and
gets the top 10 matches:

1. CLIP turns the crop into a 512-number embedding.
2. `center`: average embeddings are subtracted from the query and every indexed crop, so what all the images
   share stops dominating. `kind` uses separate averages for photos and art (the visitor's photo uses the photo
   average); `global` uses one.
3. `removeSpecies`: the directions CLIP uses to tell species apart (from text embeddings of 60 creature names in
   `scripts/lib/creatures.ts`) are projected out, so matching runs on coloring, markings, pose and expression,
   and a grey cat can match an owl.
4. `score = cosine * w + colorSimilarity * (1 - w)`, comparing small Lab palettes of the central region.

Each crop also gets a creature name (CLIP's best guess among the same 60 names) for "Your cat is an owl".

Defaults live in `shared/config.ts` (center `kind`, species removed, `w` 0.75). An earlier step that shifted
photos toward "a painting" (`adjust`) is off: it added the same large vector to every query, which made the same
few images win for every cat.

`npm run eval` scores the photos in `eval/photos/` (JPEG, PNG, WebP or HEIC) under 7 combinations of these
settings and writes `eval/report.html`: a summary of how varied each setting's results are (distinct images in
the top 3 across all photos, how many photos share the same #1, how many different creatures appear, how often
the #1 isn't a cat) and every photo's top 3 per setting.

### Deploy

`.github/workflows/pages.yml` builds and deploys to GitHub Pages on every push to `main` (enable it under
Settings → Pages → Source: GitHub Actions). The workflow doesn't run the pipeline, so run `npm run build:index`
and commit `site/public/` first.

The build includes the ONNX Runtime WASM file (about 27 MB), which is over Cloudflare Pages' 25 MiB per-file
limit; GitHub Pages has no problem with it.

## Tests

```sh
npm run typecheck
npm test                 # unit tests: scoring, quantization, palettes, boxes
npm run test:e2e         # Playwright: builds, serves, uploads tests/fixtures/cat.jpg, checks the match and share image
BASE_URL=https://your.site npm run test:e2e   # same smoke test against a deployed site
```

The full smoke test needs the built index and access to huggingface.co. To use an existing Chromium instead of
Playwright's download, set `CHROMIUM_PATH`.

## Data and licenses

See [Sources and licenses](#sources-and-licenses). Site thumbnails are 320px WebP crops; every match links to the
work's page at its source.
