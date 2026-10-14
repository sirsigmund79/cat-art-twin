import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { readUprightImage } from '../../scripts/lib/heic.ts';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures');

test('decodes an iPhone-style HEIC photo', async () => {
  const out = await readUprightImage(path.join(FIXTURES, 'cat.heic'));
  const m = await sharp(out).metadata();
  assert.equal(m.format, 'jpeg');
  assert.deepEqual([m.width, m.height], [451, 300]);
});

test('applies EXIF rotation so the detector and cropper agree', async () => {
  // Same photo stored sideways with an "rotate 90°" flag, as phones often save it.
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cat-')), 'rotated.jpg');
  await sharp(path.join(FIXTURES, 'cat.jpg')).rotate(-90).withMetadata({ orientation: 6 }).toFile(tmp);
  const out = await readUprightImage(tmp);
  const m = await sharp(out).metadata();
  assert.deepEqual([m.width, m.height], [451, 300]);
  assert.equal(m.orientation ?? 1, 1);
});

test('limits the long side', async () => {
  const m = await sharp(await readUprightImage(path.join(FIXTURES, 'cat.jpg'), 200)).metadata();
  assert.equal(Math.max(m.width!, m.height!), 200);
});
