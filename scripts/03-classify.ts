// Phase 2a: zero-shot CLIP score for "does this show an animal (artwork or photo)?" -> data/scores.json.
// Also records whether CLIP sees the image as a photo or as art, and how old it looks.
import fs from 'node:fs';
import { loadClipText, loadClipVision, toRawImage } from './lib/models.ts';
import { forEachWithCheckpoint, readJson, writeJson } from './lib/io.ts';
import { IMAGES, SCORES, imagePath } from './lib/paths.ts';
import { CAT_PROMPTS, CLASSIFY_MIN, DECOY_PROMPTS, ERA_PROMPTS, PROMPTS_VERSION } from './lib/thresholds.ts';
import type { ScoreRecord } from './lib/types.ts';

const BATCH = 16;
/** CLIP's learned logit scale (exp(4.6052) = 100). */
const LOGIT_SCALE = 100;

async function main() {
  const keys = fs
    .readdirSync(IMAGES)
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => f.slice(0, -4));
  const scores = readJson<Record<string, ScoreRecord>>(SCORES, {});
  // Scores from an older prompt set are recomputed (fast: CLIP only, no detection).
  const todo = keys.filter((k) => scores[k]?.v !== PROMPTS_VERSION);
  console.log(`${keys.length} images, ${keys.length - todo.length} already scored, ${todo.length} to go`);

  const prompts = [CAT_PROMPTS.art, CAT_PROMPTS.photo, ...DECOY_PROMPTS];
  const eraPrompts = [...ERA_PROMPTS.old, ...ERA_PROMPTS.modern];
  const encodeText = await loadClipText();
  const textEmbeds = await encodeText(prompts);
  const eraEmbeds = await encodeText(eraPrompts);
  const embed = await loadClipVision();

  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  await forEachWithCheckpoint(
    batches,
    async (batch) => {
      const images = await Promise.all(batch.map((k) => toRawImage(imagePath(k))));
      const vecs = await embed(images);
      batch.forEach((key, i) => {
        const logits = textEmbeds.map((t) => LOGIT_SCALE * dot(vecs[i], t));
        const probs = softmax(logits);
        const era = softmax(eraEmbeds.map((t) => LOGIT_SCALE * dot(vecs[i], t)));
        const old = era.slice(0, ERA_PROMPTS.old.length).reduce((a, b) => a + b, 0);
        scores[key] = {
          old: round(old),
          catScore: round(probs[0] + probs[1]),
          kind: probs[1] > probs[0] ? 'photo' : 'art',
          v: PROMPTS_VERSION,
          probs: Object.fromEntries(prompts.map((p, j) => [p, round(probs[j])])),
        };
      });
    },
    () => writeJson(SCORES, scores),
    5,
  );

  const photos = Object.values(scores).filter((s) => s.kind === 'photo' && s.catScore >= CLASSIFY_MIN).length;
  const all = Object.values(scores).map((s) => s.catScore);
  const above = all.filter((s) => s >= CLASSIFY_MIN).length;
  console.log(`Scored ${all.length} images; ${above} have catScore >= ${CLASSIFY_MIN} and go on to detection (${photos} photos, ${above - photos} art).`);
  for (const t of [0.05, 0.15, 0.3, 0.5, 0.7, 0.9]) {
    console.log(`  catScore >= ${t}: ${all.filter((s) => s >= t).length}`);
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / sum);
}

const round = (x: number) => Math.round(x * 10000) / 10000;

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
