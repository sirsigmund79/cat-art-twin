// Phase 2 thresholds. Kept generous on purpose: human review comes next.

// "catScore" is historically named: it's the probability that the image shows an animal.

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

/** Positive prompts; catScore is their combined probability. The winner sets the photo/art kind. */
export const CAT_PROMPTS = { art: 'an artwork depicting an animal', photo: 'a photo of an animal' } as const;
/** Bump when the prompts change, so existing scores are recomputed. */
export const PROMPTS_VERSION = 3;
export const DECOY_PROMPTS = [
  'text on a page',
  'a decorative pattern',
  'a landscape',
  'a portrait of a person',
  'a group of people',
  'a still life of flowers or fruit',
  'a building',
  'a photo of a person',
  'a photo of an object',
];
/** Era prompts: `old` is the combined probability of the first group. */
export const ERA_PROMPTS = {
  old: ['an old painting', 'an antique print or engraving', 'a vintage black and white photograph', 'a medieval manuscript illustration'],
  modern: ['a modern digital photograph', 'a contemporary digital illustration'],
};
/** OWL-ViT queries; any of them makes a box. Images detected before animals were added keep their cat boxes. */
export const DETECT_LABELS = ['a cat', 'a dog', 'a horse', 'a bird', 'a lion', 'a monkey', 'a rabbit', 'a cow', 'a fox', 'an animal'];

// Auto-keep: crops this confident skip hand review (they appear in the review tool's Auto-kept tab,
// where a reject still overrides). Explicit review decisions always win.
export const AUTO_KEEP_CAT = 0.9;
export const AUTO_KEEP_DET = 0.3;
