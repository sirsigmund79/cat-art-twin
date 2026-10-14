// Phase 2 thresholds. Kept generous on purpose: human review comes next.

/** Images with catScore below this skip detection (they show up in the review tool's rescue tab). */
export const CLASSIFY_MIN = 0.15;
/** OWL-ViT boxes at or above this score become crops. */
export const DETECT_MIN = 0.1;
/**
 * An image with no box at DETECT_MIN still gets its single best box if it scores at least this.
 * On the first 147 AIC/CMA candidates, a third of these near-misses were real cats.
 * Detections are saved down to this score, so lowering it further needs a re-detect.
 */
export const DETECT_BEST_MIN = 0.05;
/** With no box found, keep the whole image when catScore is at least this. */
export const FALLBACK_MIN = 0.6;
/** Padding added around detected boxes, as a fraction of box size per side. */
export const CROP_PAD = 0.1;
/** Long edge of crop thumbnails, in pixels. */
export const CROP_SIZE = 400;

export const CAT_PROMPT = 'an artwork depicting a cat';
export const DECOY_PROMPTS = [
  'a lion',
  'a tiger',
  'a dog',
  'text on a page',
  'a decorative pattern',
  'a landscape',
  'a portrait of a person',
];
