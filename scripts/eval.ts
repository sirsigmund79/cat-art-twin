// Phase 6: run the browser's scoring over eval/photos/ under each setting and write eval/report.html.
// Photos are auto-cropped to the best OWL-ViT cat box, standing in for the visitor's drag box.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SCORING } from '../shared/config.ts';
import { Int8Index, rank } from '../shared/score.ts';
import type { SiteMeta } from '../shared/types.ts';
import { cutCrop, loadCatDetector, loadClipVision, padBox, toRawImage } from './lib/models.ts';
import { paletteOfFile } from './lib/palette.ts';
import { EVAL_PHOTOS, ROOT, SITE_PUBLIC } from './lib/paths.ts';
import { CROP_PAD } from './lib/thresholds.ts';

const SETTINGS = [true, false].flatMap((adjust) => [1, 0.85, 0.7].map((w) => ({ adjust, w })));
const TOP = 5;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(SITE_PUBLIC, 'meta.json'), 'utf8')) as SiteMeta;
  const index = new Int8Index(new Int8Array(fs.readFileSync(path.join(SITE_PUBLIC, 'index.bin'))), meta.dim);
  const palettes = meta.items.map((i) => i.colors);
  const photos = fs.readdirSync(EVAL_PHOTOS).filter((f) => /\.(jpe?g|png|webp|heic|avif)$/i.test(f));
  if (!photos.length) throw new Error(`Put some cat photos in ${EVAL_PHOTOS} first.`);

  const outDir = path.join(ROOT, 'eval', 'report');
  fs.mkdirSync(outDir, { recursive: true });
  const detect = await loadCatDetector();
  const embed = await loadClipVision();

  const rows: string[] = [];
  for (const photo of photos) {
    const file = path.join(EVAL_PHOTOS, photo);
    const [best] = await detect(await toRawImage(file), 0.1);
    const crop = await cutCrop(file, best ? padBox(best.box, CROP_PAD) : null, 512);
    const cropName = `${path.parse(photo).name}.jpg`;
    fs.writeFileSync(path.join(outDir, cropName), crop);
    const [vec] = await embed([await toRawImage(crop)]);
    const photoPalette = await paletteOfFile(crop);

    const cells = SETTINGS.map((s) => {
      const top = rank(vec, index, {
        ...s,
        topK: TOP,
        textPhoto: meta.textPhoto,
        textPainting: meta.textPainting,
        photoPalette,
        palettes,
      });
      const imgs = top
        .map((m) => {
          const item = meta.items[m.index];
          const tip = `${item.title} — ${item.artist} ${item.date}\nscore ${m.score.toFixed(3)} clip ${m.clip.toFixed(3)} color ${m.color.toFixed(3)}`;
          return `<img src="../site/public/${item.crop}" title="${esc(tip)}">`;
        })
        .join('');
      return `<td>${imgs}</td>`;
    });
    rows.push(
      `<tr><th><img src="report/${cropName}"><br>${esc(photo)}${best ? '' : '<br><em>no box found</em>'}</th>${cells.join('')}</tr>`,
    );
    console.log(`  ${photo}`);
  }

  const isDefault = (s: (typeof SETTINGS)[number]) => s.adjust === DEFAULT_SCORING.adjust && s.w === DEFAULT_SCORING.w;
  const head = SETTINGS.map(
    (s) => `<th${isDefault(s) ? ' class="default"' : ''}>adjust ${s.adjust ? 'on' : 'off'}<br>w = ${s.w}</th>`,
  ).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Cat Art Twin eval</title>
<style>body{font:13px system-ui;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px;vertical-align:top}
th img{width:150px}td img{width:72px;height:72px;object-fit:cover;margin:1px}td{width:${TOP * 74}px}.default{background:#ffe9a8}</style>
<h1>Eval: top ${TOP} per setting</h1><p>Highlighted column is the current default. Hover a match for its scores.</p>
<table><tr><th>Photo</th>${head}</tr>${rows.join('\n')}</table>`;
  fs.writeFileSync(path.join(ROOT, 'eval', 'report.html'), html);
  console.log(`Wrote eval/report.html (${photos.length} photos x ${SETTINGS.length} settings)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
