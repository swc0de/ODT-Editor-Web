/** Every catalogue key is defined once: a key in two en-GB files would silently replace the other's text. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

test('en-GB catalogue files do not redefine each other’s keys', () => {
  const dir = path.resolve('src/i18n/en-GB');
  const seen = new Map();
  const dups = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    for (const m of readFileSync(path.join(dir, f), 'utf8').matchAll(/(?:^|[,{]\s*)'([A-Za-z0-9_.]+)':\s/gm)) {
      if (seen.has(m[1]) && seen.get(m[1]) !== f) dups.push(`${m[1]} (${seen.get(m[1])}, ${f})`);
      seen.set(m[1], f);
    }
  }
  assert.deepEqual(dups, []);
});
