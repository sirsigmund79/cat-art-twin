import crypto from 'node:crypto';
import path from 'node:path';
import { fetchJson } from '../http.ts';
import { readJson, writeJson } from '../io.ts';
import { CACHE } from '../paths.ts';

export const clean = (s: unknown) =>
  typeof s === 'string'
    ? s
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-source cap on records, from e.g. COMMONS_MAX; keeps the first runs (and the review) manageable. */
export function cap(envName: string, fallback: number): number {
  const n = Number(process.env[envName]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * GET JSON, cached on disk by URL so an interrupted fetch resumes for free.
 * `redact` strips secrets (API keys) from the cache key.
 */
export async function cachedJson<T>(source: string, url: string, redact: string[] = [], delayMs = 0): Promise<T> {
  let key = url;
  for (const r of redact) if (r) key = key.split(r).join('KEY');
  const file = path.join(CACHE, source, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);
  const hit = readJson<T | null>(file, null);
  if (hit) return hit;
  if (delayMs) await sleep(delayMs);
  const res = await fetchJson<T>(url);
  writeJson(file, res);
  return res;
}
