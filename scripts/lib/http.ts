const USER_AGENT = 'cat-art-twin (https://github.com/sirsigmund79/cat-art-twin)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Status codes worth retrying: rate limits, bot walls and transient server errors. */
const RETRY = new Set([403, 408, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(url: string, init: RequestInit = {}, tries = 6): Promise<Response> {
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, 'AIC-User-Agent': USER_AGENT, ...init.headers },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok || !RETRY.has(res.status)) return res;
    } catch (err) {
      if (attempt >= tries) throw err;
    }
    if (attempt >= tries) return res!;
    const retryAfter = Number(res?.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : delay + Math.random() * 250);
    delay = Math.min(delay * 2, 30_000);
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}
