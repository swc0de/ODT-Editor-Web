/**
 * Flat OpenDocument Text (.fodt, or an .xml file with an office:document
 * root): the whole package in one XML file. Reading turns it into an ODT
 * package (so the normal importer reads it); writing turns an ODT package
 * into flat XML. Pictures are office:binary-data, embedded objects
 * (equations, charts) are inline documents, as LibreOffice writes them.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { base64, unbase64 } from '../convert/flat-opc.js';

const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const XLINK = 'http://www.w3.org/1999/xlink';
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const MIME_TEXT = 'application/vnd.oasis.opendocument.text';
const DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

const ser = (el) => new XMLSerializer().serializeToString(el);

/** The xmlns declarations and office:version of a root element, as attribute text. */
function rootAttrs(root, extra = '') {
  let s = '';
  for (const a of root.attributes) if (a.name.startsWith('xmlns') || a.name === 'office:version') s += ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
  return s + extra;
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/x-emf': 'emf', 'image/x-wmf': 'wmf', 'image/tiff': 'tif' };
function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'webp';
  if (b[0] === 0x01 && b[1] === 0x00 && b[2] === 0x00 && b[3] === 0x00) return 'emf';
  if (b[0] === 0xd7 && b[1] === 0xcd) return 'wmf';
  if (b[0] === 0x3c) return 'svg';
  return 'png';
}

/** Flat ODT text → ODT package bytes. */
export function flatOdtToPackage(text) {
  const doc = new DOMParser().parseFromString(typeof text === 'string' ? text : strFromU8(text), 'application/xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root.namespaceURI !== OFFICE || root.localName !== 'document') throw new Error('This is not an OpenDocument flat XML file.');
  const mime = root.getAttributeNS(OFFICE, 'mimetype') || MIME_TEXT;
  const files = {};
  const manifest = [];
  // Pictures in office:binary-data → Pictures/…
  let n = 0;
  for (const bin of [...doc.getElementsByTagNameNS(OFFICE, 'binary-data')]) {
    const holder = bin.parentNode;
    const bytes = unbase64(bin.textContent || '');
    const ext = sniffImage(bytes);
    const path = `Pictures/flat${++n}.${ext}`;
    files[path] = bytes;
    manifest.push([path, Object.entries(EXT).find(([, e]) => e === ext)?.[0] || 'application/octet-stream']);
    holder.removeChild(bin);
    holder.setAttributeNS(XLINK, 'xlink:href', path);
    holder.setAttributeNS(XLINK, 'xlink:type', 'simple');
    holder.setAttributeNS(XLINK, 'xlink:show', 'embed');
    holder.setAttributeNS(XLINK, 'xlink:actuate', 'onLoad');
  }
  // Inline objects (equations, charts) → Object N/content.xml (+ styles.xml).
  let o = 0;
  for (const obj of [...doc.getElementsByTagNameNS(DRAW, 'object')]) {
    const inner = [...obj.children][0];
    if (!inner) continue;
    const dir = `Object ${++o}`;
    if (inner.namespaceURI === OFFICE && inner.localName === 'document') {
      const kids = [...inner.children];
      const pick = (names) => kids.filter((k) => names.includes(k.localName)).map(ser).join('');
      files[`${dir}/content.xml`] = strToU8(`${DECL}<office:document-content${rootAttrs(inner)}>${pick(['font-face-decls', 'automatic-styles', 'body'])}</office:document-content>`);
      const st = pick(['styles']);
      if (st) files[`${dir}/styles.xml`] = strToU8(`${DECL}<office:document-styles${rootAttrs(inner)}>${st}</office:document-styles>`);
      manifest.push([`${dir}/`, inner.getAttributeNS(OFFICE, 'mimetype') || 'application/vnd.oasis.opendocument.chart']);
    } else {
      files[`${dir}/content.xml`] = strToU8(DECL + ser(inner));
      manifest.push([`${dir}/`, 'application/vnd.oasis.opendocument.formula']);
    }
    manifest.push([`${dir}/content.xml`, 'text/xml']);
    if (files[`${dir}/styles.xml`]) manifest.push([`${dir}/styles.xml`, 'text/xml']);
    obj.removeChild(inner);
    obj.setAttributeNS(XLINK, 'xlink:href', `./${dir}`);
    obj.setAttributeNS(XLINK, 'xlink:type', 'simple');
    obj.setAttributeNS(XLINK, 'xlink:show', 'embed');
    obj.setAttributeNS(XLINK, 'xlink:actuate', 'onLoad');
  }
  const kids = [...root.children];
  const pick = (names) => kids.filter((k) => k.namespaceURI === OFFICE && names.includes(k.localName)).map(ser).join('');
  const attrs = rootAttrs(root);
  files['content.xml'] = strToU8(`${DECL}<office:document-content${attrs}>${pick(['scripts', 'font-face-decls', 'automatic-styles', 'body'])}</office:document-content>`);
  // Automatic styles used by the master pages (page layouts…) go with them.
  const masterEl = kids.find((k) => k.localName === 'master-styles');
  const masterText = masterEl ? ser(masterEl) : '';
  const autoEl = kids.find((k) => k.localName === 'automatic-styles');
  const masterAutos = autoEl ? [...autoEl.children].filter((e) => e.localName === 'page-layout' || masterText.includes(`"${e.getAttribute('style:name')}"`)).map(ser).join('') : '';
  files['styles.xml'] = strToU8(`${DECL}<office:document-styles${attrs}>${pick(['font-face-decls', 'styles'])}<office:automatic-styles>${masterAutos}</office:automatic-styles>${masterText}</office:document-styles>`);
  const meta = pick(['meta']);
  if (meta) files['meta.xml'] = strToU8(`${DECL}<office:document-meta${attrs}>${meta}</office:document-meta>`);
  const settings = pick(['settings']);
  if (settings) files['settings.xml'] = strToU8(`${DECL}<office:document-settings${attrs}>${settings}</office:document-settings>`);
  const entries = [['/', mime], ['content.xml', 'text/xml'], ['styles.xml', 'text/xml'], ...(meta ? [['meta.xml', 'text/xml']] : []), ...(settings ? [['settings.xml', 'text/xml']] : []), ...manifest];
  files['META-INF/manifest.xml'] = strToU8(`${DECL}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">${entries.map(([p, t]) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${t}"${p === '/' ? ' manifest:version="1.3"' : ''}/>`).join('')}</manifest:manifest>`);
  return zipSync({ mimetype: [strToU8(mime), { level: 0 }], ...files });
}

/** ODT package bytes → flat ODT text. */
export function packageToFlatOdt(bytes) {
  const files = unzipSync(bytes);
  const mime = files.mimetype ? strFromU8(files.mimetype).trim() : MIME_TEXT;
  const parse = (p) => (files[p] ? new DOMParser().parseFromString(strFromU8(files[p]), 'application/xml') : null);
  const content = parse('content.xml');
  const styles = parse('styles.xml');
  const meta = parse('meta.xml');
  const settings = parse('settings.xml');
  const child = (d, name) => (d ? [...d.documentElement.children].find((c) => c.localName === name && c.namespaceURI === OFFICE) : null);
  // Automatic styles of styles.xml and content.xml share one element: rename styles.xml's on a clash.
  const cAuto = child(content, 'automatic-styles');
  const sAuto = child(styles, 'automatic-styles');
  const master = child(styles, 'master-styles');
  const names = new Set([...(cAuto?.children || [])].map((e) => e.getAttribute('style:name')));
  for (const st of [...(sAuto?.children || [])]) {
    const name = st.getAttribute('style:name');
    if (!name || !names.has(name)) continue;
    const renamed = `${name}_ms`;
    st.setAttribute('style:name', renamed);
    for (const el of master ? master.getElementsByTagName('*') : []) {
      for (const a of [...el.attributes]) if (/style-name$|page-layout-name$/.test(a.localName) && a.value === name) el.setAttribute(a.name, renamed);
    }
  }
  // Pictures and objects inline.
  const inlineRefs = (d) => {
    if (!d) return;
    for (const el of [...d.getElementsByTagNameNS(DRAW, 'image'), ...d.getElementsByTagNameNS(DRAW, 'fill-image')]) {
      const href = (el.getAttributeNS(XLINK, 'href') || '').replace(/^\.\//, '');
      if (!files[href]) continue;
      const bin = d.createElementNS(OFFICE, 'office:binary-data');
      bin.textContent = base64(files[href]);
      for (const a of ['href', 'type', 'show', 'actuate']) el.removeAttributeNS(XLINK, a);
      el.appendChild(bin);
    }
    for (const el of [...d.getElementsByTagNameNS(DRAW, 'object')]) {
      const dir = (el.getAttributeNS(XLINK, 'href') || '').replace(/^\.\//, '').replace(/\/$/, '');
      const oc = files[`${dir}/content.xml`] && new DOMParser().parseFromString(strFromU8(files[`${dir}/content.xml`]), 'application/xml');
      if (!oc) continue;
      const r = oc.documentElement;
      let node;
      if (r.namespaceURI === OFFICE) {
        const os = files[`${dir}/styles.xml`] && new DOMParser().parseFromString(strFromU8(files[`${dir}/styles.xml`]), 'application/xml');
        const objMime = (strFromU8(files['META-INF/manifest.xml'] || new Uint8Array()).match(new RegExp(`full-path="${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/"[^>]*media-type="([^"]+)"`)) || [])[1] || 'application/vnd.oasis.opendocument.chart';
        const xml = `<office:document${rootAttrs(r)} office:mimetype="${objMime}">${os ? [...os.documentElement.children].filter((c) => c.localName === 'styles').map(ser).join('') : ''}${[...r.children].map(ser).join('')}</office:document>`;
        node = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
      } else node = r;
      for (const a of ['href', 'type', 'show', 'actuate']) el.removeAttributeNS(XLINK, a);
      el.appendChild(d.importNode(node, true));
    }
  };
  inlineRefs(content);
  inlineRefs(styles);
  const fonts = new Map();
  for (const d of [styles, content]) for (const f of child(d, 'font-face-decls')?.children || []) if (!fonts.has(f.getAttribute('style:name'))) fonts.set(f.getAttribute('style:name'), ser(f));
  // Root namespace declarations: the union of the parts'.
  const decls = new Map();
  for (const d of [content, styles, meta, settings]) for (const a of d ? d.documentElement.attributes : []) if (a.name.startsWith('xmlns')) decls.set(a.name, a.value);
  const nsText = [...decls].map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
  const inner = (el) => (el ? [...el.children].map(ser).join('') : '');
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>\n<office:document${nsText} office:version="1.3" office:mimetype="${mime}">`,
    child(meta, 'meta') ? ser(child(meta, 'meta')) : '',
    child(settings, 'settings') ? ser(child(settings, 'settings')) : '',
    child(content, 'scripts') ? ser(child(content, 'scripts')) : '',
    `<office:font-face-decls>${[...fonts.values()].join('')}</office:font-face-decls>`,
    child(styles, 'styles') ? ser(child(styles, 'styles')) : '',
    `<office:automatic-styles>${inner(sAuto)}${inner(cAuto)}</office:automatic-styles>`,
    master ? ser(master) : '',
    child(content, 'body') ? ser(child(content, 'body')) : '',
    '</office:document>\n',
  ];
  return out.join('');
}
