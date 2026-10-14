// Settings shared by the offline pipeline, the eval script and the browser.
// Changing CLIP_MODEL or CLIP_DTYPE means re-running scripts 05-07.

/** CLIP checkpoint used for every embedding, offline and in the browser. */
export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
/** Quantization used offline and for the browser's WASM path, so both produce matching vectors. */
export const CLIP_DTYPE = 'q8' as const;
export const EMBED_DIM = 512;

/** Text prompts whose difference shifts a photo embedding toward "painting" space. */
export const PHOTO_PROMPT = 'a photo of a cat';
export const PAINTING_PROMPT = 'a painting of a cat';

/** Default scoring settings. Phase 6 (scripts/eval.ts) decides these. */
export const DEFAULT_SCORING = {
  /**
   * Apply photo -> painting embedding arithmetic. Off: it adds the same large shift to every query,
   * which made the same few images win for every cat.
   */
  adjust: false,
  /** Subtract average embeddings before comparing (see CenterMode in score.ts). */
  center: 'kind' as 'off' | 'global' | 'kind',
  /** Weight of CLIP similarity versus color similarity (1 = CLIP only). */
  w: 0.85,
};

/** Number of colors in each palette. */
export const PALETTE_SIZE = 4;
/** Fraction of each side kept when taking the central region for palettes. */
export const PALETTE_CENTER = 0.6;
