// Phase 4b: a small color palette per final crop (k-means in Lab on the central region) -> data/colors.json.
import path from 'node:path';
import type { PaletteColor } from '../shared/types.ts';
import { loadKept } from './lib/kept.ts';
import { readJson, writeJson } from './lib/io.ts';
import { COLORS, EMBEDDINGS, FINAL } from './lib/paths.ts';
import { paletteOfFile } from './lib/palette.ts';
import type { EmbeddingRecord } from './lib/types.ts';

async function main() {
  const embeddings = readJson<Record<string, EmbeddingRecord>>(EMBEDDINGS, {});
  const colors = readJson<Record<string, { box: string; palette: PaletteColor[] }>>(COLORS, {});
  const kept = loadKept();
  let computed = 0;
  for (const k of kept) {
    const box = embeddings[k.cropId]?.box;
    if (!box) throw new Error(`${k.cropId} has no embedding; run 05-embed first`);
    if (colors[k.cropId]?.box === box) continue;
    colors[k.cropId] = { box, palette: await paletteOfFile(path.join(FINAL, `${k.cropId}.jpg`)) };
    computed++;
  }
  const keptIds = new Set(kept.map((k) => k.cropId));
  for (const id of Object.keys(colors)) if (!keptIds.has(id)) delete colors[id];
  writeJson(COLORS, colors);
  console.log(`Palettes: ${computed} computed, ${kept.length - computed} unchanged`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
