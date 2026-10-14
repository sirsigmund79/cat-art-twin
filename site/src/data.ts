import { DEFAULT_SCORING } from '../../shared/config.ts';
import { Int8Index, PreparedIndex, makeTransform } from '../../shared/score.ts';
import type { SiteMeta } from '../../shared/types.ts';

export interface ArtData {
  meta: SiteMeta;
  /** The index with the default centering and species removal applied once, at load. */
  index: PreparedIndex;
}

/** Load meta.json and index.bin from the site root. Returns null when the index hasn't been built yet. */
export async function loadArtData(): Promise<ArtData | null> {
  const [metaRes, binRes] = await Promise.all([fetch('meta.json'), fetch('index.bin')]);
  if (!metaRes.ok || !binRes.ok || !metaRes.headers.get('content-type')?.includes('json')) return null;
  const meta = (await metaRes.json()) as SiteMeta;
  const raw = new Int8Index(new Int8Array(await binRes.arrayBuffer()), meta.dim);
  if (raw.count !== meta.count) throw new Error(`index.bin has ${raw.count} vectors, meta.json says ${meta.count}`);
  return { meta, index: new PreparedIndex(raw, makeTransform(meta, DEFAULT_SCORING)) };
}
