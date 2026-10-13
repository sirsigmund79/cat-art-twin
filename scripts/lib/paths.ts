import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA = path.join(ROOT, 'data');
export const RAW = path.join(DATA, 'raw');
export const CACHE = path.join(DATA, 'cache');
export const IMAGES = path.join(DATA, 'images');
export const CROPS = path.join(DATA, 'crops');
/** Crops regenerated from kept review decisions (with corrected boxes); these ship with the site. */
export const FINAL = path.join(DATA, 'final');
export const SCORES = path.join(DATA, 'scores.json');
export const DETECTIONS = path.join(DATA, 'detections.json');
export const CROP_RECORDS = path.join(DATA, 'crops.json');
export const REVIEW = path.join(DATA, 'review.json');
export const EMBEDDINGS = path.join(DATA, 'embeddings.json');
export const COLORS = path.join(DATA, 'colors.json');
export const SITE_PUBLIC = path.join(ROOT, 'site', 'public');
export const EVAL_PHOTOS = path.join(ROOT, 'eval', 'photos');

export function imagePath(key: string): string {
  return path.join(IMAGES, `${key}.jpg`);
}
