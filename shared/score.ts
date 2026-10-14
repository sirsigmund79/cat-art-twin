import type { PaletteColor, SiteMeta } from './types.ts';

export function normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
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

/** An int8 index of `count` vectors of length `dim`, stored back to back. */
export class Int8Index {
  readonly count: number;
  private readonly norms: Float32Array;

  constructor(
    readonly data: Int8Array,
    readonly dim: number,
  ) {
    if (data.length % dim !== 0) throw new Error(`index length ${data.length} is not a multiple of ${dim}`);
    this.count = data.length / dim;
    this.norms = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      let s = 0;
      for (let j = i * dim, end = j + dim; j < end; j++) s += data[j] * data[j];
      this.norms[i] = Math.sqrt(s) || 1;
    }
  }

  private meanDots = new WeakMap<object, Float32Array>();

  /**
   * Cosine similarity of a normalized, already-centered query against every vector after
   * subtracting its group's mean: cos(q, v/|v| - means[group[i]]). Expanded so it needs one pass:
   * (q.v/|v| - q.m) / sqrt(1 - 2 m.v/|v| + m.m). The m.v terms are cached per `means` array.
   */
  cosineCentered(query: Float32Array, means: ArrayLike<number>[], group: ArrayLike<number>): Float32Array {
    const { data, dim } = this;
    let mv = this.meanDots.get(means);
    if (!mv) {
      mv = new Float32Array(this.count);
      for (let i = 0; i < this.count; i++) {
        const m = means[group[i]];
        let s = 0;
        for (let j = 0, base = i * dim; j < dim; j++) s += m[j] * data[base + j];
        mv[i] = s / this.norms[i];
      }
      this.meanDots.set(means, mv);
    }
    const qm = means.map((m) => dot(query, m));
    const mm = means.map((m) => dot(m, m));
    const out = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const g = group[i];
      let s = 0;
      const base = i * dim;
      for (let j = 0; j < dim; j++) s += query[j] * data[base + j];
      out[i] = (s / this.norms[i] - qm[g]) / Math.sqrt(Math.max(1e-9, 1 - 2 * mv[i] + mm[g]));
    }
    return out;
  }

  /** Cosine similarity of a normalized query against every vector. Per-vector scale cancels out. */
  cosineAll(query: Float32Array): Float32Array {
    const { data, dim } = this;
    const out = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      let s = 0;
      const base = i * dim;
      for (let j = 0; j < dim; j++) s += query[j] * data[base + j];
      out[i] = s / this.norms[i];
    }
    return out;
  }
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
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

/**
 * Subtracting the average embedding removes what every cat image shares ("this is a cat"), which
 * otherwise lets a few generic "hub" images win for every query. 'kind' uses separate means for art
 * and photos (and the photo mean for the visitor's photo), so the photo/art difference cancels too.
 */
export type CenterMode = 'off' | 'global' | 'kind';

export interface Centering {
  means: ArrayLike<number>[];
  /** Index into `means` for each index vector. */
  group: ArrayLike<number>;
  /** Mean subtracted from the query. */
  queryMean: ArrayLike<number>;
}

export function makeCentering(meta: SiteMeta, mode: CenterMode): Centering | undefined {
  const m = meta.means;
  if (mode === 'off' || !m) return undefined;
  if (mode === 'global' || !m.art || !m.photo) {
    return { means: [m.all], group: new Uint8Array(meta.count), queryMean: m.all };
  }
  return {
    means: [m.art, m.photo],
    group: Uint8Array.from(meta.items, (i) => (i.kind === 'photo' ? 1 : 0)),
    queryMean: m.photo,
  };
}

export interface RankOptions {
  adjust: boolean;
  center?: Centering;
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

/** score = cosine(query, art) * w + colorSimilarity * (1 - w); returns the top K, best first. */
export function rank(photoEmbedding: ArrayLike<number>, index: Int8Index, opts: RankOptions): Match[] {
  let query = opts.adjust
    ? adjustEmbedding(photoEmbedding, opts.textPhoto, opts.textPainting)
    : normalize(photoEmbedding);
  let clip: Float32Array;
  if (opts.center) {
    const qm = opts.center.queryMean;
    query = normalize(query.map((x, j) => x - qm[j]));
    clip = index.cosineCentered(query, opts.center.means, opts.center.group);
  } else {
    clip = index.cosineAll(query);
  }
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
