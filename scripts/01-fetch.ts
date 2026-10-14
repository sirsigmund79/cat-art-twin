// Phase 1a: search the source APIs for cats and write normalized records to data/raw/<source>.jsonl.
// Usage: npm run fetch [-- met aic cma commons flickr europeana]
// With no arguments: every source that needs no key, plus flickr/europeana when their key is set.
import fs from 'node:fs';
import path from 'node:path';
import pThrottle from 'p-throttle';
import { fetchJson } from './lib/http.ts';
import { readJson, writeJson, writeJsonl } from './lib/io.ts';
import { CACHE, RAW } from './lib/paths.ts';
import { fetchCommons } from './lib/sources/commons.ts';
import { fetchEuropeana } from './lib/sources/europeana.ts';
import { fetchFlickr } from './lib/sources/flickr.ts';
import type { ArtworkRecord, Source } from './lib/types.ts';

const CC0 = { license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };

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

// The Met's firewall blocks an IP for minutes after a small burst, well below the documented 80 req/s,
// and answers 403 to everything while blocked. Retrying right away keeps the block going. So: one
// request at a time, a pause between requests, and a growing cooldown whenever a 403/429 shows up.
const MET_DELAY_MS = Number(process.env.MET_DELAY_MS ?? 1500);
const MET_API = process.env.MET_API ?? 'https://collectionapi.metmuseum.org/public/collection';
const MET_COOLDOWN_START_MS = Number(process.env.MET_COOLDOWN_MS ?? 2 * 60_000);
const MET_COOLDOWN_MAX_MS = 20 * 60_000;
/** Give up (progress is cached) after this many blocks in a row without a success. */
const MET_MAX_BLOCKS = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MetBlockedError extends Error {}

function metClient() {
  let last = 0;
  let cooldown = MET_COOLDOWN_START_MS;
  let blocksInARow = 0;
  let networkErrors = 0;
  /** GET JSON from the Met; null for 404. Waits out blocks; throws MetBlockedError if they don't clear. */
  return async function get<T>(url: string): Promise<T | null> {
    for (;;) {
      await sleep(Math.max(0, last + MET_DELAY_MS - Date.now()));
      last = Date.now();
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': 'cat-art-twin (https://github.com/sirsigmund79/cat-art-twin)' },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        if (++networkErrors >= 5) throw err;
        console.warn(`  met: network error (${(err as Error).message}); retrying in 10s`);
        await sleep(10_000);
        continue;
      }
      if (res.status === 403 || res.status === 429) {
        await res.body?.cancel();
        if (++blocksInARow >= MET_MAX_BLOCKS) {
          throw new MetBlockedError(`still blocked after ${MET_MAX_BLOCKS} cooldowns`);
        }
        console.warn(`  met: blocked (HTTP ${res.status}); waiting ${cooldown >= 60_000 ? `${cooldown / 60_000} min` : `${Math.round(cooldown / 1000)}s`} before trying again`);
        await sleep(cooldown);
        cooldown = Math.min(cooldown * 2, MET_COOLDOWN_MAX_MS);
        continue;
      }
      blocksInARow = 0;
      networkErrors = 0;
      cooldown = MET_COOLDOWN_START_MS;
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    }
  };
}

async function fetchMet(): Promise<ArtworkRecord[]> {
  const get = metClient();
  const cacheDir = path.join(CACHE, 'met');
  fs.mkdirSync(cacheDir, { recursive: true });

  // v1/search was retired on 2026-10-01 (HTTP 410). v1.1 pages results: limit <= 500, and nothing
  // past offset + limit = 10,000 is served. Object lookups stay on v1.
  // The ID list is cached so a rerun after a block goes straight to the objects. Delete
  // data/cache/met/_search.json to search again.
  const PAGE = 500;
  const WINDOW = 10_000;
  const searchCache = path.join(cacheDir, '_search.json');
  const searched = readJson<Record<string, number[]>>(searchCache, {});
  for (const term of TERMS) {
    if (searched[term]) continue;
    const termIds: number[] = [];
    let total = 0;
    for (let offset = 0; offset < WINDOW; offset += PAGE) {
      const res = await get<{ total: number; objectIDs: number[] | null }>(
        `${MET_API}/v1.1/search?hasImages=true&q=${encodeURIComponent(term)}&offset=${offset}&limit=${PAGE}`,
      );
      total = res?.total ?? 0;
      termIds.push(...(res?.objectIDs ?? []));
      if (!res?.objectIDs?.length || offset + PAGE >= total) break;
    }
    searched[term] = termIds;
    writeJson(searchCache, searched);
    const capped = total > WINDOW ? ` (API serves only the first ${WINDOW} of ${total})` : '';
    console.log(`  met: "${term}" -> ${termIds.length} ids${capped}`);
  }
  const ids = [...new Set(Object.values(searched).flat())];

  const cached = (id: number) => fs.existsSync(path.join(cacheDir, `${id}.json`));
  const todo = ids.filter((id) => !cached(id));
  const minutes = Math.ceil((todo.length * MET_DELAY_MS) / 60_000);
  console.log(`  met: ${ids.length} objects, ${ids.length - todo.length} cached, ${todo.length} to fetch (~${minutes} min)`);

  let gone = 0;
  let blocked = false;
  for (let i = 0; i < todo.length; i++) {
    const id = todo[i];
    try {
      // A 404 (object removed since the search index was built) is cached as null so it isn't refetched.
      writeJson(path.join(cacheDir, `${id}.json`), await get<MetObject>(`${MET_API}/v1/objects/${id}`));
    } catch (err) {
      if (err instanceof MetBlockedError) {
        console.error(`  met: ${err.message}. Progress is saved; wait 30 minutes or so and run: npm run fetch -- met`);
        blocked = true;
        break;
      }
      console.warn(`  met: object ${id} failed: ${(err as Error).message}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  met: ${i + 1}/${todo.length} fetched`);
  }

  const records: ArtworkRecord[] = [];
  let missing = 0;
  for (const id of ids) {
    if (!cached(id)) {
      missing++;
      continue;
    }
    const obj = readJson<MetObject | null>(path.join(cacheDir, `${id}.json`), null);
    if (!obj) {
      gone++;
      continue;
    }
    if (!obj.isPublicDomain || !obj.primaryImage) continue;
    records.push({
      id: String(obj.objectID),
      source: 'met',
      title: clean(obj.title),
      artist: clean(obj.artistDisplayName),
      date: clean(obj.objectDate),
      // primaryImageSmall is the "web-large" rendition, close to the 800px we keep.
      imageUrl: obj.primaryImageSmall || obj.primaryImage,
      objectUrl: obj.objectURL || `https://www.metmuseum.org/art/collection/search/${obj.objectID}`,
      ...CC0,
    });
  }
  if (gone) console.log(`  met: ${gone} objects no longer exist (404)`);
  if (missing) {
    // Write what we have so later steps can start, but report the fetch as incomplete.
    console.warn(`  met: ${missing} objects not fetched yet; rerun to finish`);
    if (blocked) process.exitCode = 1;
  }
  return records;
}

// ---------- Art Institute of Chicago ----------
interface AicResponse {
  pagination: { total: number; total_pages: number };
  data: {
    id: number;
    title: string;
    artist_display: string;
    date_display: string;
    image_id: string | null;
    is_public_domain: boolean;
  }[];
}

async function fetchAic(): Promise<ArtworkRecord[]> {
  const records: ArtworkRecord[] = [];
  const throttle = pThrottle({ limit: 1, interval: 1000 }); // AIC: 60 req/min anonymous
  const get = throttle(<T>(url: string) => fetchJson<T>(url));
  for (const term of TERMS) {
    // `q` (and a `query[...]` URL filter) came back ignored: every term returned the whole collection.
    // So the text match and the public-domain filter both go in an Elasticsearch query, sent as one
    // URL-encoded JSON `params` value, the form the AIC docs recommend for production use.
    // AIC search results stop at 1,000 (10 pages of 100).
    let total = 0;
    let kept = 0;
    for (let page = 1; page <= 10; page++) {
      const params = {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: term,
                  fields: ['title^3', 'subject_titles^2', 'term_titles^2', 'classification_titles', 'alt_titles', 'description'],
                },
              },
            ],
            filter: [{ term: { is_public_domain: true } }],
          },
        },
        fields: ['id', 'title', 'artist_display', 'date_display', 'image_id', 'is_public_domain'],
        limit: 100,
        page,
      };
      const url = `https://api.artic.edu/api/v1/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`;
      const res = await get<AicResponse>(url);
      total = res.pagination.total;
      if (total > 50_000) {
        throw new Error(`"${term}" matched ${total} artworks, so the search term was ignored; not saving these results`);
      }
      for (const a of res.data) {
        if (!a.image_id || !a.is_public_domain) continue;
        kept++;
        records.push({
          id: String(a.id),
          source: 'aic',
          title: clean(a.title),
          // artist_display is "Name\nNationality, dates"; keep the first line.
          artist: clean(a.artist_display?.split('\n')[0]),
          date: clean(a.date_display),
          imageUrl: `https://www.artic.edu/iiif/2/${a.image_id}/full/843,/0/default.jpg`,
          objectUrl: `https://www.artic.edu/artworks/${a.id}`,
          ...CC0,
        });
      }
      if (page >= res.pagination.total_pages) break;
    }
    const capped = total > 1000 ? `, only the first 1,000 are served` : '';
    console.log(`  aic: "${term}" -> ${total} matches${capped}; ${kept} public domain with images`);
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
          ...CC0,
        });
      }
      console.log(`  cma: "${term}" ${Math.min(skip + 100, res.info.total)}/${res.info.total}`);
      if (skip + 100 >= res.info.total || res.data.length === 0) break;
    }
  }
  return records;
}

const FETCHERS: Record<Source, () => Promise<ArtworkRecord[]>> = {
  met: fetchMet,
  aic: fetchAic,
  cma: fetchCma,
  commons: fetchCommons,
  flickr: fetchFlickr,
  europeana: fetchEuropeana,
};

function defaultSources(): Source[] {
  const sources: Source[] = ['met', 'aic', 'cma', 'commons'];
  if (process.env.FLICKR_API_KEY) sources.push('flickr');
  else console.log('Skipping flickr: set FLICKR_API_KEY to include it.');
  if (process.env.EUROPEANA_API_KEY) sources.push('europeana');
  else console.log('Skipping europeana: set EUROPEANA_API_KEY to include it.');
  return sources;
}

async function main() {
  const sources = process.argv.slice(2).length ? (process.argv.slice(2) as Source[]) : defaultSources();
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
    console.log(`${source}: ${unique.size} openly licensed records with images (${records.length - unique.size} duplicates removed)`);
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
