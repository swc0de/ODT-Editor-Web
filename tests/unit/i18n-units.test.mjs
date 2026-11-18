import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, hasKey, registerLocale, setLocale } from '../../src/i18n/index.js';
import { APP_NAME } from '../../src/config.js';
import { convert, parseLength, toPx, pxToLength, PX_PER_CM } from '../../src/layout/units.js';

test('t() interpolates, pluralises and falls back', () => {
  assert.equal(t('status.pageOf', { page: 2, pages: 10 }), 'Page 2 of 10');
  assert.equal(t('status.words', { count: 1 }), '1 word');
  assert.equal(t('status.words', { count: 1234 }), '1,234 words');
  assert.equal(t('app.loading'), `Loading ${APP_NAME}…`);
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.ok(hasKey('lang.en-GB'));
  registerLocale('xx', { 'common.ok': 'Okey' });
  setLocale('xx');
  assert.equal(t('common.ok'), 'Okey');
  assert.equal(t('common.cancel'), 'Cancel'); // falls back to en-GB
  setLocale('en-GB');
});

test('unit conversions', () => {
  assert.equal(convert(1, 'in', 'cm'), 2.54);
  assert.equal(convert(72, 'pt', 'in'), 1);
  assert.ok(Math.abs(toPx('2.54cm') - 96) < 1e-9);
  assert.deepEqual(parseLength('-0.5in'), { value: -0.5, unit: 'in' });
  assert.equal(parseLength('abc'), null);
  assert.equal(pxToLength(PX_PER_CM * 2.54, 'cm'), '2.54cm');
  assert.equal(pxToLength(96, 'pt'), '72pt');
});
