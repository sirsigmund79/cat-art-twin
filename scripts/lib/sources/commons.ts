// Wikimedia Commons: files whose structured data says they depict a house cat (P180 = Q146),
// plus the "Cats in art" category tree. Art and photos; every file has a free license.
// No API key. Commons search serves at most 10,000 results per query, so several sort orders are used.
import { normalizeLicense } from '../licenses.ts';
import type { ArtworkRecord } from '../types.ts';
import { cachedJson, cap, clean } from './common.ts';

const API = 'https://commons.wikimedia.org/w/api.php';
/** Wikimedia serves a fixed set of thumbnail widths; 960 is one of them and is downscaled to 800 later. */
const THUMB_WIDTH = 960;

const QUERIES = [
  { search: 'filetype:bitmap deepcat:"Cats in art"', sort: 'relevance' },
  { search: 'filetype:bitmap haswbstatement:P180=Q146 haswbstatement:P31=Q3305213', sort: 'relevance' }, // paintings
  { search: 'filetype:bitmap haswbstatement:P180=Q146', sort: 'relevance' },
  { search: 'filetype:bitmap haswbstatement:P180=Q146', sort: 'create_timestamp_desc' },
  { search: 'filetype:bitmap haswbstatement:P180=Q146', sort: 'create_timestamp_asc' },
];

type Meta = Record<string, { value: string } | undefined>;
interface CommonsResponse {
  continue?: Record<string, string>;
  query?: {
    pages: Record<
      string,
      {
        pageid: number;
        title: string;
        imageinfo?: { thumburl?: string; descriptionurl: string; width: number; height: number; mime: string; extmetadata?: Meta }[];
      }
    >;
  };
}

export async function fetchCommons(): Promise<ArtworkRecord[]> {
  const max = cap('COMMONS_MAX', 8000);
  const byId = new Map<string, ArtworkRecord>();
  let refused = 0;
  for (const q of QUERIES) {
    let cont: Record<string, string> = { continue: '' };
    let pages = 0;
    while (byId.size < max) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '1',
        maxlag: '5',
        generator: 'search',
        gsrsearch: q.search,
        gsrsort: q.sort,
        gsrnamespace: '6',
        gsrlimit: '50',
        prop: 'imageinfo',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: String(THUMB_WIDTH),
        iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName|ImageDescription|DateTimeOriginal',
        iiextmetadatalanguage: 'en',
        ...cont,
      });
      const res = await cachedJson<CommonsResponse>('commons', `${API}?${params}`, [], 200);
      for (const page of Object.values(res.query?.pages ?? {})) {
        const info = page.imageinfo?.[0];
        if (!info?.thumburl || !/^image\/(jpeg|png|webp|tiff)/.test(info.mime)) continue;
        if (Math.min(info.width, info.height) < 300) continue;
        const m = info.extmetadata ?? {};
        const license = normalizeLicense(m.LicenseUrl?.value, m.LicenseShortName?.value);
        if (!license) {
          refused++;
          continue;
        }
        const name = page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
        byId.set(String(page.pageid), {
          id: String(page.pageid),
          source: 'commons',
          title: clean(m.ObjectName?.value) || name.replace(/_/g, ' '),
          artist: clean(m.Artist?.value).slice(0, 120),
          date: clean(m.DateTimeOriginal?.value).slice(0, 40),
          imageUrl: info.thumburl,
          objectUrl: info.descriptionurl,
          license: license.label,
          licenseUrl: license.url,
        });
      }
      pages++;
      if (!res.continue) break;
      cont = res.continue;
    }
    console.log(`  commons: [${q.search} / ${q.sort}] ${pages} pages; ${byId.size} files so far`);
    if (byId.size >= max) break;
  }
  if (refused) console.log(`  commons: ${refused} files skipped for license (NoDerivatives or unclear terms)`);
  return [...byId.values()].slice(0, max);
}
