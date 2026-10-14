// Phase 1b: download every scraped image at ~800px long edge into data/images/<source>-<id>.jpg.
// Skips files that already exist; failures go to data/download-failures.jsonl and don't stop the run.
import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { fetchWithRetry } from './lib/http.ts';
import { loadArtworks, writeJsonl } from './lib/io.ts';
import { DATA, IMAGES, imagePath } from './lib/paths.ts';

const CONCURRENCY = 6;
const LONG_EDGE = 800;
/** Some aggregator links point at huge master files; skip anything bigger than this. */
const MAX_BYTES = 40 * 1024 * 1024;

async function main() {
  fs.mkdirSync(IMAGES, { recursive: true });
  const artworks = loadArtworks();
  const todo = [...artworks].filter(([key]) => !fs.existsSync(imagePath(key)));
  console.log(`${artworks.size} artworks, ${artworks.size - todo.length} already downloaded, ${todo.length} to go`);

  const limit = pLimit(CONCURRENCY);
  const failures: { key: string; url: string; error: string }[] = [];
  const perSource: Record<string, { ok: number; failed: number }> = {};
  let done = 0;

  await Promise.all(
    todo.map(([key, rec]) =>
      limit(async () => {
        const stats = (perSource[rec.source] ??= { ok: 0, failed: 0 });
        try {
          const res = await fetchWithRetry(rec.imageUrl, {}, 4);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const type = res.headers.get('content-type') ?? '';
          // Some hosts label images application/octet-stream, so only reject clear non-images (web pages).
          if (/^(text\/|application\/(json|xml|xhtml))/.test(type)) throw new Error(`not an image (${type})`);
          if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('file too large');
          const buf = Buffer.from(await res.arrayBuffer());
          const out = await sharp(buf)
            .rotate()
            .resize(LONG_EDGE, LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 85 })
            .toBuffer();
          const file = imagePath(key);
          fs.writeFileSync(`${file}.tmp`, out);
          fs.renameSync(`${file}.tmp`, file);
          stats.ok++;
        } catch (err) {
          stats.failed++;
          failures.push({ key, url: rec.imageUrl, error: (err as Error).message });
        }
        if (++done % 200 === 0) console.log(`  ${done}/${todo.length}`);
      }),
    ),
  );

  writeJsonl(path.join(DATA, 'download-failures.jsonl'), failures);
  for (const [source, s] of Object.entries(perSource)) {
    const total = s.ok + s.failed;
    console.log(`${source}: ${s.ok} downloaded, ${s.failed} failed (${((s.failed / total) * 100).toFixed(1)}%)`);
  }
  console.log(`Images on disk: ${fs.readdirSync(IMAGES).filter((f) => f.endsWith('.jpg')).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
