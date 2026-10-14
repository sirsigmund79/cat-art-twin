import type { Kind, Source } from '../../shared/types.ts';

export type { Kind, Source };

/** One normalized image record from a source API (data/raw/<source>.jsonl). */
export interface ArtworkRecord {
  id: string;
  source: Source;
  title: string;
  /** Artist, photographer or uploader to credit. */
  artist: string;
  date: string;
  imageUrl: string;
  /** Page for this work at its source (museum object page, Commons file page, Flickr photo page). */
  objectUrl: string;
  /** Short license label from licenses.ts, e.g. "CC BY-SA 4.0". */
  license: string;
  /** Link to the license; may be missing on older records. */
  licenseUrl?: string;
  /** Holding institution when the source is an aggregator (Europeana). */
  provider?: string;
}

/** A box in normalized image coordinates (0..1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScoreRecord {
  /**
   * Combined probability of the positive prompts: an artwork or photo of an animal. (Named from
   * when only cats were collected; kept so existing data files still read.)
   */
  catScore: number;
  /** CLIP's probability that the image looks old (painting, print, vintage photo) rather than modern. */
  old?: number;
  /** Which cat prompt won. Missing on scores from before photos were added. */
  kind?: Kind;
  /** Prompt-set version; scores from another version are recomputed. */
  v?: number;
  /** Softmax probability for every prompt, for debugging thresholds. */
  probs: Record<string, number>;
}

export interface CropRecord {
  cropId: string;
  /** `source-id` key of the artwork. */
  artworkId: string;
  /** Detected box before padding; null means the whole image. */
  box: Box | null;
  detScore: number | null;
  catScore: number;
  /** True when no box was found and the whole image was kept because catScore was high. */
  fallback: boolean;
}

export type Decision = 'keep' | 'reject' | 'star';

export interface ReviewEntry {
  decision?: Decision;
  /** Box drawn in the review tool, in normalized coordinates of the full image; used as-is (no padding). */
  box?: Box;
  /** Set for items added from the rescue tab (images filtered out in Phase 2). */
  rescue?: boolean;
  /** Set for decisions made in the Auto-kept tab, so the crop stays listed there. */
  auto?: boolean;
}

export type ReviewFile = Record<string, ReviewEntry>;

export interface EmbeddingRecord {
  /** boxKey() of the box the crop was cut with; a change triggers re-embedding. */
  box: string;
  /** int8 values of the L2-normalized embedding. */
  vec: number[];
}
