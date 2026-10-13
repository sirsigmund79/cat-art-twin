import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  pipeline,
  type Tensor,
} from '@huggingface/transformers';
import sharp, { type Sharp } from 'sharp';
import { CLIP_DTYPE, CLIP_MODEL } from '../../shared/config.ts';
import { normalize } from '../../shared/score.ts';
import type { Box } from './types.ts';

export const DETECTOR_MODEL = 'Xenova/owlvit-base-patch32';

/** Decode any image sharp can read into a Transformers.js RawImage (RGB). */
export async function toRawImage(input: string | Buffer | Sharp): Promise<RawImage> {
  const img = typeof input === 'string' || Buffer.isBuffer(input) ? sharp(input) : input;
  const { data, info } = await img.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
}

function rows(t: Tensor): Float32Array[] {
  const [n, dim] = t.dims;
  const data = t.data as Float32Array;
  return Array.from({ length: n }, (_, i) => normalize(data.subarray(i * dim, (i + 1) * dim)));
}

export async function loadClipVision() {
  const processor = await AutoProcessor.from_pretrained(CLIP_MODEL);
  const model = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: CLIP_DTYPE });
  /** Normalized image embeddings, one per input. */
  return async (images: RawImage[]): Promise<Float32Array[]> => {
    const inputs = await processor(images);
    const { image_embeds } = await model(inputs);
    return rows(image_embeds);
  };
}

export async function loadClipText() {
  const tokenizer = await AutoTokenizer.from_pretrained(CLIP_MODEL);
  const model = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { dtype: CLIP_DTYPE });
  /** Normalized text embeddings, one per prompt. */
  return async (texts: string[]): Promise<Float32Array[]> => {
    const inputs = tokenizer(texts, { padding: true, truncation: true });
    const { text_embeds } = await model(inputs);
    return rows(text_embeds);
  };
}

export interface Detection {
  box: Box;
  score: number;
}

export async function loadCatDetector() {
  const detector = await pipeline('zero-shot-object-detection', DETECTOR_MODEL);
  /** Cat boxes above `threshold`, in normalized coordinates, after non-max suppression. */
  return async (image: RawImage, threshold: number): Promise<Detection[]> => {
    const out = await detector(image, ['a cat'], { threshold, percentage: false });
    const dets = out.map((d) => {
      const x0 = clamp01(d.box.xmin / image.width);
      const y0 = clamp01(d.box.ymin / image.height);
      const x1 = clamp01(d.box.xmax / image.width);
      const y1 = clamp01(d.box.ymax / image.height);
      return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, score: d.score };
    });
    return nms(dets.filter((d) => d.box.w > 0.02 && d.box.h > 0.02));
  };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Greedy non-max suppression; OWL-ViT often returns several overlapping boxes per cat. */
export function nms(dets: Detection[], maxIou = 0.5): Detection[] {
  const kept: Detection[] = [];
  for (const d of [...dets].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k.box, d.box) < maxIou)) kept.push(d);
  }
  return kept;
}

/** Pad a normalized box by `pad` of its size on each side, clamped to the image. */
export function padBox(box: Box, pad: number): Box {
  const x0 = clamp01(box.x - box.w * pad);
  const y0 = clamp01(box.y - box.h * pad);
  const x1 = clamp01(box.x + box.w * (1 + pad));
  const y1 = clamp01(box.y + box.h * (1 + pad));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Cut a normalized box out of an image file and fit it within `size` px as JPEG. */
export async function cutCrop(file: string, box: Box | null, size: number): Promise<Buffer> {
  let img = sharp(file).rotate();
  if (box) {
    const { width = 0, height = 0 } = await sharp(file).rotate().metadata();
    const left = Math.round(box.x * width);
    const top = Math.round(box.y * height);
    img = img.extract({
      left,
      top,
      width: Math.max(1, Math.min(width - left, Math.round(box.w * width))),
      height: Math.max(1, Math.min(height - top, Math.round(box.h * height))),
    });
  }
  return img.resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}
