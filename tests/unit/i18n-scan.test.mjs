/**
 * i18n audit: user-facing text in the UI code goes through t(). Flags string
 * literals used as element text, labels, titles, tooltips or placeholders, and
 * toasts that contain words (symbols, units and file names are allowed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['src/ui', 'src/features', 'src/layout', 'src/main.js'];
const files = [];
const walk = (p) => { if (statSync(p).isDirectory()) readdirSync(p).forEach((f) => walk(path.join(p, f))); else if (p.endsWith('.js')) files.push(p); };
ROOTS.forEach(walk);

// A literal that reads as words (two letters in a row, starting with a letter).
const WORDY = /^[A-Za-z][a-z]+(?:[ ,'’.!?-][A-Za-z]*)*[.!?…]?$/;
const ALLOWED = new Set(['px', 'pt', 'cm', 'mm', 'in', 'none', 'auto', 'true', 'false', 'button', 'menu', 'dialog', 'img', 'svg', 'div', 'span']);
const PATTERNS = [
  /'aria-label':\s*'([^']+)'/g,
  /\bplaceholder:\s*'([^']+)'/g,
  /'data-tip':\s*'([^']+)'/g,
  /\btitle:\s*'([^']+)'/g,
  /\btoast\(\s*'([^']+)'/g,
  // h('tag', {...}, 'Text') and h('tag', null, 'Text')
  /\bh\('[a-z0-9]+',\s*(?:\{[^{}]*\}|null)\s*,\s*'([^']+)'\s*\)/g,
];

test('no hard-coded user-facing strings in the UI', () => {
  const found = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const s = m[1];
        if (ALLOWED.has(s) || !WORDY.test(s) || s.length < 3) continue;
        found.push(`${f}: ${s}`);
      }
    }
  }
  assert.deepEqual(found, []);
});
