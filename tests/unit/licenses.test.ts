import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLicense } from '../../scripts/lib/licenses.ts';

test('accepts BY, BY-SA, BY-NC and BY-NC-SA from URLs', () => {
  assert.deepEqual(normalizeLicense('https://creativecommons.org/licenses/by-nc/2.0/'), {
    label: 'CC BY-NC 2.0',
    url: 'https://creativecommons.org/licenses/by-nc/2.0/',
  });
  assert.equal(normalizeLicense('http://creativecommons.org/licenses/by-sa/4.0/deed.en')?.label, 'CC BY-SA 4.0');
  assert.equal(normalizeLicense('https://creativecommons.org/licenses/by-nc-sa/3.0')?.label, 'CC BY-NC-SA 3.0');
  assert.equal(normalizeLicense('https://creativecommons.org/licenses/by/2.5/')?.label, 'CC BY 2.5');
});

test('refuses NoDerivatives, rights-reserved and unknown terms', () => {
  assert.equal(normalizeLicense('https://creativecommons.org/licenses/by-nd/4.0/'), null);
  assert.equal(normalizeLicense('https://creativecommons.org/licenses/by-nc-nd/2.0/'), null);
  assert.equal(normalizeLicense(undefined, 'Attribution-NonCommercial-NoDerivs License'), null);
  assert.equal(normalizeLicense('http://rightsstatements.org/vocab/InC/1.0/'), null);
  assert.equal(normalizeLicense(undefined, 'All Rights Reserved'), null);
  assert.equal(normalizeLicense(undefined, ''), null);
});

test('recognizes public domain and CC0 in their various spellings', () => {
  assert.equal(normalizeLicense('https://creativecommons.org/publicdomain/zero/1.0/')?.label, 'CC0');
  assert.equal(normalizeLicense('https://creativecommons.org/publicdomain/mark/1.0/')?.label, 'Public domain');
  assert.equal(normalizeLicense(undefined, 'Public domain')?.label, 'Public domain');
  assert.equal(normalizeLicense(undefined, 'No known copyright restrictions')?.label, 'Public domain');
  assert.equal(normalizeLicense(undefined, 'CC0')?.label, 'CC0');
  assert.equal(normalizeLicense(undefined, 'CC BY-SA 4.0')?.label, 'CC BY-SA 4.0');
  assert.equal(normalizeLicense(undefined, 'CC BY 2.0')?.url, 'https://creativecommons.org/licenses/by/2.0/');
});
