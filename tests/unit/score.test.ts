import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Int8Index,
  PreparedIndex,
  adjustEmbedding,
  applyTransform,
  colorSimilarity,
  makeTransform,
  normalize,
  orthonormalize,
  quantizeInt8,
  rank,
} from '../../shared/score.ts';
import type { SiteMeta } from '../../shared/types.ts';
import type { PaletteColor } from '../../shared/types.ts';

function randomUnit(dim: number, seed: number): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  return normalize(Array.from({ length: dim }, rnd));
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

test('int8 quantization keeps cosine similarity close to float', () => {
  const dim = 512;
  const vecs = Array.from({ length: 50 }, (_, i) => randomUnit(dim, i + 1));
  const data = new Int8Array(50 * dim);
  vecs.forEach((v, i) => data.set(quantizeInt8(v), i * dim));
  const index = new PreparedIndex(new Int8Index(data, dim));
  const q = randomUnit(dim, 999);
  const approx = index.scores(index.prepareQuery(q));
  vecs.forEach((v, i) => assert.ok(Math.abs(approx[i] - dot(q, v)) < 0.01, `vector ${i}`));
});

test('rank returns the exact vector first and respects topK', () => {
  const dim = 64;
  const vecs = Array.from({ length: 20 }, (_, i) => randomUnit(dim, i + 7));
  const data = new Int8Array(20 * dim);
  vecs.forEach((v, i) => data.set(quantizeInt8(v), i * dim));
  const zero = new Float32Array(dim);
  const top = rank(vecs[13], new PreparedIndex(new Int8Index(data, dim)), {
    adjust: false,
    w: 1,
    topK: 5,
    textPhoto: zero,
    textPainting: zero,
  });
  assert.equal(top.length, 5);
  assert.equal(top[0].index, 13);
  assert.ok(top[0].clip > 0.99);
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].score >= top[i].score);
});

test('adjustment moves the query toward the painting prompt', () => {
  const dim = 32;
  const photo = randomUnit(dim, 1);
  const tPhoto = randomUnit(dim, 2);
  const tPainting = randomUnit(dim, 3);
  const adjusted = adjustEmbedding(photo, tPhoto, tPainting);
  assert.ok(Math.abs(dot(adjusted, adjusted) - 1) < 1e-5);
  assert.ok(dot(adjusted, tPainting) - dot(adjusted, tPhoto) > dot(photo, tPainting) - dot(photo, tPhoto));
});

test('color similarity is 1 for identical palettes and lower for different ones', () => {
  const orange: PaletteColor[] = [
    { lab: [65, 35, 60], hex: '#e08a3c', weight: 0.7 },
    { lab: [95, 0, 5], hex: '#f4efe6', weight: 0.3 },
  ];
  const grey: PaletteColor[] = [{ lab: [50, 0, 0], hex: '#777777', weight: 1 }];
  assert.ok(Math.abs(colorSimilarity(orange, orange) - 1) < 1e-9);
  assert.ok(colorSimilarity(orange, grey) < 0.3);
  assert.equal(colorSimilarity(orange, grey), colorSimilarity(grey, orange));
  assert.equal(colorSimilarity([], grey), 0);
});

test('color weight changes the ranking when w < 1', () => {
  const dim = 16;
  const a = randomUnit(dim, 5);
  const b = normalize(a.map((x, i) => x + (i === 0 ? 0.3 : 0)));
  const data = new Int8Array(2 * dim);
  data.set(quantizeInt8(a), 0);
  data.set(quantizeInt8(b), dim);
  const black: PaletteColor[] = [{ lab: [0, 0, 0], hex: '#000000', weight: 1 }];
  const white: PaletteColor[] = [{ lab: [100, 0, 0], hex: '#ffffff', weight: 1 }];
  const opts = { adjust: false, topK: 2, textPhoto: a, textPainting: a, photoPalette: white, palettes: [black, white] };
  const index = new PreparedIndex(new Int8Index(data, dim));
  assert.equal(rank(a, index, { ...opts, w: 1 })[0].index, 0);
  assert.equal(rank(a, index, { ...opts, w: 0.5 })[0].index, 1);
});

const fakeMeta = (count: number, dim: number, extra: Partial<SiteMeta>, kinds?: string[]) =>
  ({
    count,
    dim,
    items: Array.from({ length: count }, (_, i) => ({ kind: kinds?.[i] ?? 'art' })),
    ...extra,
  }) as unknown as SiteMeta;

test('centering subtracts the right group mean from items and query', () => {
  const dim = 16;
  const vecs = Array.from({ length: 6 }, (_, i) => randomUnit(dim, i + 100));
  const data = new Int8Array(6 * dim);
  vecs.forEach((v, i) => data.set(quantizeInt8(v), i * dim));
  const raw = new Int8Index(data, dim);
  const art = randomUnit(dim, 1).map((x) => x * 0.3);
  const photo = randomUnit(dim, 2).map((x) => x * 0.3);
  const kinds = ['art', 'photo', 'art', 'photo', 'art', 'art'];
  const t = makeTransform(fakeMeta(6, dim, { means: { all: Array.from(art), art: Array.from(art), photo: Array.from(photo) } }, kinds), { center: 'kind', removeSpecies: false });
  const prepared = new PreparedIndex(raw, t);
  const q = randomUnit(dim, 9);
  const qp = prepared.prepareQuery(q);
  assert.ok(Math.abs(dot(qp, normalize(normalize(q).map((x, j) => x - photo[j]))) - 1) < 1e-5, 'query uses the photo mean');
  const s = prepared.scores(qp);
  kinds.forEach((k, i) => {
    const m = k === 'photo' ? photo : art;
    const expected = dot(qp, normalize(raw.unit(i).map((x, j) => x - m[j])));
    assert.ok(Math.abs(s[i] - expected) < 1e-5, `item ${i}`);
  });
  assert.deepEqual(makeTransform(fakeMeta(6, dim, {}), { center: 'kind', removeSpecies: true }), {});
});

test('species removal makes items that differ only along species directions identical', () => {
  const dim = 32;
  const base = randomUnit(dim, 5);
  const species = orthonormalize([randomUnit(dim, 6), randomUnit(dim, 7)]);
  // "Same look, different species": base plus different amounts of the species directions.
  const owl = normalize(base.map((x, j) => x + 0.8 * species[0][j]));
  const cat = normalize(base.map((x, j) => x - 0.5 * species[1][j]));
  const other = randomUnit(dim, 8);
  const basis = species.map((b) => Array.from(b));
  const a = applyTransform(owl, undefined, basis);
  const b = applyTransform(cat, undefined, basis);
  assert.ok(dot(a, b) > 0.9999, `after removal ${dot(a, b)}`);
  assert.ok(dot(owl, cat) < 0.8, `before removal ${dot(owl, cat)}`);
  assert.ok(dot(applyTransform(other, undefined, basis), a) < 0.9);
  for (const sp of species) assert.ok(Math.abs(dot(a, sp)) < 1e-5, 'no species component left');
});

test('orthonormalize drops dependent vectors', () => {
  const a = randomUnit(8, 1);
  const b = randomUnit(8, 2);
  const basis = orthonormalize([a, b, a.map((x, j) => 2 * x - b[j])]);
  assert.equal(basis.length, 2);
  assert.ok(Math.abs(dot(basis[0], basis[1])) < 1e-6);
});

test('rank with all transforms still finds an exact match first', () => {
  const dim = 32;
  const vecs = Array.from({ length: 30 }, (_, i) => randomUnit(dim, i + 300));
  const data = new Int8Array(30 * dim);
  vecs.forEach((v, i) => data.set(quantizeInt8(v), i * dim));
  const all = Array.from({ length: dim }, (_, j) => vecs.reduce((s, v) => s + v[j], 0) / vecs.length);
  const speciesBasis = orthonormalize([randomUnit(dim, 1), randomUnit(dim, 2)]).map((b) => Array.from(b));
  const meta = fakeMeta(30, dim, { means: { all }, speciesBasis });
  const prepared = new PreparedIndex(new Int8Index(data, dim), makeTransform(meta, { center: 'global', removeSpecies: true }));
  const zero = new Float32Array(dim);
  const top = rank(vecs[17], prepared, { adjust: false, w: 1, topK: 3, textPhoto: zero, textPainting: zero });
  assert.equal(top[0].index, 17);
  assert.ok(top[0].clip > 0.99);
});
