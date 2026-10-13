import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nms, padBox } from '../../scripts/lib/models.ts';

test('nms drops overlapping lower-score boxes and keeps separate ones', () => {
  const kept = nms([
    { box: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, score: 0.3 },
    { box: { x: 0.12, y: 0.1, w: 0.4, h: 0.4 }, score: 0.5 },
    { box: { x: 0.6, y: 0.6, w: 0.3, h: 0.3 }, score: 0.2 },
  ]);
  assert.deepEqual(
    kept.map((d) => d.score),
    [0.5, 0.2],
  );
});

test('padBox pads by a fraction of box size and clamps to the image', () => {
  const p = padBox({ x: 0.5, y: 0.5, w: 0.2, h: 0.4 }, 0.1);
  assert.ok(Math.abs(p.x - 0.48) < 1e-9 && Math.abs(p.w - 0.24) < 1e-9);
  assert.ok(Math.abs(p.y - 0.46) < 1e-9 && Math.abs(p.h - 0.48) < 1e-9);
  const edge = padBox({ x: 0, y: 0.9, w: 0.5, h: 0.1 }, 0.1);
  assert.equal(edge.x, 0);
  assert.ok(Math.abs(edge.y + edge.h - 1) < 1e-9);
});
