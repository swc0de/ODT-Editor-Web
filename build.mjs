#!/usr/bin/env node
/**
 * Build: bundles src/ with esbuild and inlines EVERYTHING (JS, CSS, fonts as
 * base64 WOFF2, icons) into ONE offline file: dist/odt-editor.html.
 *
 *   node build.mjs           production build (minified)
 *   node build.mjs --dev     unminified, with inline source maps
 *   node build.mjs --watch   rebuild on change (dev mode)
 */
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LOGO_SVG } from './src/ui/logo.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const dev = watch || args.has('--dev');

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const OUT_FILE = path.join(root, 'dist', 'odt-editor.html');

/** Read APP_NAME from src/config.js so the name lives in exactly one place. */
async function readAppName() {
  const src = await readFile(path.join(root, 'src', 'config.js'), 'utf8');
  const m = src.match(/export const APP_NAME\s*=\s*(['"])(.*?)\1/);
  if (!m) throw new Error('APP_NAME not found in src/config.js');
  return m[2];
}

const FONT_FAMILY_BY_PREFIX = {
  Carlito: 'Carlito',
  Caladea: 'Caladea',
  LiberationSans: 'Liberation Sans',
  LiberationSerif: 'Liberation Serif',
  LiberationMono: 'Liberation Mono',
  Selawik: 'Selawik',
};
/**
 * Selawik is the UI font's metric-compatible stand-in for Segoe UI: its
 * vertical metrics are set to Segoe UI's (ascent 2210, descent 514, no line
 * gap, of 2048) so lines and controls are as tall as on Windows.
 */
const FONT_OVERRIDES = { Selawik: 'ascent-override:107.91%;descent-override:25.1%;line-gap-override:0%;' };

/** Generates @font-face rules with base64 WOFF2 data URIs from assets/fonts. */
async function buildFontsCss() {
  const dir = path.join(root, 'assets', 'fonts');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.woff2')).sort();
  const rules = [];
  for (const file of files) {
    const [prefix, variant] = path.basename(file, '.woff2').split('-');
    const family = FONT_FAMILY_BY_PREFIX[prefix];
    if (!family) continue;
    const weight = /Bold/.test(variant) ? 700 : 400;
    const style = /Italic/.test(variant) ? 'italic' : 'normal';
    const b64 = (await readFile(path.join(dir, file))).toString('base64');
    rules.push(
      `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:block;${FONT_OVERRIDES[prefix] || ''}` +
        `src:url(data:font/woff2;base64,${b64}) format("woff2")}`,
    );
  }
  return rules.join('\n');
}


/** Fails the build if the output references any remote resource. */
function assertOffline(html) {
  const offenders = [];
  const patterns = [
    /<(?:script|img|iframe|audio|video|source|embed)\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//gi,
    /<link\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\//gi,
    /url\(\s*["']?(?:https?:)?\/\//gi,
    /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//gi,
  ];
  for (const re of patterns) for (const m of html.matchAll(re)) offenders.push(m[0].slice(0, 120));
  if (offenders.length) throw new Error('Build output references remote resources:\n  ' + offenders.join('\n  '));
}

/** Safe template substitution (no `$` replacement-pattern surprises). */
function fill(template, values) {
  return template.replace(/%%([A-Z_]+)%%/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown template key ${key}`);
    return values[key];
  });
}

/** MathLive's @font-face rules with the WOFF2 files inlined. */
async function mathLiveFontsCss() {
  const dir = path.join(root, 'node_modules', 'mathlive');
  const css = await readFile(path.join(dir, 'mathlive-fonts.css'), 'utf8');
  const files = new Map();
  for (const m of css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)) files.set(m[1], (await readFile(path.join(dir, m[1]))).toString('base64'));
  return css.replace(/url\((fonts\/[^)]+\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${files.get(f)})`).replace(/font-display:"swap"/g, 'font-display:swap');
}

/** The equation editor chunk (MathLive), base64-encoded so it can sit inertly in the page. */
async function buildMathLive() {
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'vendor', 'mathlive-entry.js')],
    bundle: true, format: 'esm', platform: 'browser', target: ['chrome110', 'firefox115', 'safari16'],
    minify: true, legalComments: 'none', write: false, logLevel: 'warning',
    define: { __MATHLIVE_FONTS_CSS__: JSON.stringify(await mathLiveFontsCss()) },
    plugins: [{
      // MathLive guesses its own URL from a stack trace when it loads, to find
      // its fonts and sounds; from a blob: URL that fails noisily. Its assets
      // are inlined instead, so the guess is not needed.
      name: 'mathlive-no-url-guess',
      setup(b) {
        const file = path.join(root, 'node_modules', 'mathlive', 'mathlive.mjs');
        b.onResolve({ filter: /^mathlive$/ }, () => ({ path: file }));
        b.onLoad({ filter: /mathlive[\\/]mathlive\.mjs$/ }, async () => {
          const src = await readFile(file, 'utf8');
          const patched = src.replace('.src) || getFileUrl();', '.src) || "";');
          if (patched === src) throw new Error('mathlive: script-url patch no longer applies');
          return { contents: patched, loader: 'js' };
        });
      },
    }],
  });
  return Buffer.from(r.outputFiles[0].text, 'utf8').toString('base64');
}
let mathLiveChunk = null;

/** The citation engine chunk (citeproc-js with the CSL styles), base64-encoded like MathLive's. */
async function buildCiteproc() {
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'vendor', 'citeproc-entry.js')],
    bundle: true, format: 'esm', platform: 'browser', target: ['chrome110', 'firefox115', 'safari16'],
    minify: true, legalComments: 'none', write: false, logLevel: 'warning',
    loader: { '.csl': 'text', '.xml': 'text' },
  });
  return Buffer.from(r.outputFiles[0].text, 'utf8').toString('base64');
}
let citeprocChunk = null;

/** The spelling worker chunk (nspell with the en-GB / en-US dictionaries), an IIFE run as a Worker. */
async function buildSpell() {
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'vendor', 'spell-worker.js')],
    bundle: true, format: 'iife', platform: 'browser', target: ['chrome110', 'firefox115', 'safari16'],
    minify: true, legalComments: 'none', write: false, logLevel: 'warning',
    loader: { '.aff': 'text', '.dic': 'text' },
  });
  return Buffer.from(r.outputFiles[0].text, 'utf8').toString('base64');
}
let spellChunk = null;

/** The spreadsheet reader chunk (SheetJS), base64-encoded like the others. */
async function buildSheetJs() {
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'vendor', 'sheetjs-entry.js')],
    bundle: true, format: 'esm', platform: 'browser', target: ['chrome110', 'firefox115', 'safari16'],
    minify: true, legalComments: 'none', write: false, logLevel: 'warning',
    alias: { xlsx: path.join(root, 'node_modules', 'xlsx', 'xlsx.mjs') },
  });
  return Buffer.from(r.outputFiles[0].text, 'utf8').toString('base64');
}
let sheetChunk = null;

/** mammoth (BSD-2-Clause) and marked (MIT): the fallback DOCX reader and Markdown import, loaded on first use. */
async function buildConvert() {
  const r = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'vendor', 'convert-entry.js')],
    bundle: true, format: 'esm', platform: 'browser', target: ['chrome110', 'firefox115', 'safari16'],
    minify: true, legalComments: 'none', write: false, logLevel: 'error',
    define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
    external: ['buffer'],
  });
  return Buffer.from(r.outputFiles[0].text, 'utf8').toString('base64');
}
let convertChunk = null;

async function writeHtml(jsText, cssText) {
  const appName = await readAppName();
  const template = await readFile(path.join(root, 'src', 'index.html'), 'utf8');
  const fontsCss = await buildFontsCss();
  const escName = appName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const html = fill(template, {
    APP_NAME: escName,
    APP_VERSION: pkg.version,
    FAVICON: 'data:image/svg+xml,' + encodeURIComponent(LOGO_SVG),
    FONTS_CSS: fontsCss,
    APP_CSS: cssText.replace(/<\/style/gi, '<\\/style'),
    MATHLIVE: mathLiveChunk ??= await buildMathLive(),
    CITEPROC: citeprocChunk ??= await buildCiteproc(),
    SPELL: spellChunk ??= await buildSpell(),
    SHEETJS: sheetChunk ??= await buildSheetJs(),
    CONVERT: convertChunk ??= await buildConvert(),
    // A literal "</script" inside the bundle would end the inline script early.
    APP_JS: jsText.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'),
  });
  assertOffline(html);
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, html);
  return html.length;
}

const define = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
};

const jsOptions = {
  entryPoints: [path.join(root, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'firefox115', 'safari16'],
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  write: false,
  define,
  loader: { '.svg': 'text' },
  logLevel: 'warning',
};

const cssOptions = {
  entryPoints: [path.join(root, 'src', 'styles', 'main.css')],
  bundle: true,
  minify: !dev,
  write: false,
  outfile: 'out.css',
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
  logLevel: 'warning',
};

async function buildOnce() {
  const t0 = performance.now();
  const [js, css] = await Promise.all([esbuild.build(jsOptions), esbuild.build(cssOptions)]);
  const size = await writeHtml(js.outputFiles[0].text, css.outputFiles[0].text);
  const ms = Math.round(performance.now() - t0);
  console.log(`built ${path.relative(root, OUT_FILE)}  ${(size / 1024).toFixed(0)} KiB  in ${ms} ms${dev ? ' (dev)' : ''}`);
}

if (watch) {
  const { watch: fsWatch } = await import('node:fs');
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((e) => console.error(e.message)), 80);
  };
  await buildOnce().catch((e) => console.error(e.message));
  fsWatch(path.join(root, 'src'), { recursive: true }, rebuild);
  fsWatch(path.join(root, 'assets'), { recursive: true }, rebuild);
  console.log('watching src/ and assets/ …');
} else {
  try {
    await buildOnce();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
