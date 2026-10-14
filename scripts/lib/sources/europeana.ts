// Europeana: images from thousands of European museums, libraries and archives, including recent
// CC-licensed work. Needs a free API key in EUROPEANA_API_KEY (https://pro.europeana.eu/page/get-api).
import { normalizeLicense } from '../licenses.ts';
import type { ArtworkRecord } from '../types.ts';
import { cachedJson, cap, clean } from './common.ts';

const API = 'https://api.europeana.eu/record/v2/search.json';
const QUERY = 'cat OR cats OR kitten OR Katze OR chat OR gatto OR kat OR kot OR gato OR chaton';

interface EuropeanaItem {
  id: string;
  guid?: string;
  title?: string[];
  dcCreator?: string[];
  year?: string[];
  rights?: string[];
  dataProvider?: string[];
  edmIsShownBy?: string[];
  edmPreview?: string[];
}
interface EuropeanaResponse {
  success: boolean;
  error?: string;
  totalResults: number;
  nextCursor?: string;
  items?: EuropeanaItem[];
}

export async function fetchEuropeana(): Promise<ArtworkRecord[]> {
  const key = process.env.EUROPEANA_API_KEY;
  if (!key) throw new Error('set EUROPEANA_API_KEY (free at https://pro.europeana.eu/page/get-api)');
  const max = cap('EUROPEANA_MAX', 3000);
  const records = new Map<string, ArtworkRecord>();
  let cursor = '*';
  let refused = 0;
  while (records.size < max && cursor) {
    const params = new URLSearchParams({
      wskey: key,
      query: QUERY,
      rows: '100',
      cursor,
      media: 'true',
      profile: 'standard',
    });
    params.append('qf', 'TYPE:IMAGE');
    // "open" = PD, CC0, BY, BY-SA; "restricted" adds NC and ND, so ND is filtered out below.
    params.append('reusability', 'open');
    params.append('reusability', 'restricted');
    const res = await cachedJson<EuropeanaResponse>('europeana', `${API}?${params}`, [key], 300);
    if (!res.success) throw new Error(`Europeana: ${res.error}`);
    for (const item of res.items ?? []) {
      const license = normalizeLicense(item.rights?.[0]);
      const imageUrl = item.edmIsShownBy?.[0] ?? item.edmPreview?.[0];
      if (!license) {
        refused++;
        continue;
      }
      if (!imageUrl) continue;
      const id = item.id.replace(/^\//, '').replace(/\//g, '_');
      records.set(id, {
        id,
        source: 'europeana',
        title: clean(item.title?.[0]) || 'Untitled',
        artist: clean(item.dcCreator?.[0]).slice(0, 120),
        date: clean(item.year?.[0]),
        imageUrl,
        objectUrl: item.guid ?? `https://www.europeana.eu/item${item.id}`,
        license: license.label,
        licenseUrl: license.url,
        provider: clean(item.dataProvider?.[0]),
      });
    }
    console.log(`  europeana: ${records.size}/${Math.min(max, res.totalResults)}`);
    cursor = res.nextCursor ?? '';
  }
  if (refused) console.log(`  europeana: ${refused} items skipped for license (NoDerivatives or not CC/public domain)`);
  return [...records.values()].slice(0, max);
}
