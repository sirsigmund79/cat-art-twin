// Wikidata: paintings, drawings and prints tagged with the animal they depict ("depicts" = P180),
// with their images on Wikimedia Commons. No API key. Three steps:
//   1. which taxa do artworks depict (one grouped query),
//   2. which of those are animals (descend from Animalia, Q729), checked in batches,
//   3. the artworks for those animals, in batches, then license and thumbnail from Commons.
import type { ArtworkRecord } from '../types.ts';
import { cachedJson, cap, clean } from './common.ts';
import { commonsFiles } from './commons.ts';

const SPARQL = 'https://query.wikidata.org/sparql';
/** painting, drawing, print */
const TYPES = 'wd:Q3305213 wd:Q93184 wd:Q11060274';
const TAXON = 'wd:Q16521';
const ANIMALIA = 'wd:Q729';
/** house cat, dog, horse, bird, lion */
const FALLBACK_ANIMALS = ['Q146', 'Q144', 'Q726', 'Q5113', 'Q140'];

interface Binding {
  [k: string]: { value: string } | undefined;
}
interface SparqlResponse {
  results: { bindings: Binding[] };
}

const qid = (uri: string) => uri.replace('http://www.wikidata.org/entity/', '');

async function sparql(query: string): Promise<Binding[]> {
  const url = `${SPARQL}?${new URLSearchParams({ query: query.replace(/\s+/g, ' ').trim(), format: 'json' })}`;
  // The query service asks for at most one request at a time from a client; pause between them.
  const res = await cachedJson<SparqlResponse>('wikidata', url, [], 1000);
  return res.results.bindings;
}

function chunks<T>(xs: T[], n: number): T[][] {
  return Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
}

export async function fetchWikidata(): Promise<ArtworkRecord[]> {
  const max = cap('WIKIDATA_MAX', 15000);

  // 1. Taxa depicted by artworks that have an image, most depicted first. This is the heaviest
  // query; if the query service times out, fall back to a few well-known animals.
  let taxa: string[];
  try {
    const rows = await sparql(`
      SELECT ?depicts (COUNT(DISTINCT ?item) AS ?n) WHERE {
        VALUES ?type { ${TYPES} }
        ?item wdt:P31 ?type; wdt:P18 []; wdt:P180 ?depicts.
        ?depicts wdt:P31 ${TAXON}.
      } GROUP BY ?depicts ORDER BY DESC(?n)`);
    taxa = rows.map((b) => qid(b.depicts!.value));
    console.log(`  wikidata: artworks depict ${taxa.length} taxa`);
  } catch (err) {
    taxa = FALLBACK_ANIMALS;
    console.warn(`  wikidata: taxa query failed (${(err as Error).message}); using ${taxa.length} common animals`);
  }

  // 2. Keep animals.
  const animals: string[] = [];
  for (const batch of chunks(taxa, 150)) {
    const rows = await sparql(`
      SELECT ?depicts WHERE {
        VALUES ?depicts { ${batch.map((q) => `wd:${q}`).join(' ')} }
        ?depicts wdt:P171* ${ANIMALIA}.
      }`);
    animals.push(...rows.map((b) => qid(b.depicts!.value)));
  }
  console.log(`  wikidata: ${animals.length} of them are animals`);

  // 3. Artworks depicting those animals.
  const works = new Map<string, { file: string; title: string; creator: string; year: string }>();
  for (const batch of chunks(animals, 40)) {
    const rows = await sparql(`
      SELECT ?item ?itemLabel ?image ?creatorLabel (YEAR(?inception) AS ?year) WHERE {
        VALUES ?depicts { ${batch.map((q) => `wd:${q}`).join(' ')} }
        VALUES ?type { ${TYPES} }
        ?item wdt:P31 ?type; wdt:P18 ?image; wdt:P180 ?depicts.
        OPTIONAL { ?item wdt:P571 ?inception. }
        OPTIONAL { ?item wdt:P170 ?creator. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,de,nl,es,it,ja". }
      }`);
    for (const b of rows) {
      const id = qid(b.item!.value);
      if (works.has(id)) continue;
      const file = decodeURIComponent(b.image!.value.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' ');
      if (!file) continue;
      const label = b.itemLabel?.value ?? '';
      works.set(id, {
        file: `File:${file}`,
        title: /^Q\d+$/.test(label) ? '' : clean(label),
        creator: clean(b.creatorLabel?.value).replace(/^(Q\d+|anonymous)$/i, ''),
        year: b.year?.value ?? '',
      });
    }
    console.log(`  wikidata: ${works.size} artworks so far`);
    if (works.size >= max) break;
  }

  // License, thumbnail and credit come from the image's Commons page.
  const entries = [...works].slice(0, max);
  const files = await commonsFiles(entries.map(([, w]) => w.file));
  const records: ArtworkRecord[] = [];
  let refused = 0;
  for (const [id, w] of entries) {
    const f = files.get(w.file);
    if (f === 'refused') refused++;
    if (!f || f === 'refused') continue;
    records.push({
      ...f,
      id,
      source: 'wikidata',
      title: w.title || f.title,
      artist: w.creator || f.artist,
      date: w.year || f.date,
    });
  }
  if (refused) console.log(`  wikidata: ${refused} artworks skipped for license`);
  return records;
}
