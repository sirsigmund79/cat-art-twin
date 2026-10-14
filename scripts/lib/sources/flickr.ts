// Flickr: Creative Commons and public domain cat photos. Needs a free API key in FLICKR_API_KEY
// (https://www.flickr.com/services/apps/create/). Flickr serves at most ~4,000 results per search,
// so the search is split into one window per upload year, each sorted by "interestingness".
import { normalizeLicense, type License } from '../licenses.ts';
import type { ArtworkRecord } from '../types.ts';
import { cachedJson, cap, clean } from './common.ts';

const API = 'https://api.flickr.com/services/rest/';

interface FlickrPhoto {
  id: string;
  owner: string;
  title: string;
  license: string;
  ownername?: string;
  datetaken?: string;
  url_c?: string;
  url_z?: string;
  height_c?: number;
  width_c?: number;
}
interface FlickrSearch {
  stat: string;
  message?: string;
  photos?: { page: number; pages: number; total: number; photo: FlickrPhoto[] };
}
interface FlickrLicenses {
  stat: string;
  message?: string;
  licenses: { license: { id: number | string; name: string; url: string }[] };
}

export async function fetchFlickr(): Promise<ArtworkRecord[]> {
  const key = process.env.FLICKR_API_KEY;
  if (!key) throw new Error('set FLICKR_API_KEY (free at https://www.flickr.com/services/apps/create/)');
  const max = cap('FLICKR_MAX', 5000);
  const call = <T>(params: Record<string, string>) =>
    cachedJson<T>('flickr', `${API}?${new URLSearchParams({ api_key: key, format: 'json', nojsoncallback: '1', ...params })}`, [key], 1100);

  // Ask Flickr which license ids exist rather than hard-coding them, and keep the allowed ones.
  const lic = await call<FlickrLicenses>({ method: 'flickr.photos.licenses.getInfo' });
  if (lic.stat !== 'ok') throw new Error(`Flickr: ${lic.message}`);
  const allowed = new Map<string, License>();
  for (const l of lic.licenses.license) {
    const n = normalizeLicense(l.url, l.name);
    if (n) allowed.set(String(l.id), n);
  }
  console.log(`  flickr: accepting ${[...new Set([...allowed.values()].map((l) => l.label))].join(', ')}`);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2004 + 1 }, (_, i) => thisYear - i);
  const perYear = Math.ceil(max / years.length);
  const records = new Map<string, ArtworkRecord>();
  for (const year of years) {
    let got = 0;
    for (let page = 1; got < perYear && page <= 8; page++) {
      const res = await call<FlickrSearch>({
        method: 'flickr.photos.search',
        tags: 'cat,cats,kitten,kitty',
        tag_mode: 'any',
        license: [...allowed.keys()].join(','),
        content_types: '0',
        media: 'photos',
        safe_search: '1',
        sort: 'interestingness-desc',
        min_upload_date: `${year}-01-01`,
        max_upload_date: `${year}-12-31`,
        extras: 'license,owner_name,date_taken,url_c,url_z',
        per_page: '250',
        page: String(page),
      });
      if (res.stat !== 'ok' || !res.photos) throw new Error(`Flickr: ${res.message}`);
      for (const p of res.photos.photo) {
        const license = allowed.get(String(p.license));
        const imageUrl = p.url_c ?? p.url_z;
        if (!license || !imageUrl || records.has(p.id)) continue;
        records.set(p.id, {
          id: p.id,
          source: 'flickr',
          title: clean(p.title) || 'Untitled',
          artist: clean(p.ownername),
          date: (p.datetaken ?? '').slice(0, 4),
          imageUrl,
          objectUrl: `https://www.flickr.com/photos/${p.owner}/${p.id}`,
          license: license.label,
          licenseUrl: license.url,
        });
        got++;
      }
      if (page >= res.photos.pages) break;
    }
    console.log(`  flickr: ${year} -> ${got} photos (${records.size} total)`);
    if (records.size >= max) break;
  }
  return [...records.values()].slice(0, max);
}
