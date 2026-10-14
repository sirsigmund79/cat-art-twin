// A fetch for Transformers.js model downloads on flaky connections. Every request is retried,
// and full-file downloads go to disk first so a connection reset resumes (HTTP Range) from the
// last byte received instead of starting the file, or the whole model, over.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DATA } from './paths.ts';

const TRIES = 10;
const PARTIAL_DIR = path.join(DATA, 'model-downloads');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);
const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

/** Total size from a 200 Content-Length or a 206 Content-Range ("bytes 0-99/1234"). */
function totalSize(res: Response): number | null {
  const range = res.headers.get('content-range');
  if (range) {
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : null;
  }
  const len = Number(res.headers.get('content-length'));
  return res.status === 200 && Number.isFinite(len) && len > 0 ? len : null;
}

async function retryFetch(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      if (!retryable(res.status) || attempt >= TRIES - 1) return res;
      await res.body?.cancel();
    } catch (err) {
      if (attempt >= TRIES - 1) throw err;
    }
    await sleep(backoff(attempt));
  }
}

async function downloadToFile(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  fs.mkdirSync(PARTIAL_DIR, { recursive: true });
  const file = path.join(PARTIAL_DIR, crypto.createHash('sha1').update(url).digest('hex'));
  const name = decodeURIComponent(new URL(url).pathname.split('/').slice(-2).join('/'));
  let contentType = 'application/octet-stream';
  let total: number | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (attempt > 0) await sleep(backoff(attempt - 1));
    const have = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const headers = new Headers(init.headers);
    if (have > 0) headers.set('Range', `bytes=${have}-`);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, headers });
    } catch (err) {
      lastError = err;
      continue;
    }
    // 416: the requested range starts at or past the end. Done if the file is complete, else start over.
    if (res.status === 416 && have > 0) {
      await res.body?.cancel();
      total = totalSize(res) ?? total;
      if (total !== null && have >= total) break;
      fs.rmSync(file, { force: true });
      continue;
    }
    if (!res.ok) {
      if (retryable(res.status)) {
        await res.body?.cancel();
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res; // 404 and friends: let Transformers.js decide (some files are optional).
    }
    contentType = res.headers.get('content-type') ?? contentType;
    total = totalSize(res) ?? total;
    // A 200 to a Range request means the server sent the whole file again.
    const append = res.status === 206 && have > 0;
    const out = fs.createWriteStream(file, { flags: append ? 'a' : 'w' });
    try {
      for await (const chunk of Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)) {
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (err) {
      await new Promise((r) => out.end(r));
      lastError = err;
      const got = fs.statSync(file).size;
      console.warn(`  ${name}: connection dropped at ${(got / 1e6).toFixed(1)} MB; resuming`);
      continue;
    }
    const size = fs.statSync(file).size;
    if (total === null || size >= total) break;
    lastError = new Error(`incomplete download (${size} of ${total} bytes)`);
  }

  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (!size || (total !== null && size < total)) throw lastError ?? new Error(`could not download ${url}`);
  // Transformers.js copies the body into its own cache, so the temporary file can go once read.
  const stream = fs.createReadStream(file);
  stream.on('close', () => fs.rm(file, { force: true }, () => {}));
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': String(size) },
  });
}

/** Wrap a fetch implementation; non-HTTP URLs and requests with a body pass straight through. */
export function robustFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (!/^https?:/.test(url) || method !== 'GET') return fetchImpl(input, init);
    // Metadata probes ask for a byte range; they're tiny, so plain retries are enough.
    if (new Headers(init.headers).has('Range')) return retryFetch(url, init, fetchImpl);
    return downloadToFile(url, init, fetchImpl);
  }) as typeof fetch;
}
