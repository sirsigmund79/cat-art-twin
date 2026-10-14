import type { PaletteColor, SiteMeta } from './types.ts';

export function normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Move a photo embedding toward painting space: photo - text(photo) + text(painting), re-normalized. */
export function adjustEmbedding(
  photo: ArrayLike<number>,
  textPhoto: ArrayLike<number>,
  textPainting: ArrayLike<number>,
): Float32Array {
  const p = normalize(photo);
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i] - textPhoto[i] + textPainting[i];
  return normalize(out);
}

/** L2-normalize then scale to int8 using the vector's own max magnitude. */
export function quantizeInt8(v: ArrayLike<number>): Int8Array {
  const n = normalize(v);
  let max = 0;
  for (const x of n) max = Math.max(max, Math.abs(x));
  const scale = max > 0 ? 127 / max : 0;
  const out = new Int8Array(n.length);
  for (let i = 0; i < n.length; i++) out[i] = Math.round(n[i] * scale);
  return out;
}

/** Orthonormalize vectors (Gram-Schmidt), dropping ones that are (nearly) dependent. */
export function orthonormalize(vectors: ArrayLike<number>[]): Float32Array[] {
  const basis: Float32Array[] = [];
  for (const v of vectors) {
    const r = Float32Array.from(v);
    for (const b of basis) {
      const d = dot(r, b);
      for (let j = 0; j < r.length; j++) r[j] -= d * b[j];
    }
    const n = Math.sqrt(dot(r, r));
    if (n > 1e-4) basis.push(r.map((x) => x / n));
  }
  return basis;
}

/** An int8 index of `count` vectors of length `dim`, stored back to back. */
export class Int8Index {
  readonly count: number;

  constructor(
    readonly data: Int8Array,
    readonly dim: number,
  ) {
    if (data.length % dim !== 0) throw new Error(`index length ${data.length} is not a multiple of ${dim}`);
    this.count = data.length / dim;
  }

  /** Vector i, L2-normalized. */
  unit(i: number): Float32Array {
    return normalize(this.data.subarray(i * this.dim, (i + 1) * this.dim));
  }
}

/**
 * Changes applied to every embedding before comparing.
 *
 * - Centering: subtract the average embedding. What every image shares otherwise lets a few generic
 *   "hub" images win for every query. Separate means for art and photos ('kind', with the photo mean
 *   for the visitor's photo) also cancel the photo-vs-art difference.
 * - Species removal: project out the directions CLIP uses to tell animal species apart (from text
 *   embeddings of animal names), so matching runs on coloring, markings, pose and expression, and a
 *   cat can match an owl or a fox.
 */
export type CenterMode = 'off' | 'global' | 'kind';

export interface Transform {
  means?: ArrayLike<number>[];
  /** Index into `means` for each index vector. */
  group?: ArrayLike<number>;
  queryMean?: ArrayLike<number>;
  /** Orthonormal directions to project out. */
  basis?: ArrayLike<number>[];
}

export function makeTransform(meta: SiteMeta, opts: { center: CenterMode; removeSpecies: boolean }): Transform {
  const t: Transform = {};
  const m = meta.means;
  if (opts.center !== 'off' && m) {
    if (opts.center === 'kind' && m.art && m.photo) {
      t.means = [m.art, m.photo];
      t.group = Uint8Array.from(meta.items, (i) => (i.kind === 'photo' ? 1 : 0));
      t.queryMean = m.photo;
    } else {
      t.means = [m.all];
      t.group = new Uint8Array(meta.count);
      t.queryMean = m.all;
    }
  }
  if (opts.removeSpecies && meta.speciesBasis?.length) t.basis = meta.speciesBasis;
  return t;
}

/** normalize -> subtract mean -> project out basis -> normalize. */
export function applyTransform(v: ArrayLike<number>, mean: ArrayLike<number> | undefined, basis?: ArrayLike<number>[]): Float32Array {
  const out = normalize(v);
  if (mean) for (let j = 0; j < out.length; j++) out[j] -= mean[j];
  if (basis) {
    for (const b of basis) {
      const d = dot(out, b);
      for (let j = 0; j < out.length; j++) out[j] -= d * b[j];
    }
  }
  return normalize(out);
}

/** The index with a Transform applied once up front, so each search is a plain dot product per item. */
export class PreparedIndex {
  readonly count: number;
  readonly dim: number;
  private readonly vecs: Float32Array;

  constructor(
    index: Int8Index,
    readonly transform: Transform = {},
  ) {
    this.count = index.count;
    this.dim = index.dim;
    this.vecs = new Float32Array(index.count * index.dim);
    const { means, group, basis } = transform;
    for (let i = 0; i < index.count; i++) {
      const mean = means && group ? means[group[i]] : undefined;
      this.vecs.set(applyTransform(index.unit(i), mean, basis), i * index.dim);
    }
  }

  /** Transform a query embedding the same way (with the query mean). */
  prepareQuery(v: ArrayLike<number>): Float32Array {
    return applyTransform(v, this.transform.queryMean, this.transform.basis);
  }

  /** Cosine similarity of a prepared query against every item. */
  scores(query: Float32Array): Float32Array {
    const { vecs, dim } = this;
    const out = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      let s = 0;
      const base = i * dim;
      for (let j = 0; j < dim; j++) s += query[j] * vecs[base + j];
      out[i] = s;
    }
    return out;
  }
}

function deltaE(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Palette similarity in [0, 1]. Each color is matched to its nearest color in the other palette,
 * weighted by its share; done both ways and averaged. SIGMA sets how fast similarity falls with distance.
 */
const SIGMA = 25;
export function colorSimilarity(a: PaletteColor[], b: PaletteColor[]): number {
  if (!a.length || !b.length) return 0;
  const oneWay = (from: PaletteColor[], to: PaletteColor[]) => {
    let s = 0;
    for (const c of from) {
      let best = Infinity;
      for (const d of to) best = Math.min(best, deltaE(c.lab, d.lab));
      s += c.weight * Math.exp(-best / SIGMA);
    }
    return s;
  };
  return (oneWay(a, b) + oneWay(b, a)) / 2;
}

export interface RankOptions {
  adjust: boolean;
  w: number;
  topK: number;
  textPhoto: ArrayLike<number>;
  textPainting: ArrayLike<number>;
  photoPalette?: PaletteColor[];
  palettes?: PaletteColor[][];
}

export interface Match {
  index: number;
  score: number;
  clip: number;
  color: number;
}

/** score = cosine(query, item) * w + colorSimilarity * (1 - w); returns the top K, best first. */
export function rank(photoEmbedding: ArrayLike<number>, index: PreparedIndex, opts: RankOptions): Match[] {
  const raw = opts.adjust ? adjustEmbedding(photoEmbedding, opts.textPhoto, opts.textPainting) : photoEmbedding;
  const clip = index.scores(index.prepareQuery(raw));
  const useColor = opts.w < 1 && opts.photoPalette && opts.palettes;
  const matches: Match[] = new Array(index.count);
  for (let i = 0; i < index.count; i++) {
    const color = useColor ? colorSimilarity(opts.photoPalette!, opts.palettes![i]) : 0;
    const score = useColor ? clip[i] * opts.w + color * (1 - opts.w) : clip[i];
    matches[i] = { index: i, score, clip: clip[i], color };
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, opts.topK);
}
