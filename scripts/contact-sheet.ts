// Phase 2 checkpoint: data/contact-sheet.html with 100 random crops and 100 near-threshold rejects.
// Open it straight from disk (paths are relative to data/).
import fs from 'node:fs';
import path from 'node:path';
import { loadArtworks, readJson } from './lib/io.ts';
import { CROP_RECORDS, DATA, DETECTIONS, SCORES } from './lib/paths.ts';
import { CLASSIFY_MIN, DETECT_MIN } from './lib/thresholds.ts';
import type { CropRecord, ScoreRecord } from './lib/types.ts';
import type { Detection } from './lib/models.ts';

const N = 100;

function sample<T>(xs: T[], n: number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function main() {
  const crops = readJson<CropRecord[]>(CROP_RECORDS, []);
  const scores = readJson<Record<string, ScoreRecord>>(SCORES, {});
  const detections = readJson<Record<string, Detection[]>>(DETECTIONS, {});
  const artworks = loadArtworks();

  // Rejected by the classifier, closest to the threshold first.
  const classifierRejects = Object.entries(scores)
    .filter(([, s]) => s.catScore < CLASSIFY_MIN)
    .sort((a, b) => b[1].catScore - a[1].catScore)
    .slice(0, N / 2)
    .map(([key, s]) => ({ img: `images/${key}.jpg`, label: `catScore ${s.catScore.toFixed(3)}`, key }));
  // Images that passed the classifier but produced no crop despite having a (weak) box.
  const cropped = new Set(crops.map((c) => c.artworkId));
  const detectorRejects = Object.entries(detections)
    .filter(([key, d]) => !cropped.has(key) && d.length)
    .map(([key, d]) => ({ key, best: Math.max(...d.map((x) => x.score)) }))
    .sort((a, b) => b.best - a.best)
    .slice(0, N - classifierRejects.length)
    .map(({ key, best }) => ({ img: `images/${key}.jpg`, label: `best box ${best.toFixed(3)}`, key }));

  const tile = (img: string, label: string, key: string) =>
    `<figure><img loading="lazy" src="${img}"><figcaption>${esc(label)}<br>${esc(artworks.get(key)?.title ?? key)}</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><title>Contact sheet</title>
<style>body{font:13px system-ui;margin:16px}div{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
figure{margin:0}img{width:100%;height:160px;object-fit:contain;background:#eee}figcaption{color:#555;overflow:hidden;max-height:3.2em}</style>
<h1>Contact sheet</h1>
<p>CLASSIFY_MIN ${CLASSIFY_MIN}, DETECT_MIN ${DETECT_MIN}. ${crops.length} crops in total.</p>
<h2>${Math.min(N, crops.length)} random crops</h2><div>
${sample(crops, N).map((c) => tile(`crops/${c.cropId}.jpg`, `cat ${c.catScore.toFixed(2)} · det ${c.detScore?.toFixed(2) ?? 'fallback'}`, c.artworkId)).join('\n')}
</div>
<h2>${classifierRejects.length} classifier rejects nearest the threshold</h2><div>
${classifierRejects.map((r) => tile(r.img, r.label, r.key)).join('\n')}
</div>
<h2>${detectorRejects.length} detector rejects nearest the threshold</h2><div>
${detectorRejects.map((r) => tile(r.img, r.label, r.key)).join('\n')}
</div>`;
  const out = path.join(DATA, 'contact-sheet.html');
  fs.writeFileSync(out, html);
  console.log(`Wrote ${out}`);
}

main();
