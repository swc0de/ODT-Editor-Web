/**
 * XML utilities. Documents are parsed with the browser's DOMParser; parts the
 * editor keeps verbatim are converted to a small JSON tree
 *   { n: 'prefix:local', a: { 'prefix:attr': 'value' }, c: [tree | 'text'] }
 * which serialises back losslessly (with canonical prefixes) and can be
 * stored in IndexedDB or compared in tests.
 */
import { NS, PREFIX_BY_URI } from './namespaces.js';

export class XmlError extends Error {}

/** Parses an XML string; throws XmlError on malformed input. */
export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new XmlError(err.textContent.trim().split('\n')[0]);
  return doc;
}

/**
 * Context collecting namespace prefixes for URIs we don't know, so they can
 * be re-declared on export: { uri → prefix }.
 */
export function createNsContext() { return { extra: {} }; }

/** Canonical qualified name of an element or attribute. */
export function qname(node, ctx) {
  const uri = node.namespaceURI;
  if (!uri) return node.localName;
  let prefix = PREFIX_BY_URI[uri];
  if (!prefix) {
    prefix = node.prefix || 'ns';
    if (ctx) {
      // Avoid clashes with canonical prefixes or other unknown URIs.
      let p = prefix;
      let i = 1;
      while ((NS[p] && NS[p] !== uri) || (Object.values(ctx.extra).includes(p) && ctx.extra[uri] !== p)) p = `${prefix}${i++}`;
      if (!ctx.extra[uri]) ctx.extra[uri] = p;
      prefix = ctx.extra[uri];
    }
  }
  return `${prefix}:${node.localName}`;
}

/** Attributes of an element as { qname: value }, without xmlns declarations. */
export function attrsOf(el, ctx) {
  const out = {};
  for (const a of el.attributes) {
    if (a.name === 'xmlns' || a.prefix === 'xmlns' || a.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
    out[qname(a, ctx)] = a.value;
  }
  return out;
}

/** Element children only. */
export const childElements = (el) => [...el.children];

/** DOM element → JSON tree (keeps text, drops comments/PIs). */
export function toTree(el, ctx) {
  const c = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 1) c.push(toTree(node, ctx));
    else if (node.nodeType === 3 || node.nodeType === 4) {
      if (node.data) c.push(node.data);
    }
  }
  const tree = { n: qname(el, ctx), a: attrsOf(el, ctx) };
  if (c.length) tree.c = c;
  return tree;
}

export const escText = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
export const escAttr = (s) => String(s).replace(/[&<>"\t\n\r]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\t': '&#9;', '\n': '&#10;', '\r': '&#13;' })[ch]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

export function attrsToXml(a) {
  let s = '';
  for (const k in a) if (a[k] != null) s += ` ${k}="${escAttr(a[k])}"`;
  return s;
}

/** JSON tree → XML string. */
export function treeToXml(t) {
  if (typeof t === 'string') return escText(t);
  const open = `<${t.n}${attrsToXml(t.a)}`;
  if (!t.c || !t.c.length) return `${open}/>`;
  let inner = '';
  for (const c of t.c) inner += treeToXml(c);
  return `${open}>${inner}</${t.n}>`;
}

/** DOM element → XML string with canonical prefixes (for opaque content). */
export const elementToXml = (el, ctx) => treeToXml(toTree(el, ctx));

/** Text content of a JSON tree. */
export function treeText(t) {
  if (typeof t === 'string') return t;
  return (t.c || []).map(treeText).join('');
}

/** First child tree with the given name. */
export const findChild = (t, name) => (t.c || []).find((c) => typeof c !== 'string' && c.n === name) || null;
export const findChildren = (t, name) => (t.c || []).filter((c) => typeof c !== 'string' && c.n === name);

/** xmlns declarations for the root element: canonical + extra. */
export function nsDeclarations(prefixes, extra = {}) {
  let s = '';
  for (const p of prefixes) s += ` xmlns:${p}="${NS[p]}"`;
  for (const [uri, p] of Object.entries(extra)) s += ` xmlns:${p}="${escAttr(uri)}"`;
  return s;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
