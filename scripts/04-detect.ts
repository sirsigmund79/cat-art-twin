// Phase 2b: OWL-ViT "a cat" boxes for every image above CLASSIFY_MIN.
// Writes data/detections.json (raw results, for resuming), data/crops.json and data/crops/<source>-<id>-<n>.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { cutCrop, loadCatDetector, padBox, toRawImage, type Detection } from './lib/models.ts';
import { forEachWithCheckpoint, readJson, writeJson } from './lib/io.ts';
import { CROPS, CROP_RECORDS, DETECTIONS, SCORES, imagePath } from './lib/paths.ts';
import { CLASSIFY_MIN, CROP_PAD, CROP_SIZE, DETECT_BEST_MIN, DETECT_MIN, FALLBACK_MIN } from './lib/thresholds.ts';
import type { CropRecord, ScoreRecord } from './lib/types.ts';

async function main() {
  const scores = readJson<Record<string, ScoreRecord>>(SCORES, {});
  const detections = readJson<Record<string, Detection[]>>(DETECTIONS, {});
  // Images detected on an earlier run stay candidates even if a rescore dropped them below
  // CLASSIFY_MIN, so their crop IDs (and any review decisions on them) don't disappear.
  const candidates = Object.entries(scores)
    .filter(([key, s]) => s.catScore >= CLASSIFY_MIN || detections[key])
    .map(([key]) => key);
  const todo = candidates.filter((k) => !detections[k]);
  console.log(`${candidates.length} candidates (catScore >= ${CLASSIFY_MIN}), ${todo.length} still to detect`);

  if (todo.length) {
    const detect = await loadCatDetector();
    await forEachWithCheckpoint(
      todo,
      async (key) => {
        // Keep boxes down to DETECT_BEST_MIN; the thresholds are applied below, so they can change without re-detecting.
        detections[key] = await detect(await toRawImage(imagePath(key)), Math.min(DETECT_MIN, DETECT_BEST_MIN));
      },
      () => writeJson(DETECTIONS, detections),
      25,
    );
  }

  // Rebuild crops from detections every run, so threshold changes don't need re-detection.
  fs.mkdirSync(CROPS, { recursive: true });
  const crops: CropRecord[] = [];
  let fallbacks = 0;
  let bestOnly = 0;
  for (const key of candidates) {
    const catScore = scores[key].catScore;
    const all = detections[key] ?? [];
    let boxes = all.filter((d) => d.score >= DETECT_MIN);
    if (!boxes.length) {
      const best = all.reduce<Detection | null>((b, d) => (d.score >= DETECT_BEST_MIN && d.score > (b?.score ?? 0) ? d : b), null);
      if (best) {
        boxes = [best];
        bestOnly++;
      }
    }
    if (boxes.length) {
      boxes.forEach((d, n) =>
        crops.push({ cropId: `${key}-${n}`, artworkId: key, box: d.box, detScore: d.score, catScore, fallback: false }),
      );
    } else if (catScore >= FALLBACK_MIN) {
      fallbacks++;
      crops.push({ cropId: `${key}-full`, artworkId: key, box: null, detScore: null, catScore, fallback: true });
    }
  }
  for (const c of crops) {
    const file = path.join(CROPS, `${c.cropId}.jpg`);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, await cutCrop(imagePath(c.artworkId), c.box && padBox(c.box, CROP_PAD), CROP_SIZE));
  }
  writeJson(CROP_RECORDS, crops, true);

  const artworksWithCrops = new Set(crops.map((c) => c.artworkId)).size;
  console.log(
    `${crops.length} crops from ${artworksWithCrops} images (DETECT_MIN ${DETECT_MIN}); ` +
      `${bestOnly} images kept only their best box (>= ${DETECT_BEST_MIN}); ` +
      `${fallbacks} whole-image fallbacks (catScore >= ${FALLBACK_MIN}, no box).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
