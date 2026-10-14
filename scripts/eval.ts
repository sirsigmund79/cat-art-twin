// Phase 6: run the browser's scoring over eval/photos/ under each setting and write eval/report.html.
// Photos (JPEG, PNG, WebP, HEIC...) are auto-cropped to the best OWL-ViT cat box, standing in for
// the visitor's drag box. The summary table measures variety: if the same few images win for every
// photo, "distinct in top 3" is low and "most common #1" is high.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SCORING } from '../shared/config.ts';
import { Int8Index, makeCentering, rank, type CenterMode, type Match } from '../shared/score.ts';
import type { SiteMeta } from '../shared/types.ts';
import { readUprightImage } from './lib/heic.ts';
import { cutCrop, loadCatDetector, loadClipVision, padBox, toRawImage } from './lib/models.ts';
import { paletteOfFile } from './lib/palette.ts';
import { EVAL_PHOTOS, ROOT, SITE_PUBLIC } from './lib/paths.ts';
import { CROP_PAD } from './lib/thresholds.ts';

interface Setting {
  adjust: boolean;
  center: CenterMode;
  w: number;
}
const SETTINGS: Setting[] = (['off', 'global', 'kind'] as const).flatMap((center) =>
  [false, true].flatMap((adjust) => [1, 0.85].map((w) => ({ center, adjust, w }))),
);
const TOP = 3;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const label = (s: Setting) => `center ${s.center}<br>adjust ${s.adjust ? 'on' : 'off'}<br>w ${s.w}`;
const isDefault = (s: Setting) =>
  s.adjust === DEFAULT_SCORING.adjust && s.center === DEFAULT_SCORING.center && s.w === DEFAULT_SCORING.w;

async function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(SITE_PUBLIC, 'meta.json'), 'utf8')) as SiteMeta;
  const index = new Int8Index(new Int8Array(fs.readFileSync(path.join(SITE_PUBLIC, 'index.bin'))), meta.dim);
  if (!meta.means) console.warn('meta.json has no means; rerun npm run build:index to test centering.');
  const palettes = meta.items.map((i) => i.colors);
  const centerings = { off: undefined, global: makeCentering(meta, 'global'), kind: makeCentering(meta, 'kind') };
  const photos = fs.readdirSync(EVAL_PHOTOS).filter((f) => /\.(jpe?g|png|webp|avif|tiff?|heic|heif)$/i.test(f));
  if (!photos.length) throw new Error(`Put some cat photos in ${EVAL_PHOTOS} first.`);

  const outDir = path.join(ROOT, 'eval', 'report');
  fs.mkdirSync(outDir, { recursive: true });
  const detect = await loadCatDetector();
  const embed = await loadClipVision();

  const results: Match[][][] = []; // [photo][setting] -> top matches
  const rows: string[] = [];
  for (const photo of photos) {
    let upright: Buffer;
    try {
      upright = await readUprightImage(path.join(EVAL_PHOTOS, photo));
    } catch (err) {
      console.warn(`  skipping ${photo}: ${(err as Error).message}`);
      continue;
    }
    const [best] = await detect(await toRawImage(upright), 0.1);
    const crop = await cutCrop(upright, best ? padBox(best.box, CROP_PAD) : null, 512);
    const cropName = `${path.parse(photo).name}.jpg`;
    fs.writeFileSync(path.join(outDir, cropName), crop);
    const [vec] = await embed([await toRawImage(crop)]);
    const photoPalette = await paletteOfFile(crop);

    const perSetting = SETTINGS.map((s) =>
      rank(vec, index, {
        adjust: s.adjust,
        w: s.w,
        center: centerings[s.center],
        topK: TOP,
        textPhoto: meta.textPhoto,
        textPainting: meta.textPainting,
        photoPalette,
        palettes,
      }),
    );
    results.push(perSetting);
    const cells = perSetting.map((top, si) => {
      const imgs = top
        .map((m) => {
          const item = meta.items[m.index];
          const tip = `${item.title} — ${item.artist} ${item.date} (${item.kind})\nscore ${m.score.toFixed(3)} clip ${m.clip.toFixed(3)} color ${m.color.toFixed(3)}`;
          return `<img src="../site/public/${item.crop}" title="${esc(tip)}">`;
        })
        .join('');
      return `<td${isDefault(SETTINGS[si]) ? ' class="default"' : ''}>${imgs}</td>`;
    });
    rows.push(
      `<tr><th><img src="report/${cropName}"><br>${esc(photo)}${best ? '' : '<br><em>no box found</em>'}</th>${cells.join('')}</tr>`,
    );
    console.log(`  ${photo}`);
  }

  // Variety per setting across all photos.
  const n = results.length;
  const summary = SETTINGS.map((s, si) => {
    const distinct = new Set(results.flatMap((r) => r[si].map((m) => m.index))).size;
    const firsts = new Map<number, number>();
    for (const r of results) firsts.set(r[si][0].index, (firsts.get(r[si][0].index) ?? 0) + 1);
    const hub = Math.max(...firsts.values());
    const photosShare = results.flatMap((r) => r[si]).filter((m) => meta.items[m.index].kind === 'photo').length / (n * TOP);
    return { s, distinct, hub, photosShare };
  });
  const head = SETTINGS.map((s) => `<th${isDefault(s) ? ' class="default"' : ''}>${label(s)}</th>`).join('');
  const sumRow = (name: string, f: (x: (typeof summary)[number]) => string) =>
    `<tr><th>${name}</th>${summary.map((x) => `<td${isDefault(x.s) ? ' class="default"' : ''}>${f(x)}</td>`).join('')}</tr>`;

  const html = `<!doctype html><meta charset="utf-8"><title>Cat twin eval</title>
<style>body{font:13px system-ui;margin:16px}table{border-collapse:collapse;margin-bottom:24px}td,th{border:1px solid #ddd;padding:4px;vertical-align:top;text-align:center}
th img{width:130px}td img{width:64px;height:64px;object-fit:cover;margin:1px}.default{background:#ffe9a8}.sum td{font-size:15px}</style>
<h1>Eval: ${n} photos, top ${TOP} per setting</h1>
<p>Highlighted column is the current default. <b>center</b>: subtract average fingerprints (off, one overall average,
or separate photo/art averages). <b>adjust</b>: shift photos toward "painting". <b>w</b>: share of CLIP vs color.
Hover a match for its scores.</p>
<table class="sum"><tr><th></th>${head}</tr>
${sumRow(`Distinct images in top ${TOP} (max ${n * TOP}; higher = more variety)`, (x) => String(x.distinct))}
${sumRow('Photos sharing the most common #1 (lower is better)', (x) => `${x.hub} / ${n}`)}
${sumRow(`Share of photos (vs art) in top ${TOP}`, (x) => `${Math.round(x.photosShare * 100)}%`)}
</table>
<table><tr><th>Photo</th>${head}</tr>${rows.join('\n')}</table>`;
  fs.writeFileSync(path.join(ROOT, 'eval', 'report.html'), html);
  console.log(`Wrote eval/report.html (${n} photos x ${SETTINGS.length} settings)`);
  for (const x of summary) {
    console.log(
      `  center ${x.s.center.padEnd(6)} adjust ${x.s.adjust ? 'on ' : 'off'} w ${String(x.s.w).padEnd(4)}: ` +
        `${String(x.distinct).padStart(3)} distinct, top-1 hub ${x.hub}/${n}, ${Math.round(x.photosShare * 100)}% photos`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
