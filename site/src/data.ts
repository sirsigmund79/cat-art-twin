import { DEFAULT_SCORING } from '../../shared/config.ts';
import { Int8Index, makeCentering, type Centering } from '../../shared/score.ts';
import type { SiteMeta } from '../../shared/types.ts';

export interface ArtData {
  meta: SiteMeta;
  index: Int8Index;
  /** Built once per page load; the index caches per-centering work across searches. */
  center?: Centering;
}

/** Load meta.json and index.bin from the site root. Returns null when the index hasn't been built yet. */
export async function loadArtData(): Promise<ArtData | null> {
  const [metaRes, binRes] = await Promise.all([fetch('meta.json'), fetch('index.bin')]);
  if (!metaRes.ok || !binRes.ok || !metaRes.headers.get('content-type')?.includes('json')) return null;
  const meta = (await metaRes.json()) as SiteMeta;
  const index = new Int8Index(new Int8Array(await binRes.arrayBuffer()), meta.dim);
  if (index.count !== meta.count) throw new Error(`index.bin has ${index.count} vectors, meta.json says ${meta.count}`);
  return { meta, index, center: makeCentering(meta, DEFAULT_SCORING.center) };
}
