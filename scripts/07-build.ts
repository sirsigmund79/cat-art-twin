// Phase 4c: write site/public/index.bin, site/public/meta.json and site/public/crops/.
import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { CLIP_DTYPE, CLIP_MODEL, EMBED_DIM, PAINTING_PROMPT, PHOTO_PROMPT } from '../shared/config.ts';
import { SOURCE_NAMES, type MetaItem, type PaletteColor, type SiteMeta } from '../shared/types.ts';
import { normalizeLicense } from './lib/licenses.ts';
import { loadKept } from './lib/kept.ts';
import { loadClipText } from './lib/models.ts';
import { loadArtworks, readJson, writeJson } from './lib/io.ts';
import { COLORS, EMBEDDINGS, FINAL, SCORES, SITE_PUBLIC } from './lib/paths.ts';
import type { EmbeddingRecord, ScoreRecord } from './lib/types.ts';

/** Site thumbnails: small WebP keeps tens of thousands of crops within static-hosting limits. */
const SITE_CROP_SIZE = 320;
const SITE_CROP_QUALITY = 78;

const round = (x: number) => Math.round(x * 1e5) / 1e5;

async function main() {
  const kept = loadKept();
  const artworks = loadArtworks();
  const embeddings = readJson<Record<string, EmbeddingRecord>>(EMBEDDINGS, {});
  const colors = readJson<Record<string, { palette: PaletteColor[] }>>(COLORS, {});
  const scores = readJson<Record<string, ScoreRecord>>(SCORES, {});

  const [textPhoto, textPainting] = await (await loadClipText())([PHOTO_PROMPT, PAINTING_PROMPT]);

  const cropsDir = path.join(SITE_PUBLIC, 'crops');
  fs.rmSync(cropsDir, { recursive: true, force: true });
  fs.mkdirSync(cropsDir, { recursive: true });

  const vectors = new Int8Array(kept.length * EMBED_DIM);
  const items: MetaItem[] = kept.map((k, i) => {
    const emb = embeddings[k.cropId];
    const art = artworks.get(k.artworkId);
    if (!emb) throw new Error(`${k.cropId} has no embedding; run 05-embed`);
    if (!colors[k.cropId]) throw new Error(`${k.cropId} has no palette; run 06-dominant-colors`);
    if (!art) throw new Error(`${k.artworkId} missing from data/raw`);
    vectors.set(emb.vec, i * EMBED_DIM);
    // Records fetched before licenses were normalized carry long labels; normalize them here.
    const license = normalizeLicense(art.licenseUrl, art.license) ?? { label: art.license, url: art.licenseUrl ?? '' };
    return {
      cropId: k.cropId,
      crop: `crops/${k.cropId}.webp`,
      title: art.title,
      artist: art.artist,
      date: art.date,
      museum: art.provider ? `${art.provider} via ${SOURCE_NAMES[art.source]}` : SOURCE_NAMES[art.source],
      objectUrl: art.objectUrl,
      license: license.label,
      licenseUrl: license.url,
      kind: scores[k.artworkId]?.kind ?? 'art',
      colors: colors[k.cropId].palette,
      starred: k.starred,
    };
  });

  const limit = pLimit(8);
  await Promise.all(
    kept.map((k) =>
      limit(() =>
        sharp(path.join(FINAL, `${k.cropId}.jpg`))
          .resize(SITE_CROP_SIZE, SITE_CROP_SIZE, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: SITE_CROP_QUALITY })
          .toFile(path.join(cropsDir, `${k.cropId}.webp`)),
      ),
    ),
  );

  const meta: SiteMeta = {
    model: CLIP_MODEL,
    dtype: CLIP_DTYPE,
    dim: EMBED_DIM,
    count: items.length,
    textPhoto: Array.from(textPhoto, round),
    textPainting: Array.from(textPainting, round),
    items,
  };
  fs.writeFileSync(path.join(SITE_PUBLIC, 'index.bin'), vectors);
  writeJson(path.join(SITE_PUBLIC, 'meta.json'), meta);

  const binSize = vectors.byteLength;
  const metaSize = fs.statSync(path.join(SITE_PUBLIC, 'meta.json')).size;
  const cropBytes = fs.readdirSync(cropsDir).reduce((s, f) => s + fs.statSync(path.join(cropsDir, f)).size, 0);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  const photos = items.filter((i) => i.kind === 'photo').length;
  console.log(`${items.length} cats: ${items.length - photos} art, ${photos} photos (${items.filter((i) => i.starred).length} starred)`);
  console.log(`index.bin ${mb(binSize)} + meta.json ${mb(metaSize)} = ${mb(binSize + metaSize)} (target < 5 MB)`);
  console.log(`crops/ ${mb(cropBytes)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
