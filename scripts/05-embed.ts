// Phase 4a: CLIP image embeddings for every kept crop (with corrected boxes), L2-normalized and int8-quantized.
// Also cuts the final crops into data/final/. Re-embeds a crop only when its box changed.
import fs from 'node:fs';
import path from 'node:path';
import { quantizeInt8 } from '../shared/score.ts';
import { boxKey, loadKept } from './lib/kept.ts';
import { cutCrop, loadClipVision, toRawImage } from './lib/models.ts';
import { forEachWithCheckpoint, readJson, writeJson } from './lib/io.ts';
import { EMBEDDINGS, FINAL, imagePath } from './lib/paths.ts';
import { CROP_SIZE } from './lib/thresholds.ts';
import type { EmbeddingRecord } from './lib/types.ts';

const BATCH = 16;

async function main() {
  const kept = loadKept();
  if (!kept.length) throw new Error('No kept crops in data/review.json. Finish the review (Phase 3) first.');
  const embeddings = readJson<Record<string, EmbeddingRecord>>(EMBEDDINGS, {});
  const keptIds = new Set(kept.map((k) => k.cropId));
  for (const id of Object.keys(embeddings)) if (!keptIds.has(id)) delete embeddings[id];

  fs.mkdirSync(FINAL, { recursive: true });
  const todo = kept.filter(
    (k) => embeddings[k.cropId]?.box !== boxKey(k.box) || !fs.existsSync(path.join(FINAL, `${k.cropId}.jpg`)),
  );
  console.log(`${kept.length} kept crops, ${todo.length} to embed`);

  if (todo.length) {
    const embed = await loadClipVision();
    const batches = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    await forEachWithCheckpoint(
      batches,
      async (batch) => {
        const bufs = await Promise.all(batch.map((k) => cutCrop(imagePath(k.artworkId), k.box, CROP_SIZE)));
        batch.forEach((k, i) => fs.writeFileSync(path.join(FINAL, `${k.cropId}.jpg`), bufs[i]));
        const vecs = await embed(await Promise.all(bufs.map((b) => toRawImage(b))));
        batch.forEach((k, i) => {
          embeddings[k.cropId] = { box: boxKey(k.box), vec: Array.from(quantizeInt8(vecs[i])) };
        });
      },
      () => writeJson(EMBEDDINGS, embeddings),
      5,
    );
  }
  writeJson(EMBEDDINGS, embeddings);
  console.log(`${Object.keys(embeddings).length} embeddings in ${EMBEDDINGS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
