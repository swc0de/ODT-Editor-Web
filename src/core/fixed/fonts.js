/**
 * Fonts for PDF / XPS: which embeddable font draws each piece of text.
 *
 * The bundled fonts come from the page's own @font-face rules (WOFF2 data
 * URLs), read with fontkit (lazily loaded chunk). System fonts are used
 * through the Local Font Access API when the user has granted it; otherwise
 * a font that isn't available is replaced by its metric-compatible bundled
 * font (Calibri → Carlito…) or the bundled font of its kind, and the
 * replacement is reported.
 */
import { subsetTtf } from './sfnt.js';

const GENERIC = { serif: 'liberation serif', 'sans-serif': 'liberation sans', monospace: 'liberation mono', 'system-ui': 'carlito', cursive: 'liberation serif', fantasy: 'liberation sans' };

const families = (css) => (css || '').split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

function b64Bytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** @font-face rules with embedded data: family (lower case) → [{ weight, style, url }]. */
function fontFaceRules() {
  const map = new Map();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.type !== CSSRule.FONT_FACE_RULE) continue;
      const fam = r.style.getPropertyValue('font-family').replace(/["']/g, '').trim().toLowerCase();
      const src = r.style.getPropertyValue('src');
      const url = /url\(["']?(data:[^"')]+)/.exec(src)?.[1];
      if (!url) continue;
      const w = r.style.getPropertyValue('font-weight') || '400';
      const weight = w === 'bold' ? 700 : w === 'normal' ? 400 : parseInt(w, 10) || 400;
      const style = /italic|oblique/.test(r.style.getPropertyValue('font-style')) ? 'italic' : 'normal';
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam).push({ weight, style, url, family: r.style.getPropertyValue('font-family').replace(/["']/g, '').trim() });
    }
  }
  return map;
}

export class FontBook {
  /** @param {{ create: Function }} fontkit */
  constructor(fontkit) {
    this.fontkit = fontkit;
    this.rules = fontFaceRules();
    this.local = new Map(); // family (lower case) → [{ weight, style, blob }]
    this.cache = new Map(); // computed font → face
    this.faces = new Map(); // key → face
    this.substitutions = new Map(); // requested → used
  }

  /** System fonts, when the user has granted Local Font Access. */
  async useLocalFonts() {
    try {
      if (typeof window.queryLocalFonts !== 'function') return;
      const p = await navigator.permissions?.query?.({ name: 'local-fonts' });
      if (p?.state !== 'granted') return;
      for (const f of await window.queryLocalFonts()) {
        const fam = f.family.toLowerCase();
        if (!this.local.has(fam)) this.local.set(fam, []);
        this.local.get(fam).push({ weight: /bold|black|heavy/i.test(f.style) ? 700 : /semibold|demi/i.test(f.style) ? 600 : /light/i.test(f.style) ? 300 : 400, style: /italic|oblique/i.test(f.style) ? 'italic' : 'normal', data: f, family: f.family });
      }
    } catch { /* not available */ }
  }

  /** Loads the system fonts that `resolve` may need (their bytes are read asynchronously). */
  async preloadLocal(cssFamilies) {
    for (const fam of cssFamilies) {
      const list = this.local.get(fam.toLowerCase());
      if (!list) continue;
      for (const f of list) if (!f.bytes) { try { f.bytes = new Uint8Array(await (await f.data.blob()).arrayBuffer()); } catch { f.bytes = null; } }
    }
  }

  /**
   * A face that has a glyph for `ch` when the style's own font hasn't (as the
   * browser falls back): the other embeddable fonts, nearest weight and style. Null if none.
   */
  fallback(s, ch) {
    const weight = s.fontWeight === 'bold' ? 700 : parseInt(s.fontWeight, 10) || 400;
    const italic = /italic|oblique/.test(s.fontStyle);
    const ck = `${ch.codePointAt(0)}|${weight}|${italic}`;
    this.fallbacks ??= new Map();
    if (this.fallbacks.has(ck)) return this.fallbacks.get(ck);
    let hit = null;
    const fams = [...new Set([...[...this.local.entries()].filter(([, l]) => l.some((x) => x.bytes)).map(([, l]) => l[0].family), ...[...this.rules.values()].map((l) => l[0].family)])];
    for (const fam of fams) {
      const face = this.resolve({ fontFamily: `"${fam}"`, fontWeight: String(weight), fontStyle: italic ? 'italic' : 'normal' });
      if (face?.has(ch)) { hit = face; break; }
    }
    this.fallbacks.set(ck, hit);
    return hit;
  }

  /** The face that draws text with this computed style (CSSStyleDeclaration), or null. */
  resolve(s) {
    const weight = s.fontWeight === 'bold' ? 700 : parseInt(s.fontWeight, 10) || 400;
    const italic = /italic|oblique/.test(s.fontStyle);
    const ck = `${s.fontFamily}|${weight}|${italic}`;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const list = families(s.fontFamily);
    const requested = list.find((f) => !/^ODT /.test(f) && !GENERIC[f.toLowerCase()]) || list[0] || 'sans-serif';
    let found = null;
    for (const f of list) {
      const fam = f.toLowerCase();
      const loc = this.local.get(fam)?.filter((x) => x.bytes);
      if (loc?.length) { found = { candidates: loc, family: f }; break; }
      if (this.rules.has(fam)) { found = { candidates: this.rules.get(fam), family: f }; break; }
      if (GENERIC[fam] && this.rules.has(GENERIC[fam])) { found = { candidates: this.rules.get(GENERIC[fam]), family: this.rules.get(GENERIC[fam])[0].family }; break; }
    }
    if (!found) {
      const fb = this.rules.get('carlito') || [...this.rules.values()][0];
      if (!fb) { this.cache.set(ck, null); return null; }
      found = { candidates: fb, family: fb[0].family };
    }
    // The nearest weight, then the style.
    const pick = [...found.candidates].sort((a, b) => (Math.abs(a.weight - weight) - Math.abs(b.weight - weight)) || ((a.style === 'italic') === italic ? -1 : 1) - ((b.style === 'italic') === italic ? -1 : 1))[0];
    const usedFamily = pick.family || found.family;
    if (requested.toLowerCase() !== usedFamily.toLowerCase() && !GENERIC[requested.toLowerCase()]) this.substitutions.set(requested, usedFamily);
    const synthBold = weight >= 600 && pick.weight < 600;
    const synthItalic = italic && pick.style !== 'italic';
    const key = `${usedFamily}|${pick.weight}|${pick.style}|${synthBold ? 'B' : ''}${synthItalic ? 'I' : ''}`;
    let face = this.faces.get(key);
    if (!face) {
      const bytes = pick.bytes || b64Bytes(pick.url.slice(pick.url.indexOf(',') + 1));
      face = makeFace(this.fontkit.create(bytes), key, usedFamily, { synthBold, synthItalic, bold: pick.weight >= 600, italic: pick.style === 'italic' });
      this.faces.set(key, face);
    }
    this.cache.set(ck, face);
    return face;
  }
}

function makeFace(font, key, family, flags) {
  const os2 = font['OS/2'] || {};
  const typo = os2.fsSelection?.useTypoMetrics;
  const upm = font.unitsPerEm;
  // The browser places the baseline by the hhea metrics (the OS/2 typographic ones with USE_TYPO_METRICS).
  const ascent = typo ? os2.typoAscender : font.hhea?.ascent ?? font.ascent;
  const descent = typo ? os2.typoDescender : font.hhea?.descent ?? font.descent;
  const cmap = new Map();
  const widths = new Map();
  const face = {
    key, family, font, ...flags,
    metrics: { upm, ascent, descent, underlinePosition: -(font.underlinePosition ?? -upm * 0.1), underlineThickness: font.underlineThickness || upm * 0.05, strikePosition: os2.yStrikeoutPosition || upm * 0.25, capHeight: os2.capHeight || ascent * 0.7, italicAngle: font.italicAngle || 0, bbox: font.bbox },
    postscriptName: (font.postscriptName || family).replace(/[^A-Za-z0-9-]/g, ''),
    cmap, widths,
    /** Records a character as used and returns its glyph id. */
    use(ch) {
      const cp = ch.codePointAt(0);
      if (cmap.has(cp)) return cmap.get(cp);
      const g = font.glyphForCodePoint(cp);
      cmap.set(cp, g.id);
      widths.set(g.id, g.advanceWidth);
      return g.id;
    },
    /** Whether the font draws this character. */
    has(ch) { const cp = ch.codePointAt(0); return cmap.has(cp) ? cmap.get(cp) !== 0 : font.hasGlyphForCodePoint(cp); },
    /** Advance of a character, in ems. */
    advance(ch) { const g = font.glyphForCodePoint(ch.codePointAt(0)); return (g.advanceWidth || 0) / upm; },
    _subset: null,
    /** { bytes (TrueType), newGid, widths: Map(new gid → advance in font units) } */
    subset() {
      if (this._subset) return this._subset;
      const { bytes, newGid } = subsetTtf(font, [...widths.keys()], cmap);
      const w = new Map();
      for (const [g, adv] of widths) w.set(newGid.get(g), adv);
      this._subset = { bytes, newGid, widths: w };
      return this._subset;
    },
  };
  return face;
}
