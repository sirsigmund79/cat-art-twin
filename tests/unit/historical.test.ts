import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isHistorical, parseYear } from '../../scripts/lib/historical.ts';

test('parses years from messy dates', () => {
  assert.equal(parseYear('ca. 1850'), 1850);
  assert.equal(parseYear('1890–95'), 1890);
  assert.equal(parseYear('19th century'), 1850);
  assert.equal(parseYear('late 17th century'), 1650);
  assert.equal(parseYear('2015-06-01 10:00:00'), 2015);
  assert.equal(parseYear('Edo period (1615–1868)'), 1615);
  assert.equal(parseYear('A.D. 850'), 850);
  assert.equal(parseYear(''), null);
  assert.equal(parseYear('undated'), null);
});

test('uses the date when there is one, else the source, else how old it looks', () => {
  assert.equal(isHistorical({ source: 'flickr', date: '2015' }, undefined), false);
  assert.equal(isHistorical({ source: 'flickr', date: '1925' }, undefined), true);
  assert.equal(isHistorical({ source: 'commons', date: '1959' }, undefined), true);
  assert.equal(isHistorical({ source: 'commons', date: '1960' }, undefined), false);
  assert.equal(isHistorical({ source: 'met', date: '' }, undefined), true);
  assert.equal(isHistorical({ source: 'commons', date: '' }, { catScore: 0.9, probs: {}, old: 0.8 }), true);
  assert.equal(isHistorical({ source: 'commons', date: '' }, { catScore: 0.9, probs: {}, old: 0.2 }), false);
  assert.equal(isHistorical({ source: 'commons', date: '' }, { catScore: 0.9, probs: {} }), false);
  assert.equal(isHistorical(undefined, undefined), false);
});
