// Phase 3: local review tool. `npm run review`, then open http://localhost:5174.
// Decisions are saved to data/review.json on every change, so you can stop and resume any time.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { cutCrop, padBox } from '../scripts/lib/models.ts';
import { isAutoKeep } from '../scripts/lib/kept.ts';
import { loadArtworks, readJson, writeJson } from '../scripts/lib/io.ts';
import { CROPS, CROP_RECORDS, REVIEW, ROOT, SCORES, imagePath } from '../scripts/lib/paths.ts';
import { CROP_PAD, CROP_SIZE } from '../scripts/lib/thresholds.ts';
import type { Box, CropRecord, Decision, ReviewFile, ScoreRecord } from '../scripts/lib/types.ts';

const PORT = Number(process.env.PORT ?? 5174);
const PUBLIC = path.join(ROOT, 'review', 'public');
const CROPPER = path.join(ROOT, 'node_modules', 'cropperjs', 'dist');

const artworks = loadArtworks();
const crops = readJson<CropRecord[]>(CROP_RECORDS, []);
const scores = readJson<Record<string, ScoreRecord>>(SCORES, {});
const review = readJson<ReviewFile>(REVIEW, {});
const save = () => writeJson(REVIEW, review, true);

interface Item {
  cropId: string;
  artworkId: string;
  catScore: number;
  detScore: number | null;
  /** The padded box the Phase 2 crop was cut with; null is the whole image. */
  cropBox: Box | null;
  fallback: boolean;
  rescue: boolean;
  title: string;
  artist: string;
  date: string;
}

function buildItems(): { crops: Item[]; auto: Item[]; rescue: Item[] } {
  const meta = (key: string) => {
    const a = artworks.get(key);
    return { title: a?.title ?? key, artist: a?.artist ?? '', date: a?.date ?? '' };
  };
  const cropItems: Item[] = crops
    .map((c) => ({
      cropId: c.cropId,
      artworkId: c.artworkId,
      catScore: c.catScore,
      detScore: c.detScore,
      cropBox: c.box && padBox(c.box, CROP_PAD),
      fallback: c.fallback,
      rescue: false,
      ...meta(c.artworkId),
    }))
    .sort((a, b) => a.catScore - b.catScore);
  // Rescue: every scored image that produced no crop, most cat-like first.
  const cropped = new Set(crops.map((c) => c.artworkId));
  const rescueItems: Item[] = Object.entries(scores)
    .filter(([key]) => !cropped.has(key))
    .sort((a, b) => b[1].catScore - a[1].catScore)
    .map(([key, s]) => ({
      cropId: `${key}-full`,
      artworkId: key,
      catScore: s.catScore,
      detScore: null,
      cropBox: null,
      fallback: true,
      rescue: true,
      ...meta(key),
    }));
  // Auto-kept crops get their own tab for spot checks. A crop stays in its tab after you decide
  // on it (otherwise rejecting an auto-kept crop would make it jump tabs mid-review).
  const autoIds = new Set(crops.filter((c) => isAutoKeep(c, review[c.cropId]) || review[c.cropId]?.auto).map((c) => c.cropId));
  return {
    crops: cropItems.filter((i) => !autoIds.has(i.cropId)),
    auto: cropItems.filter((i) => autoIds.has(i.cropId)).sort((a, b) => a.catScore - b.catScore),
    rescue: rescueItems,
  };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
};

function sendFile(res: http.ServerResponse, file: string, base: string) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(base + path.sep) || !fs.existsSync(resolved)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(resolved)] ?? 'application/octet-stream' });
  fs.createReadStream(resolved).pipe(res);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

interface UpdateRequest {
  ids: string[];
  /** null clears the decision. */
  decision?: Decision | null;
  box?: Box;
  rescue?: boolean;
  auto?: boolean;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api/items') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...buildItems(), review }));
    } else if (url.pathname === '/api/review' && req.method === 'POST') {
      const body = (await readBody(req)) as UpdateRequest;
      for (const id of body.ids) {
        const entry = (review[id] ??= {});
        if (body.decision === null) delete entry.decision;
        else if (body.decision) entry.decision = body.decision;
        if (body.box) entry.box = body.box;
        if (body.rescue) entry.rescue = true;
        if (body.auto) entry.auto = true;
        if (!entry.decision && !entry.box) delete review[id];
      }
      save();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (url.pathname.startsWith('/thumb/')) {
      // A crop with a corrected box is re-cut on the fly; otherwise serve the Phase 2 crop.
      const cropId = decodeURIComponent(url.pathname.slice('/thumb/'.length));
      const box = review[cropId]?.box;
      const artworkId = cropId.replace(/-(\d+|full)$/, '');
      if (box || cropId.endsWith('-full')) {
        const buf = await cutCrop(imagePath(artworkId), box ?? null, CROP_SIZE);
        res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(buf);
      } else {
        sendFile(res, path.join(CROPS, `${cropId}.jpg`), CROPS);
      }
    } else if (url.pathname.startsWith('/images/')) {
      sendFile(res, path.join(path.dirname(imagePath('x')), decodeURIComponent(url.pathname.slice(8))), path.dirname(imagePath('x')));
    } else if (url.pathname.startsWith('/vendor/')) {
      sendFile(res, path.join(CROPPER, url.pathname.slice(8)), CROPPER);
    } else {
      sendFile(res, path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname), PUBLIC);
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end(String(err));
  }
});

process.on('SIGINT', () => {
  save();
  process.exit(0);
});

server.listen(PORT, () => {
  const { crops: c, auto: a, rescue: r } = buildItems();
  const decided = c.filter((i) => review[i.cropId]?.decision).length;
  console.log(
    `Review tool: http://localhost:${PORT}  (${c.length} to review, ${decided} decided; ${a.length} auto-kept; ${r.length} in rescue)`,
  );
});
