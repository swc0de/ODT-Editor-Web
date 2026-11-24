/**
 * lossesFor(state, formatId): what saving the document in a format can't
 * keep, with counts. Used by the lossy-format prompt and File ▸ Info ▸ Check
 * for Issues ▸ Check Compatibility.
 *
 *   docx / xml (Word XML)  content that exists only in ODF: opaque ODF nodes
 *                          and objects the DOCX writer has no equivalent for
 *   odt / xml (flat ODT)   content that exists only in Word: opaque OOXML
 *                          nodes and Word-only package parts
 *   html                   what other web software can't show (this app
 *                          reopens its own web pages losslessly)
 *   txt                    everything but the text
 *
 * @returns {Array<{ id: string, labelKey: string, count: number }>}
 */

/** Frame kinds the DOCX writer writes as real DOCX objects (see docx-writer.js). */
export const DOCX_FRAME_KINDS = new Set(['image', 'textbox', 'equation']); // equations: OMML

/** Word package parts the ODT side can't hold (path pattern → label key). */
const WORD_ONLY_PARTS = [
  [/^customXml\//, 'loss.customXml'],
  [/^word\/glossary\//, 'loss.glossary'],
  [/^word\/embeddings\//, 'loss.embeddings'],
  [/^word\/vbaProject\.bin$/i, 'loss.macros'],
  [/^word\/charts\//, 'loss.wordCharts'],
  [/^word\/diagrams\//, 'loss.diagrams'],
  [/^word\/ink\//, 'loss.ink'],
  [/^docProps\/custom\.xml$/, 'loss.customProps'],
];

function scan(state) {
  const c = {
    textFormat: 0, paraStyles: 0, frames: 0, tables: 0, notes: 0, comments: 0, changes: 0, fields: 0, bookmarks: 0, links: 0,
    sections: 0, indexes: 0, lists: 0, opaqueOdf: 0, opaqueOoxml: 0, controls: 0, framesByKind: {},
  };
  const changeIds = new Set();
  const visitJson = (blocks) => { for (const b of blocks || []) { try { visitNode(b, true); } catch { /* ignore */ } } };
  function visitNode(n, isJson) {
    const type = isJson ? n.type : n.type.name;
    const attrs = n.attrs || {};
    const marks = isJson ? (n.marks || []).map((m) => m.type) : n.marks.map((m) => m.type.name);
    if (type === 'text') {
      if (marks.includes('textProps') || marks.includes('charStyle')) c.textFormat++;
      if (marks.includes('link')) c.links++;
      if (marks.includes('contentControl')) c.controls++;
      for (const m of isJson ? n.marks || [] : n.marks) {
        const name = isJson ? m.type : m.type.name;
        if (['insertion', 'deletion', 'formatChange'].includes(name)) changeIds.add((isJson ? m.attrs : m.attrs)?.cid || name);
      }
    }
    if ((type === 'paragraph' || type === 'heading') && ((attrs.styleName && attrs.styleName !== 'Standard') || attrs.auto)) c.paraStyles++;
    if (type === 'frame') { c.frames++; c.framesByKind[attrs.kind] = (c.framesByKind[attrs.kind] || 0) + 1; visitJson(attrs.body); }
    if (type === 'table') c.tables++;
    if (type === 'note') { c.notes++; visitJson(attrs.body); }
    if (type === 'annotation') { c.comments++; visitJson(attrs.body); }
    if (type === 'field') c.fields++;
    if (type === 'bookmark' && attrs.element !== 'text:bookmark-end') c.bookmarks++;
    if (type === 'section') c.sections++;
    if (type === 'index') c.indexes++;
    if (type === 'list') c.lists++;
    if (type === 'change_marker') changeIds.add(attrs.changeId);
    if (type === 'opaque_block' || type === 'opaque_inline') { if (attrs.dialect === 'ooxml') c.opaqueOoxml++; else c.opaqueOdf++; }
    const kids = isJson ? n.content || [] : [];
    if (isJson) kids.forEach((k) => visitNode(k, true));
  }
  state.doc.descendants((n) => { visitNode(n, false); });
  c.changes = changeIds.size;
  const masters = (state.masterStyles?.c || []).filter((m) => typeof m !== 'string' && m.n === 'style:master-page');
  c.headersFooters = masters.reduce((a, m) => a + (m.c || []).filter((x) => typeof x !== 'string' && /^style:(header|footer)/.test(x.n) && (x.c || []).some((y) => typeof y !== 'string' && (y.c || []).length)).length, 0);
  c.pageStyles = masters.length;
  return c;
}

export function lossesFor(state, formatId, { flavour } = {}) {
  if (!state?.doc) return [];
  const c = scan(state);
  const out = [];
  const add = (id, count, labelKey = `loss.${id}`) => { if (count > 0) out.push({ id, labelKey, count }); };
  const target = formatId === 'xml' ? (flavour === 'flat-odt' ? 'odt' : 'docx') : formatId === 'dotx' ? 'docx' : formatId === 'ott' ? 'odt' : formatId;
  switch (target) {
    case 'docx': {
      add('opaqueOdf', c.opaqueOdf);
      for (const [kind, n] of Object.entries(c.framesByKind)) if (!DOCX_FRAME_KINDS.has(kind)) add(`frame-${kind}`, n, kind === 'object' ? 'loss.oleObject' : 'loss.odfObject');
      break;
    }
    case 'odt': {
      add('opaqueOoxml', c.opaqueOoxml);
      const files = state.docxSource?.files ? Object.keys(state.docxSource.files) : [];
      for (const [re, key] of WORD_ONLY_PARTS) add(key.slice(5), files.filter((p) => re.test(p) && !p.includes('/_rels/')).length, key);
      break;
    }
    case 'html':
      add('headersFooters', c.headersFooters);
      add('comments', c.comments);
      add('changes', c.changes);
      add('pageLayout', c.sections + (c.pageStyles > 1 ? c.pageStyles : 0));
      add('fields', c.fields);
      add('shapes', Object.entries(c.framesByKind).filter(([k]) => k !== 'image').reduce((a, [, n]) => a + n, 0));
      add('controls', c.controls);
      add('opaque', c.opaqueOdf + c.opaqueOoxml);
      break;
    case 'txt':
      add('textFormat', c.textFormat);
      add('paraFormat', c.paraStyles);
      add('pictures', c.frames);
      add('tables', c.tables);
      add('headersFooters', c.headersFooters);
      add('notes', c.notes);
      add('comments', c.comments);
      add('changes', c.changes);
      add('fields', c.fields);
      add('links', c.links);
      add('bookmarks', c.bookmarks);
      add('indexes', c.indexes);
      add('pageLayout', c.sections + (c.pageStyles > 1 ? c.pageStyles : 0));
      add('opaque', c.opaqueOdf + c.opaqueOoxml);
      break;
    default: break;
  }
  return out;
}
