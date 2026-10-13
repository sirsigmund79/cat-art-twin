import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Int8Index, adjustEmbedding, colorSimilarity, normalize, quantizeInt8, rank } from '../../shared/score.ts';
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
  const index = new Int8Index(data, dim);
  const q = randomUnit(dim, 999);
  const approx = index.cosineAll(q);
  vecs.forEach((v, i) => assert.ok(Math.abs(approx[i] - dot(q, v)) < 0.01, `vector ${i}`));
});

test('rank returns the exact vector first and respects topK', () => {
  const dim = 64;
  const vecs = Array.from({ length: 20 }, (_, i) => randomUnit(dim, i + 7));
  const data = new Int8Array(20 * dim);
  vecs.forEach((v, i) => data.set(quantizeInt8(v), i * dim));
  const zero = new Float32Array(dim);
  const top = rank(vecs[13], new Int8Index(data, dim), {
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
  const index = new Int8Index(data, dim);
  assert.equal(rank(a, index, { ...opts, w: 1 })[0].index, 0);
  assert.equal(rank(a, index, { ...opts, w: 0.5 })[0].index, 1);
});
