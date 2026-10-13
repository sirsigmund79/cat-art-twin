import { converter, formatHex } from 'culori';
import { kmeans } from 'ml-kmeans';
import { PALETTE_CENTER, PALETTE_SIZE } from './config.ts';
import type { PaletteColor } from './types.ts';

const toLab = converter('lab');
const toRgb = converter('rgb');

/**
 * Dominant colors of the central region of an RGBA image, by k-means in CIELAB.
 * Works on raw pixels so the same code runs on sharp output (Node) and canvas ImageData (browser).
 */
export function dominantColors(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  k = PALETTE_SIZE,
  center = PALETTE_CENTER,
): PaletteColor[] {
  const x0 = Math.floor((width * (1 - center)) / 2);
  const y0 = Math.floor((height * (1 - center)) / 2);
  const x1 = width - x0;
  const y1 = height - y0;
  // Subsample to about 4,000 pixels; plenty for a 4-color palette.
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
  const points: number[][] = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 128) continue;
      const lab = toLab({ mode: 'rgb', r: rgba[i] / 255, g: rgba[i + 1] / 255, b: rgba[i + 2] / 255 });
      points.push([lab.l, lab.a, lab.b]);
    }
  }
  if (points.length === 0) return [];
  const clusters = Math.min(k, points.length);
  const result = kmeans(points, clusters, { initialization: 'kmeans++', seed: 42, maxIterations: 50 });
  const counts = new Array(clusters).fill(0);
  for (const c of result.clusters) counts[c]++;
  const palette: PaletteColor[] = [];
  result.centroids.forEach((c, i) => {
    if (!counts[i]) return;
    const lab: [number, number, number] = [round1(c[0]), round1(c[1]), round1(c[2])];
    const hex = formatHex(toRgb({ mode: 'lab', l: lab[0], a: lab[1], b: lab[2] }));
    palette.push({ lab, hex, weight: Math.round((counts[i] / points.length) * 1000) / 1000 });
  });
  return palette.sort((a, b) => b.weight - a.weight);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
