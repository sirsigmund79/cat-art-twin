# Cat Art Twin

Upload a photo of your cat and find the cat in centuries of public-domain museum art that looks most like it,
with a side-by-side image to share. Matching runs entirely in the visitor's browser: the photo never leaves
the device, and the whole thing is a static site.

The heavy lifting happens once, offline: scrape museum open-access APIs, filter and crop the cats, review them
by hand, embed them with CLIP and ship a small index. The site runs the same CLIP model in the browser with
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

## Pipeline

Every step can be stopped and re-run; it picks up where it left off.

| Phase | Command | Output |
| --- | --- | --- |
| 1. Scrape | `npm run fetch` (or `npm run fetch -- met aic`) | `data/raw/<source>.jsonl` |
| | `npm run download` | `data/images/<source>-<id>.jpg` (800px), `data/download-failures.jsonl` |
| 2. Filter and crop | `npm run classify` | `data/scores.json` (CLIP "artwork of a cat" vs decoys) |
| | `npm run detect` | `data/crops/*.jpg`, `data/crops.json` |
| | `npm run contact-sheet` | `data/contact-sheet.html`: 100 random crops + near-threshold rejects |
| 3. Hand review | `npm run review` | `data/review.json` |
| 4. Embed and index | `npm run embed` | `data/final/*.jpg`, `data/embeddings.json` (int8) |
| | `npm run colors` | `data/colors.json` |
| | `npm run build:index` | `site/public/index.bin`, `site/public/meta.json`, `site/public/crops/` |
| 6. Tune | `npm run eval` | `eval/report.html` |

Thresholds for Phase 2 live in `scripts/lib/thresholds.ts`. `npm run detect` rebuilds the crop list from saved
detections on every run, so changing `DETECT_MIN` or `FALLBACK_MIN` doesn't re-run the detector.

### Review tool

`npm run review`, then open <http://localhost:5174>. Crops are sorted by `catScore`, least confident first.

| Key | Action |
| --- | --- |
| Arrow keys | Move |
| `K` / `X` / `S` | Keep / reject / star (starred crops are featured on the landing page) |
| `U` | Clear the decision |
| `R` | Fix the crop: drag a new box on the full artwork, `Enter` to save |
| `PgUp` / `PgDn` | Previous / next page |
| Click, shift-click, ⌘/ctrl-click | Select; with a selection, `K`/`X`/`S` apply to all of it |

"Reject rest of page" rejects every undecided crop on the page. The Rescue tab lists images that produced no
crop, most cat-like first; keeping one adds the whole image (press `R` to box the cat). Hover or focus a tile to
see the full artwork. Every decision is saved immediately. Anything left undecided counts as rejected.

## Site

```sh
npm run dev       # http://localhost:5173
npm run build     # -> dist/
npm run preview   # serve dist/ on http://localhost:4173
```

On load the page starts downloading the CLIP vision model (about 90 MB at q8; the browser caches it) and the
index. The visitor picks a photo, drags a box around the cat, and gets the top 10 matches, ranked by

```
score = cosine(adjusted photo embedding, art) * w + colorSimilarity * (1 - w)
adjusted = normalize(photo - text("a photo of a cat") + text("a painting of a cat"))
```

The two text embeddings are precomputed into `meta.json`, so the browser only needs the vision model. Defaults
(`adjust`, `w`) are in `shared/config.ts`; `npm run eval` writes a report comparing adjustment on/off and
`w` in {1, 0.85, 0.7} over the photos in `eval/photos/`, to pick them.

The model runs on WebGPU when available and falls back to WASM. Offline embeddings use the same q8 weights as
the WASM path.

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

Artworks come from the open-access programs of The Metropolitan Museum of Art, the Art Institute of Chicago and
the Cleveland Museum of Art, filtered to public-domain (CC0) works. Every match links to the museum's object page.
