import type { Source } from '../../shared/types.ts';

export type { Source };

/** One normalized artwork from a museum API (data/raw/<source>.jsonl). */
export interface ArtworkRecord {
  id: string;
  source: Source;
  title: string;
  artist: string;
  date: string;
  imageUrl: string;
  objectUrl: string;
  license: string;
}

/** A box in normalized image coordinates (0..1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScoreRecord {
  catScore: number;
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
}

export type ReviewFile = Record<string, ReviewEntry>;

export interface EmbeddingRecord {
  /** boxKey() of the box the crop was cut with; a change triggers re-embedding. */
  box: string;
  /** int8 values of the L2-normalized embedding. */
  vec: number[];
}
