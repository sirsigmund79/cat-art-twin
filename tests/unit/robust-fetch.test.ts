import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { robustFetch } from '../../scripts/lib/robust-fetch.ts';

const FILE = crypto.randomBytes(3_000_000);
let server: http.Server;
let base = '';
let requests: { path: string; range?: string }[] = [];
let failNextConnects = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requests.push({ path: req.url!, range: req.headers.range });
    if (req.url === '/missing') return void res.writeHead(404).end();
    if (failNextConnects > 0) {
      failNextConnects--;
      return void req.socket.destroy();
    }
    const probe = /^bytes=0-0$/.test(req.headers.range ?? '');
    if (probe) {
      res.writeHead(206, { 'content-range': `bytes 0-0/${FILE.length}`, 'content-length': 1 });
      return void res.end(FILE.subarray(0, 1));
    }
    const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
    const body = FILE.subarray(start);
    res.writeHead(start ? 206 : 200, {
      'content-type': 'application/octet-stream',
      'content-length': body.length,
      ...(start ? { 'content-range': `bytes ${start}-${FILE.length - 1}/${FILE.length}` } : {}),
    });
    if (req.url === '/flaky') {
      // Send under 1 MB, then drop the connection, every time.
      res.write(body.subarray(0, Math.min(body.length, 900_000)));
      if (body.length > 900_000) return void setTimeout(() => req.socket.destroy(), 20);
      return void res.end();
    }
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test('resumes a download that keeps getting cut off', async () => {
  requests = [];
  const res = await robustFetch()(`${base}/flaky`);
  assert.equal(res.status, 200);
  const got = Buffer.from(await res.arrayBuffer());
  assert.equal(got.length, FILE.length);
  assert.ok(got.equals(FILE), 'bytes match');
  // How many bytes arrive before each drop varies with timing; what matters is that every retry
  // resumes from a later offset instead of starting over.
  assert.ok(requests.length >= 4, `${requests.length} requests`);
  assert.equal(requests[0].range, undefined);
  const offsets = requests.slice(1).map((r) => Number(/^bytes=(\d+)-$/.exec(r.range ?? '')?.[1]));
  offsets.forEach((o, i) => assert.ok(o > (offsets[i - 1] ?? 0), `offset ${o} after ${offsets[i - 1]}`));
});

test('retries failed connections', async () => {
  failNextConnects = 2;
  const got = Buffer.from(await (await robustFetch()(`${base}/ok`)).arrayBuffer());
  assert.ok(got.equals(FILE));
});

test('passes 404s through for optional files', async () => {
  assert.equal((await robustFetch()(`${base}/missing`)).status, 404);
});

test('metadata range probes are passed through with retries', async () => {
  failNextConnects = 1;
  const res = await robustFetch()(`${base}/ok`, { headers: { Range: 'bytes=0-0' } });
  assert.equal(res.status, 206);
  await res.body?.cancel();
});
