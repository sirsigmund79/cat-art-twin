import { isHistorical } from './historical.ts';
import { padBox } from './models.ts';
import { loadArtworks, readJson } from './io.ts';
import { CROP_RECORDS, REVIEW, SCORES } from './paths.ts';
import { AUTO_KEEP_CAT, AUTO_KEEP_DET, CROP_PAD } from './thresholds.ts';
import type { Box, CropRecord, ReviewEntry, ReviewFile, ScoreRecord } from './types.ts';

export interface KeptCrop {
  cropId: string;
  artworkId: string;
  /** Final box to cut (already padded, or the reviewer's box); null = whole image. */
  box: Box | null;
  starred: boolean;
}

/** Confident enough to keep without review, unless the reviewer decided otherwise. */
export function isAutoKeep(crop: CropRecord, entry?: ReviewEntry): boolean {
  return !entry?.decision && !crop.fallback && crop.catScore >= AUTO_KEEP_CAT && (crop.detScore ?? 0) >= AUTO_KEEP_DET;
}

/**
 * Crops the reviewer kept or starred, plus auto-kept ones, limited to historical works.
 * Anything else undecided counts as rejected.
 */
export function loadKept(): KeptCrop[] {
  const artworks = loadArtworks();
  const scores = readJson<Record<string, ScoreRecord>>(SCORES, {});
  const all = loadKeptAnyEra();
  const kept = all.filter((k) => isHistorical(artworks.get(k.artworkId), scores[k.artworkId]));
  if (kept.length < all.length) console.log(`  ${all.length - kept.length} kept crops left out as not historical`);
  return kept;
}

function loadKeptAnyEra(): KeptCrop[] {
  const records = new Map(readJson<CropRecord[]>(CROP_RECORDS, []).map((c) => [c.cropId, c]));
  const review = readJson<ReviewFile>(REVIEW, {});
  const kept: KeptCrop[] = [];
  for (const crop of records.values()) {
    if (isAutoKeep(crop, review[crop.cropId])) {
      kept.push({ cropId: crop.cropId, artworkId: crop.artworkId, box: crop.box && padBox(crop.box, CROP_PAD), starred: false });
    }
  }
  for (const [cropId, entry] of Object.entries(review)) {
    if (entry.decision !== 'keep' && entry.decision !== 'star') continue;
    const rec = records.get(cropId);
    if (!rec && !cropId.endsWith('-full')) {
      console.warn(`  skipping ${cropId}: not in crops.json`);
      continue;
    }
    const artworkId = rec?.artworkId ?? cropId.replace(/-full$/, '');
    const box = entry.box ?? (rec?.box ? padBox(rec.box, CROP_PAD) : null);
    kept.push({ cropId, artworkId, box, starred: entry.decision === 'star' });
  }
  return kept.sort((a, b) => a.cropId.localeCompare(b.cropId));
}

export function boxKey(box: Box | null): string {
  return box ? [box.x, box.y, box.w, box.h].map((v) => v.toFixed(4)).join(',') : 'full';
}
