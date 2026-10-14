export type Source = 'met' | 'aic' | 'cma' | 'commons' | 'flickr' | 'europeana';

/** Whether CLIP sees the image as a photograph or as art (painting, print, drawing...). */
export type Kind = 'photo' | 'art';

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
  /** Where it comes from, e.g. "Art Institute of Chicago" or "Rijksmuseum via Europeana". */
  museum: string;
  objectUrl: string;
  /** Short license label, e.g. "Public domain" or "CC BY-NC 2.0". */
  license: string;
  /** Link to the license text; empty for public domain works without one. */
  licenseUrl: string;
  kind: Kind;
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
  /** Mean of the normalized index vectors: overall, and per kind when both kinds are present. */
  means?: { all: number[]; art?: number[]; photo?: number[] };
  /** Same order as the vectors in index.bin. */
  items: MetaItem[];
}

export const SOURCE_NAMES: Record<Source, string> = {
  met: 'The Metropolitan Museum of Art',
  aic: 'Art Institute of Chicago',
  cma: 'Cleveland Museum of Art',
  commons: 'Wikimedia Commons',
  flickr: 'Flickr',
  europeana: 'Europeana',
};
