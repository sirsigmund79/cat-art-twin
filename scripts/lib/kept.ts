import { padBox } from './models.ts';
import { readJson } from './io.ts';
import { CROP_RECORDS, REVIEW } from './paths.ts';
import { AUTO_KEEP_CAT, AUTO_KEEP_DET, CROP_PAD } from './thresholds.ts';
import type { Box, CropRecord, ReviewEntry, ReviewFile } from './types.ts';

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

/** Crops the reviewer kept or starred, plus auto-kept ones. Anything else undecided counts as rejected. */
export function loadKept(): KeptCrop[] {
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
