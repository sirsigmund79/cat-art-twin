import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dominantColors } from '../../shared/palette.ts';

function image(w: number, h: number, color: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = color(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return data;
}

test('finds the two colors of a split image, weighted by area', () => {
  // Left 3/4 orange, right 1/4 blue, inside a black border the center crop should ignore.
  const w = 200;
  const h = 200;
  const data = image(w, h, (x, y) => {
    if (x < 40 || x >= 160 || y < 40 || y >= 160) return [0, 0, 0];
    return x < 130 ? [230, 140, 60] : [40, 80, 200];
  });
  const palette = dominantColors(data, w, h, 2);
  assert.equal(palette.length, 2);
  assert.equal(palette[0].hex, '#e68c3c');
  assert.ok(Math.abs(palette[0].weight - 0.75) < 0.03, `weight ${palette[0].weight}`);
  assert.ok(palette.every((c) => c.lab[0] > 20), 'border was excluded');
  assert.ok(Math.abs(palette.reduce((s, c) => s + c.weight, 0) - 1) < 0.01);
});

test('is deterministic', () => {
  const data = image(64, 64, (x, y) => [(x * 4) % 256, (y * 4) % 256, 128]);
  assert.deepEqual(dominantColors(data, 64, 64), dominantColors(data, 64, 64));
});
