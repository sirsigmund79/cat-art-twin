// Parsing and license filtering of the Commons, Flickr and Europeana fetchers, against canned
// responses in each API's format. Runs with a temporary data folder and a stubbed fetch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-art-twin-'));
process.env.CAT_ART_DATA = tmp;
process.env.COMMONS_MAX = '10';
process.env.FLICKR_API_KEY = 'secret-key';
process.env.EUROPEANA_API_KEY = 'secret-eu';

const realFetch = globalThis.fetch;
const requested: string[] = [];
let respond: (url: URL) => unknown = () => ({});

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.toString());
    return new Response(JSON.stringify(respond(url)), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const meta = (license: string, url: string, artist = '<a href="//x">Jane&nbsp;Doe</a>') => ({
  LicenseShortName: { value: license },
  LicenseUrl: { value: url },
  Artist: { value: artist },
  ObjectName: { value: 'Sleeping cat' },
  DateTimeOriginal: { value: '1890' },
});
const commonsPage = (id: number, extmetadata: unknown, width = 1200) => ({
  pageid: id,
  title: `File:Cat_${id}.jpg`,
  imageinfo: [
    { thumburl: `https://upload.wikimedia.org/thumb/${id}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:Cat_${id}.jpg`, width, height: 900, mime: 'image/jpeg', extmetadata },
  ],
});

test('commons: maps files, follows continue, drops NoDerivatives and tiny images', async () => {
  const { fetchCommons } = await import('../../scripts/lib/sources/commons.ts');
  respond = (url) => {
    const first = !url.searchParams.get('gsroffset');
    return first
      ? {
          continue: { gsroffset: '50', continue: 'gsroffset||' },
          query: {
            pages: {
              1: commonsPage(1, meta('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0')),
              2: commonsPage(2, meta('CC BY-ND 2.0', 'https://creativecommons.org/licenses/by-nd/2.0/')),
            },
          },
        }
      : {
          query: {
            pages: {
              3: commonsPage(3, meta('Public domain', '')),
              4: commonsPage(4, meta('CC0', 'http://creativecommons.org/publicdomain/zero/1.0/deed.en'), 200),
            },
          },
        };
  };
  const records = await fetchCommons();
  assert.deepEqual(records.map((r) => r.id).sort(), ['1', '3']);
  const r1 = records.find((r) => r.id === '1')!;
  assert.equal(r1.license, 'CC BY-SA 4.0');
  assert.equal(r1.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.equal(r1.artist, 'Jane Doe');
  assert.equal(r1.title, 'Sleeping cat');
  assert.equal(r1.imageUrl, 'https://upload.wikimedia.org/thumb/1.jpg');
  assert.ok(requested.some((u) => u.includes('gsroffset=50')), 'followed continue');
  assert.ok(requested.every((u) => !u.includes('commons') || u.includes('iiurlwidth=960')));
});

test('flickr: uses only allowed license ids and never caches the API key', async () => {
  requested.length = 0;
  const { fetchFlickr } = await import('../../scripts/lib/sources/flickr.ts');
  process.env.FLICKR_MAX = '3';
  respond = (url) => {
    if (url.searchParams.get('method') === 'flickr.photos.licenses.getInfo') {
      return {
        stat: 'ok',
        licenses: {
          license: [
            { id: 0, name: 'All Rights Reserved', url: '' },
            { id: 2, name: 'Attribution-NonCommercial License', url: 'https://creativecommons.org/licenses/by-nc/2.0/' },
            { id: 3, name: 'Attribution-NonCommercial-NoDerivs License', url: 'https://creativecommons.org/licenses/by-nc-nd/2.0/' },
            { id: 10, name: 'Public Domain Mark', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
          ],
        },
      };
    }
    return {
      stat: 'ok',
      photos: {
        page: 1,
        pages: 1,
        total: 2,
        photo: [
          { id: '11', owner: 'o1', title: 'Tabby', license: '2', ownername: 'Sam', datetaken: '2015-06-01 10:00:00', url_c: 'https://live.staticflickr.com/11_c.jpg' },
          { id: '12', owner: 'o2', title: '', license: '10', url_z: 'https://live.staticflickr.com/12_z.jpg' },
        ],
      },
    };
  };
  const records = await fetchFlickr();
  const search = requested.find((u) => u.includes('photos.search'))!;
  assert.equal(new URL(search).searchParams.get('license'), '2,10');
  assert.deepEqual(
    records.map((r) => [r.id, r.license, r.artist, r.date, r.title]),
    [
      ['11', 'CC BY-NC 2.0', 'Sam', '2015', 'Tabby'],
      ['12', 'Public domain', '', '', 'Untitled'],
    ],
  );
  assert.equal(records[0].objectUrl, 'https://www.flickr.com/photos/o1/11');
  const cached = fs.readdirSync(path.join(tmp, 'cache', 'flickr')).map((f) => fs.readFileSync(path.join(tmp, 'cache', 'flickr', f), 'utf8'));
  assert.ok(cached.length > 0 && cached.every((c) => !c.includes('secret-key')));
});

test('europeana: keeps CC BY-NC and public domain, drops ND and rights-reserved', async () => {
  const { fetchEuropeana } = await import('../../scripts/lib/sources/europeana.ts');
  const item = (id: string, rights: string) => ({
    id: `/123/${id}`,
    guid: `https://www.europeana.eu/item/123/${id}`,
    title: [`Cat ${id}`],
    dcCreator: ['Anon'],
    year: ['1975'],
    rights: [rights],
    dataProvider: ['Rijksmuseum'],
    edmIsShownBy: [`https://example.org/${id}.jpg`],
  });
  respond = () => ({
    success: true,
    totalResults: 4,
    items: [
      item('a', 'http://creativecommons.org/licenses/by-nc/4.0/'),
      item('b', 'http://creativecommons.org/licenses/by-nc-nd/4.0/'),
      item('c', 'http://creativecommons.org/publicdomain/mark/1.0/'),
      item('d', 'http://rightsstatements.org/vocab/InC/1.0/'),
    ],
  });
  const records = await fetchEuropeana();
  assert.deepEqual(records.map((r) => [r.id, r.license]), [
    ['123_a', 'CC BY-NC 4.0'],
    ['123_c', 'Public domain'],
  ]);
  assert.equal(records[0].provider, 'Rijksmuseum');
});

test('wikidata: finds animal taxa, maps artworks, takes license and thumbnail from Commons', async () => {
  requested.length = 0;
  const { fetchWikidata } = await import('../../scripts/lib/sources/wikidata.ts');
  const ent = (q: string) => ({ value: `http://www.wikidata.org/entity/${q}` });
  respond = (url) => {
    if (url.hostname === 'query.wikidata.org') {
      const q = url.searchParams.get('query')!;
      if (q.includes('COUNT(DISTINCT')) return { results: { bindings: [{ depicts: ent('Q146') }, { depicts: ent('Q10884') }] } };
      if (q.includes('wdt:P171*')) return { results: { bindings: [{ depicts: ent('Q146') }] } }; // Q10884 (a tree) isn't an animal
      return {
        results: {
          bindings: [
            { item: ent('Q1'), itemLabel: { value: 'Girl with a Cat' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Girl%20with%20cat.jpg' }, creatorLabel: { value: 'Jan Steen' }, year: { value: '1660' } },
            { item: ent('Q1'), itemLabel: { value: 'Girl with a Cat' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Girl%20with%20cat.jpg' }, creatorLabel: { value: 'Workshop' } },
            { item: ent('Q2'), itemLabel: { value: 'Q2' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Cat_print.jpg' } },
          ],
        },
      };
    }
    // Commons imageinfo by title.
    return {
      query: {
        normalized: [{ from: 'File:Cat print.jpg', to: 'File:Cat print.jpg' }],
        pages: {
          10: commonsPage(10, meta('Public domain', '')),
          11: { ...commonsPage(11, meta('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 'Uploader')), title: 'File:Cat print.jpg' },
        },
      },
    };
  };
  // commonsPage(10) is titled "File:Cat_10.jpg"; give it the first artwork's title instead.
  const base = respond;
  respond = (url) => {
    const r = base(url) as { query?: { pages: Record<string, { title: string }> } };
    if (r.query?.pages?.[10]) r.query.pages[10].title = 'File:Girl with cat.jpg';
    return r;
  };
  const records = await fetchWikidata();
  assert.deepEqual(
    records.map((r) => [r.id, r.source, r.title, r.artist, r.date, r.license]),
    [
      ['Q1', 'wikidata', 'Girl with a Cat', 'Jan Steen', '1660', 'Public domain'],
      ['Q2', 'wikidata', 'Sleeping cat', 'Uploader', '1890', 'CC BY-SA 4.0'],
    ],
  );
  const animalCheck = requested.find((u) => new URL(u).searchParams.get('query')?.includes('wdt:P171*'))!;
  assert.match(new URL(animalCheck).searchParams.get('query')!, /wd:Q146 wd:Q10884/);
  const works = requested.find((u) => new URL(u).searchParams.get('query')?.includes('wdt:P18 ?image'))!;
  assert.doesNotMatch(new URL(works).searchParams.get('query')!, /Q10884/, 'non-animals are not queried');
});

test('bhl: looks up the BHL account, searches its photos, hides page-id titles', async () => {
  requested.length = 0;
  const { fetchBhl } = await import('../../scripts/lib/sources/flickr.ts');
  process.env.BHL_MAX = '2';
  respond = (url) => {
    const method = url.searchParams.get('method');
    if (method === 'flickr.photos.licenses.getInfo') {
      return { stat: 'ok', licenses: { license: [{ id: 7, name: 'No known copyright restrictions', url: 'https://www.flickr.com/commons/usage/' }] } };
    }
    if (method === 'flickr.urls.lookupUser') return { stat: 'ok', user: { id: '123@N02' } };
    return {
      stat: 'ok',
      photos: {
        page: 1,
        pages: 1,
        total: 2,
        photo: [
          { id: '21', owner: '123@N02', title: 'n45_w1150', license: '7', url_c: 'https://live.staticflickr.com/21_c.jpg' },
          { id: '22', owner: '123@N02', title: 'The lynx', license: '7', url_z: 'https://live.staticflickr.com/22_z.jpg' },
        ],
      },
    };
  };
  const records = await fetchBhl();
  const search = new URL(requested.find((u) => u.includes('photos.search'))!);
  assert.equal(search.searchParams.get('user_id'), '123@N02');
  assert.deepEqual(
    records.map((r) => [r.id, r.source, r.title, r.date, r.license]),
    [
      ['21', 'bhl', 'Natural history illustration', '', 'Public domain'],
      ['22', 'bhl', 'The lynx', '', 'Public domain'],
    ],
  );
});
