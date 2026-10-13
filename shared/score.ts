import type { PaletteColor } from './types.ts';

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

/** score = cosine(query, art) * w + colorSimilarity * (1 - w); returns the top K, best first. */
export function rank(photoEmbedding: ArrayLike<number>, index: Int8Index, opts: RankOptions): Match[] {
  const query = opts.adjust
    ? adjustEmbedding(photoEmbedding, opts.textPhoto, opts.textPainting)
    : normalize(photoEmbedding);
  const clip = index.cosineAll(query);
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
