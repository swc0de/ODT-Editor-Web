/**
 * Plain-text, Markdown and RTF export of a document state.
 */
import { runFormat, paraFormat, framePicture, dataUri, bytesToBase64 } from './format.js';

/**
 * Visits the body in reading order. Callbacks:
 *   block(node, { list: [{ ordered, n }...] }), table(node), other(node)
 */
function walk(fragment, cb, list = []) {
  fragment.forEach((node) => {
    const name = node.type.name;
    if (name === 'list') {
      let n = 0;
      node.forEach((item) => {
        n++;
        let first = true;
        item.forEach((child) => {
          if (child.type.name === 'list') walk(child.type.schema.nodes.doc.create(null, child), cb, [...list, { ordered: node.attrs.ordered, n, cont: true }]);
          else if (child.isTextblock) { cb.block(child, { list: [...list, { ordered: node.attrs.ordered, n, cont: !first }] }); first = false; } else walk(child.type.schema.nodes.doc.create(null, child), cb, list);
        });
      });
    } else if (name === 'table') cb.table(node, list);
    else if (node.isTextblock) cb.block(node, { list });
    else if (name === 'section' || name === 'index') walk(node.content, cb, list);
    else cb.other?.(node, list);
  });
}

/** Inline content as plain text (notes and comments left out). */
function inlineText(node) {
  let s = '';
  node.forEach((ch) => {
    if (ch.isText) { if (!ch.marks.some((m) => m.type.name === 'deletion')) s += ch.text; } else if (ch.type.name === 'hard_break') s += '\n';
    else if (ch.type.name === 'tab') s += '\t';
    else if (ch.type.name === 'field') s += ch.attrs.text || ch.textContent || '';
  });
  return s;
}

// ------------------------------------------------------------ text

export function toText(state) {
  const out = [];
  walk(state.doc.content, {
    block: (n, { list }) => {
      const depth = list.length;
      const item = list[depth - 1];
      const bullet = item && !item.cont ? (item.ordered ? `${item.n}. ` : '• ') : (item ? '   ' : '');
      out.push(`${'   '.repeat(Math.max(0, depth - 1))}${bullet}${inlineText(n)}`);
    },
    table: (t) => {
      t.forEach((row) => { const cells = []; row.forEach((c) => cells.push(c.textContent.replace(/\s+/g, ' ').trim())); out.push(cells.join('\t')); });
      out.push('');
    },
  });
  return `${out.join('\n')}\n`;
}

// ------------------------------------------------------------ markdown

const mdEscape = (s) => s.replace(/([\\`*_[\]<>|])/g, '\\$1');

function mdInline(node, state, index) {
  let s = '';
  let open = { b: false, i: false, st: false, code: false };
  const parts = [];
  node.forEach((ch) => {
    if (ch.isText) {
      if (ch.marks.some((m) => m.type.name === 'deletion')) return;
      const f = runFormat(ch, node, index);
      const font = String(f.font || '').toLowerCase();
      const code = /mono|courier|consolas/.test(font);
      let t = code ? ch.text.replace(/`/g, '\u02CB') : mdEscape(ch.text);
      if (f.link) t = `[${t}](${f.link.replace(/\)/g, '%29')})`;
      parts.push({ t, b: f.bold && !node.attrs.level, i: f.italic, st: f.strike, code });
    } else if (ch.type.name === 'hard_break') parts.push({ t: '  \n', raw: true });
    else if (ch.type.name === 'tab') parts.push({ t: '\t', raw: true });
    else if (ch.type.name === 'frame') {
      const pic = framePicture(ch, state);
      if (pic) parts.push({ t: `![${mdEscape(pic.alt || 'Picture')}](${dataUri(pic)})`, raw: true });
    } else if (ch.type.name === 'field') parts.push({ t: mdEscape(ch.attrs.text || ch.textContent || ''), raw: true });
  });
  // Emphasis markers wrap runs, with whitespace kept outside them.
  const wrap = (p) => {
    if (p.raw) return p.t;
    let t = p.t;
    const lead = t.match(/^\s*/)[0];
    const trail = t.match(/\s*$/)[0];
    let core = t.slice(lead.length, t.length - trail.length);
    if (!core) return t;
    if (p.code) core = `\`${core}\``;
    if (p.st) core = `~~${core}~~`;
    if (p.i) core = `*${core}*`;
    if (p.b) core = `**${core}**`;
    return lead + core + trail;
  };
  for (const p of parts) s += wrap(p);
  void open;
  return s;
}

export function toMarkdown(state, index) {
  const out = [];
  let prevList = false;
  walk(state.doc.content, {
    block: (n, { list }) => {
      const f = paraFormat(n, index);
      const text = mdInline(n, state, index);
      if (list.length) {
        const item = list[list.length - 1];
        const pad = '   '.repeat(list.length - 1);
        out.push(item.cont ? `${pad}   ${text}` : `${pad}${item.ordered ? `${item.n}.` : '-'} ${text}`);
        prevList = true;
        return;
      }
      if (prevList) { out.push(''); prevList = false; }
      if (f.pageBreak && out.length) out.push('---', '');
      if (f.level) out.push(`${'#'.repeat(Math.min(6, f.level))} ${text.trim()}`);
      else if (f.title) out.push(`# ${text.trim()}`);
      else if (n.attrs.styleName === 'Quote' || n.attrs.styleName === 'Quotations') out.push(`> ${text}`);
      else out.push(text.replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3'));
      out.push('');
    },
    table: (t) => {
      if (prevList) { out.push(''); prevList = false; }
      const rows = [];
      t.forEach((row) => { const cells = []; row.forEach((c) => { const parts = []; c.forEach((b) => { if (b.isTextblock) parts.push(mdInline(b, state, index)); }); cells.push(parts.join('<br>').replace(/\n/g, ' ')); }); rows.push(cells); });
      const w = Math.max(...rows.map((r) => r.length));
      rows.forEach((r, i) => {
        while (r.length < w) r.push('');
        out.push(`| ${r.join(' | ')} |`);
        if (i === 0) out.push(`|${' --- |'.repeat(w)}`);
      });
      out.push('');
    },
  });
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ------------------------------------------------------------ RTF

const twips = (ptv) => Math.round((ptv || 0) * 20);

function rtfText(s) {
  let o = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') o += `\\${ch}`;
    else if (ch === '\n') o += '\\line ';
    else if (ch === '\t') o += '\\tab ';
    else if (c < 128) o += ch;
    else if (c < 0x10000) o += `\\u${c > 32767 ? c - 65536 : c}?`;
    else {
      // Outside the BMP: a surrogate pair.
      const hi = Math.floor((c - 0x10000) / 0x400) + 0xd800;
      const lo = ((c - 0x10000) % 0x400) + 0xdc00;
      o += `\\u${hi - 65536}?\\u${lo - 65536}?`;
    }
  }
  return o;
}

export function toRtf(state, index) {
  const fonts = ['Carlito'];
  const colours = [null];
  const fontId = (f) => { const name = f || 'Carlito'; let i = fonts.indexOf(name); if (i < 0) { fonts.push(name); i = fonts.length - 1; } return i; };
  const colourId = (c) => { if (!c) return 0; let i = colours.indexOf(c); if (i < 0) { colours.push(c); i = colours.length - 1; } return i; };
  const body = [];

  const runs = (n) => {
    let s = '';
    n.forEach((ch) => {
      if (ch.isText) {
        if (ch.marks.some((m) => m.type.name === 'deletion')) return;
        const f = runFormat(ch, n, index);
        let fmt = `\\f${fontId(f.font)}\\fs${Math.round((f.sizePt || 12) * 2)}`;
        if (f.bold) fmt += '\\b';
        if (f.italic) fmt += '\\i';
        if (f.underline) fmt += '\\ul';
        if (f.strike) fmt += '\\strike';
        if (f.sub) fmt += '\\sub';
        if (f.sup) fmt += '\\super';
        if (f.colour) fmt += `\\cf${colourId(f.colour)}`;
        if (f.highlight) fmt += `\\highlight${colourId(f.highlight)}`;
        const text = `{${fmt} ${rtfText(ch.text)}}`;
        s += f.link ? `{\\field{\\*\\fldinst{HYPERLINK "${f.link.replace(/["\\{}]/g, '')}"}}{\\fldrslt${text}}}` : text;
      } else if (ch.type.name === 'hard_break') s += '\\line ';
      else if (ch.type.name === 'tab') s += '\\tab ';
      else if (ch.type.name === 'field') s += rtfText(ch.attrs.text || ch.textContent || '');
      else if (ch.type.name === 'frame') {
        const pic = framePicture(ch, state);
        const kind = /png/.test(pic?.mediaType) ? 'pngblip' : /jpe?g/.test(pic?.mediaType) ? 'jpegblip' : null;
        if (pic && kind) {
          let hex = '';
          for (const b of pic.bytes) hex += b.toString(16).padStart(2, '0');
          s += `{\\pict\\${kind}\\picwgoal${twips(pic.widthPt)}\\pichgoal${twips(pic.heightPt)} ${hex.replace(/(.{128})/g, '$1\n')}}`;
        }
      }
    });
    return s;
  };

  const para = (n, extra = '') => {
    const f = paraFormat(n, index);
    let p = `\\pard\\plain${extra}`;
    if (f.pageBreak && body.length) p = `\\page${p}`;
    p += { center: '\\qc', right: '\\qr', justify: '\\qj', left: '\\ql' }[f.align];
    if (f.indentLeftPt) p += `\\li${twips(f.indentLeftPt)}`;
    if (f.indentRightPt) p += `\\ri${twips(f.indentRightPt)}`;
    if (f.firstLinePt) p += `\\fi${twips(f.firstLinePt)}`;
    if (f.beforePt != null) p += `\\sb${twips(f.beforePt)}`;
    if (f.afterPt != null) p += `\\sa${twips(f.afterPt)}`;
    if (f.level) p += `\\outlinelevel${f.level - 1}`;
    return `${p} `;
  };

  walk(state.doc.content, {
    block: (n, { list }) => {
      if (list.length) {
        const item = list[list.length - 1];
        const indent = 360 * list.length;
        const marker = item.cont ? '' : (item.ordered ? `${item.n}.\\tab ` : '\\u8226?\\tab ');
        body.push(`${para(n, `\\li${indent}\\fi-360\\tx${indent}`)}${marker}${runs(n)}\\par`);
      } else body.push(`${para(n)}${runs(n)}\\par`);
    },
    table: (t) => {
      const cols = Math.max(...Array.from({ length: t.childCount }, (_, r) => { let c = 0; t.child(r).forEach((cell) => { c += cell.attrs.colspan || 1; }); return c; }));
      const width = 9000;
      t.forEach((row) => {
        let s = '\\trowd\\trgaph108';
        let x = 0;
        row.forEach((cell) => { x += Math.round((width / cols) * (cell.attrs.colspan || 1)); s += `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${x}`; });
        row.forEach((cell) => {
          const parts = [];
          cell.forEach((b) => { if (b.isTextblock) parts.push(`${runs(b)}`); });
          s += `\\pard\\intbl ${parts.join('\\par ')}\\cell `;
        });
        body.push(`${s}\\row`);
      });
      body.push('\\pard\\par');
    },
  });

  const rgb = (c) => { const v = c.replace('#', ''); return `\\red${parseInt(v.slice(0, 2), 16)}\\green${parseInt(v.slice(2, 4), 16)}\\blue${parseInt(v.slice(4, 6), 16)};`; };
  const fonttbl = `{\\fonttbl${fonts.map((f, i) => `{\\f${i}\\fnil ${rtfText(f)};}`).join('')}}`;
  const colortbl = `{\\colortbl;${colours.slice(1).map(rgb).join('')}}`;
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n${fonttbl}\n${colortbl}\n\\viewkind4\n${body.join('\n')}\n}`;
}

export { inlineText, bytesToBase64 };
