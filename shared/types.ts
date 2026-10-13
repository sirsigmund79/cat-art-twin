export type Source = 'met' | 'aic' | 'cma';

export interface PaletteColor {
  /** CIELAB coordinates. */
  lab: [number, number, number];
  hex: string;
  /** Share of sampled pixels in this cluster (palette weights sum to 1). */
  weight: number;
}

export interface MetaItem {
  cropId: string;
  /** Path relative to the site root. */
  crop: string;
  title: string;
  artist: string;
  date: string;
  museum: string;
  objectUrl: string;
  license: string;
  colors: PaletteColor[];
  starred: boolean;
}

export interface SiteMeta {
  model: string;
  dtype: string;
  dim: number;
  count: number;
  /** Normalized CLIP text embeddings for PHOTO_PROMPT and PAINTING_PROMPT. */
  textPhoto: number[];
  textPainting: number[];
  /** Same order as the vectors in index.bin. */
  items: MetaItem[];
}

export const MUSEUM_NAMES: Record<Source, string> = {
  met: 'The Metropolitan Museum of Art',
  aic: 'Art Institute of Chicago',
  cma: 'Cleveland Museum of Art',
};
