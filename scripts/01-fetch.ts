// Phase 1a: search the museum APIs for cats and write normalized records to data/raw/<source>.jsonl.
// Usage: npm run fetch [-- met aic cma]
import fs from 'node:fs';
import path from 'node:path';
import pThrottle from 'p-throttle';
import { fetchJson } from './lib/http.ts';
import { readJson, writeJson, writeJsonl } from './lib/io.ts';
import { CACHE, RAW } from './lib/paths.ts';
import type { ArtworkRecord, Source } from './lib/types.ts';

const TERMS = ['cat', 'cats', 'kitten', 'neko', 'chat', 'gatto', 'Katze'];

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

// ---------- The Met ----------
interface MetObject {
  objectID: number;
  isPublicDomain: boolean;
  primaryImage: string;
  primaryImageSmall: string;
  title: string;
  artistDisplayName: string;
  objectDate: string;
  objectURL: string;
}

async function fetchMet(): Promise<ArtworkRecord[]> {
  const base = 'https://collectionapi.metmuseum.org/public/collection/v1';
  // The Met asks for at most 80 req/s; stay near 10.
  const throttle = pThrottle({ limit: 10, interval: 1000 });
  const get = throttle(<T>(url: string) => fetchJson<T>(url));

  // v1/search was retired on 2026-10-01 (HTTP 410). v1.1 pages results: limit <= 500, and nothing
  // past offset + limit = 10,000 is served. Object lookups stay on v1.
  const PAGE = 500;
  const WINDOW = 10_000;
  const ids = new Set<number>();
  for (const term of TERMS) {
    let total = 0;
    let got = 0;
    for (let offset = 0; offset < WINDOW; offset += PAGE) {
      const res = await get<{ total: number; objectIDs: number[] | null }>(
        `https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&q=${encodeURIComponent(term)}&offset=${offset}&limit=${PAGE}`,
      );
      total = res.total ?? 0;
      for (const id of res.objectIDs ?? []) ids.add(id);
      got += res.objectIDs?.length ?? 0;
      if (!res.objectIDs?.length || offset + PAGE >= total) break;
    }
    const capped = total > WINDOW ? ` (API serves only the first ${WINDOW} of ${total})` : '';
    console.log(`  met: "${term}" -> ${got} ids${capped}`);
  }

  const cacheDir = path.join(CACHE, 'met');
  fs.mkdirSync(cacheDir, { recursive: true });
  const records: ArtworkRecord[] = [];
  let done = 0;
  let failed = 0;
  await Promise.all(
    [...ids].map(async (id) => {
      const cacheFile = path.join(cacheDir, `${id}.json`);
      let obj = readJson<MetObject | null>(cacheFile, null);
      if (!obj) {
        try {
          obj = await get<MetObject>(`${base}/objects/${id}`);
          writeJson(cacheFile, obj);
        } catch (err) {
          failed++;
          console.warn(`  met: object ${id} failed: ${(err as Error).message}`);
          return;
        }
      }
      if (++done % 500 === 0) console.log(`  met: ${done}/${ids.size} objects`);
      if (!obj.isPublicDomain || !obj.primaryImage) return;
      records.push({
        id: String(obj.objectID),
        source: 'met',
        title: clean(obj.title),
        artist: clean(obj.artistDisplayName),
        date: clean(obj.objectDate),
        // primaryImageSmall is the "web-large" rendition, close to the 800px we keep.
        imageUrl: obj.primaryImageSmall || obj.primaryImage,
        objectUrl: obj.objectURL || `https://www.metmuseum.org/art/collection/search/${obj.objectID}`,
        license: 'Public domain (CC0), The Met Open Access',
      });
    }),
  );
  if (failed) console.warn(`  met: ${failed} objects failed; rerun to retry them`);
  return records;
}

// ---------- Art Institute of Chicago ----------
interface AicResponse {
  pagination: { total_pages: number };
  data: { id: number; title: string; artist_display: string; date_display: string; image_id: string | null }[];
}

async function fetchAic(): Promise<ArtworkRecord[]> {
  const records: ArtworkRecord[] = [];
  const throttle = pThrottle({ limit: 1, interval: 1000 }); // AIC: 60 req/min anonymous
  const get = throttle(<T>(url: string) => fetchJson<T>(url));
  for (const term of TERMS) {
    // AIC search results stop at 1,000 (10 pages of 100).
    for (let page = 1; page <= 10; page++) {
      const url =
        `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(term)}` +
        `&query[term][is_public_domain]=true&fields=id,title,artist_display,date_display,image_id` +
        `&limit=100&page=${page}`;
      const res = await get<AicResponse>(url);
      for (const a of res.data) {
        if (!a.image_id) continue;
        records.push({
          id: String(a.id),
          source: 'aic',
          title: clean(a.title),
          // artist_display is "Name\nNationality, dates"; keep the first line.
          artist: clean(a.artist_display?.split('\n')[0]),
          date: clean(a.date_display),
          imageUrl: `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg`,
          objectUrl: `https://www.artic.edu/artworks/${a.id}`,
          license: 'Public domain (CC0), Art Institute of Chicago',
        });
      }
      console.log(`  aic: "${term}" page ${page}/${res.pagination.total_pages}`);
      if (page >= res.pagination.total_pages) break;
    }
  }
  return records;
}

// ---------- Cleveland Museum of Art ----------
interface CmaResponse {
  info: { total: number };
  data: {
    id: number;
    title: string;
    creators: { description: string }[];
    creation_date: string;
    url: string;
    images: { web?: { url: string } } | null;
  }[];
}

async function fetchCma(): Promise<ArtworkRecord[]> {
  const records: ArtworkRecord[] = [];
  for (const term of TERMS) {
    for (let skip = 0; ; skip += 100) {
      const url =
        `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(term)}` +
        `&cc0=1&has_image=1&limit=100&skip=${skip}`;
      const res = await fetchJson<CmaResponse>(url);
      for (const a of res.data) {
        const imageUrl = a.images?.web?.url;
        if (!imageUrl) continue;
        records.push({
          id: String(a.id),
          source: 'cma',
          title: clean(a.title),
          // "Name (American, 1850-1920)" -> "Name"
          artist: clean(a.creators?.[0]?.description?.replace(/\s*\(.*$/, '')),
          date: clean(a.creation_date),
          imageUrl,
          objectUrl: a.url,
          license: 'Public domain (CC0), Cleveland Museum of Art Open Access',
        });
      }
      console.log(`  cma: "${term}" ${Math.min(skip + 100, res.info.total)}/${res.info.total}`);
      if (skip + 100 >= res.info.total || res.data.length === 0) break;
    }
  }
  return records;
}

const FETCHERS: Record<Source, () => Promise<ArtworkRecord[]>> = { met: fetchMet, aic: fetchAic, cma: fetchCma };

async function main() {
  const sources = (process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FETCHERS)) as Source[];
  const failed: Source[] = [];
  for (const source of sources) {
    if (!FETCHERS[source]) throw new Error(`unknown source ${source}`);
    console.log(`Fetching ${source}...`);
    // One museum's API breaking shouldn't stop the others.
    let records: ArtworkRecord[];
    try {
      records = await FETCHERS[source]();
    } catch (err) {
      console.error(`${source} failed: ${(err as Error).message}`);
      failed.push(source);
      continue;
    }
    const unique = new Map(records.map((r) => [`${r.source}-${r.id}`, r]));
    writeJsonl(path.join(RAW, `${source}.jsonl`), [...unique.values()]);
    console.log(`${source}: ${unique.size} public-domain records with images (${records.length - unique.size} duplicates removed)`);
  }
  if (failed.length) {
    console.error(`\nFailed: ${failed.join(', ')}. Retry with: npm run fetch -- ${failed.join(' ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
