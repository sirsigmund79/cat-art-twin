import fs from 'node:fs';
import path from 'node:path';
import { RAW } from './paths.ts';
import type { ArtworkRecord } from './types.ts';

export function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/** Write via a temp file and rename, so an interrupted run never leaves half a file. */
export function writeJson(file: string, value: unknown, pretty = false): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, pretty ? 2 : undefined));
  fs.renameSync(tmp, file);
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

export function writeJsonl(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

export function artworkKey(r: Pick<ArtworkRecord, 'source' | 'id'>): string {
  return `${r.source}-${r.id}`;
}

/** Every scraped artwork, keyed by `source-id`. */
export function loadArtworks(): Map<string, ArtworkRecord> {
  const out = new Map<string, ArtworkRecord>();
  if (!fs.existsSync(RAW)) return out;
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.jsonl'))) {
    for (const r of readJsonl<ArtworkRecord>(path.join(RAW, f))) out.set(artworkKey(r), r);
  }
  return out;
}

/** Run `fn` over items, saving progress every `every` items and on Ctrl-C. */
export async function forEachWithCheckpoint<T>(
  items: T[],
  fn: (item: T, i: number) => Promise<void>,
  save: () => void,
  every = 50,
): Promise<void> {
  const onSigint = () => {
    save();
    console.log('\nInterrupted; progress saved.');
    process.exit(130);
  };
  process.on('SIGINT', onSigint);
  try {
    for (let i = 0; i < items.length; i++) {
      await fn(items[i], i);
      if ((i + 1) % every === 0) {
        save();
        console.log(`  ${i + 1}/${items.length}`);
      }
    }
  } finally {
    save();
    process.off('SIGINT', onSigint);
  }
}
