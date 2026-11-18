/**
 * Header and footer editing. Double-clicking a page's header or footer (or
 * Insert ▸ Header ▸ Edit Header) opens an editor in place over that page's
 * header/footer area; the document body is dimmed and read-only, and the
 * contextual Header & Footer tab appears. Edits are written back to the
 * page style (master page) as undoable steps after a short pause and when
 * the editor closes (Esc, Close Header and Footer, or double-clicking the
 * body). Every page using that page style shows the change.
 */
import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { createEditor } from '../core/editor.js';
import { editState } from '../core/state-step.js';
import { findPart, partToDoc, writePart, removePart } from '../core/hf-content.js';
import { updatePageLayouts, findMaster, findLayout, hfExtent, hasPart } from '../core/page-setup.js';
import { treeToXml } from '../core/odt/xml.js';
import { toPx } from '../layout/units.js';

const PAGE_KEYS = ['masterStyles', 'stylesAutoStyles'];
const CM = 96 / 2.54;
const cm = (v) => `${+v.toFixed(3)}cm`;

export function createHeaderFooter({ store, docArea, getSession, mainEditor, editorEnv }) {
  let active = null; // { master, part, kind, pageIndex, editor, layer, box, dirty }
  let commitTimer = 0;

  const session = () => getSession();
  const view = () => mainEditor.view;

  /** Which variant a page uses for a part (also when the part doesn't exist yet). */
  function kindFor(page, part) {
    const k = page.box?.[`${part}Kind`];
    if (k) return k;
    const m = docArea.model?.masters.get(page.master);
    if (!m) return 'right';
    if (page.indexInMaster === 0 && m[part].first) return 'first';
    if (page.number % 2 === 0 && m[part].left) return 'left';
    return 'right';
  }

  /** Adds an empty header/footer to a page style, keeping the body where it was (like Word). */
  function ensurePart(masterName, part, kind) {
    const st = session().state;
    if (findPart(st, masterName, part, kind).tree) return;
    editState(view(), st, PAGE_KEYS, (s) => {
      const master = findMaster(s, masterName);
      const had = hasPart(master, part);
      writePart(s, masterName, part, kind, partToDoc(s, docArea.styleIndex, { c: [{ n: 'text:p', a: { 'text:style-name': part === 'header' ? 'Header' : 'Footer' } }] }));
      if (had) return;
      // ODF measures the page margin to the header; Word measures it to the body.
      updatePageLayouts(s, [masterName], (a) => {
        const side = part === 'header' ? 'top' : 'bottom';
        const body = (toPx(a[`fo:margin-${side}`] || '2cm') || 0) / CM;
        const edge = Math.min(1.25, Math.max(0.3, body - 0.8));
        const gap = Math.min(0.5, Math.max(0, body - edge) / 2);
        return {
          attrs: { [`fo:margin-${side}`]: cm(edge) },
          [part]: { 'fo:min-height': cm(Math.max(0, body - edge - gap)), [part === 'header' ? 'fo:margin-bottom' : 'fo:margin-top']: cm(gap) },
        };
      });
    });
  }

  function layerGeometry() {
    const page = docArea.pages[active.pageIndex] || docArea.pages[0];
    const m = docArea.model.masters.get(active.master) || docArea.model.first;
    const top = page ? page.top : 0;
    active.layer.style.cssText = `top:${top}px;left:${m.x}px;width:${m.width}px;height:${page ? page.box.pageHeight : m.height}px`;
    active.box.style.cssText = active.part === 'header'
      ? `top:${m.marginTop}px;left:${m.marginLeft}px;right:${m.marginRight}px`
      : `bottom:${m.marginBottom}px;left:${m.marginLeft}px;right:${m.marginRight}px`;
    const label = `${t(active.part === 'header' ? `hf.label.header.${active.kind}` : `hf.label.footer.${active.kind}`)}${docArea.model.masters.size > 1 ? ` – ${m.displayName}` : ''}`;
    active.tag.textContent = label;
  }

  /** Finds the page to anchor to after a re-layout (same page style and variant, nearest index). */
  function relocate() {
    if (!active) return;
    const pages = docArea.pages;
    let best = -1;
    pages.forEach((p, i) => {
      if (p.master !== active.master || kindFor(p, active.part) !== active.kind) return;
      if (best < 0 || Math.abs(i - active.pageIndex) < Math.abs(best - active.pageIndex)) best = i;
    });
    if (best >= 0) active.pageIndex = best;
    layerGeometry();
  }

  function commit() {
    clearTimeout(commitTimer);
    if (!active?.dirty) return;
    active.dirty = false;
    const { master, part, kind, editor } = active;
    editState(view(), session().state, PAGE_KEYS, (s) => writePart(s, master, part, kind, editor.view.state.doc));
  }

  function open({ pageIndex = null, part = 'header', kind = null } = {}) {
    const pages = docArea.pages;
    if (!pages.length) return;
    if (pageIndex == null) pageIndex = docArea.pageAt(view().state.selection.head);
    const page = pages[pageIndex] || pages[0];
    const k = kind || kindFor(page, part);
    if (active && active.master === page.master && active.part === part && active.kind === k) { active.editor.focus(); return; }
    close({ focusBody: false });
    ensurePart(page.master, part, k);
    const st = session().state;
    const doc = partToDoc(st, docArea.styleIndex, findPart(st, page.master, part, k).tree);
    const mount = h('div', { class: 'odt-doc hf-doc' });
    const tag = h('div', { class: 'hf-tag' });
    const box = h('div', { class: `hf-edit-box ${part}` }, mount, tag);
    const layer = h('div', { class: 'hf-edit-page' }, box);
    docArea.view.stack.append(layer);
    const editor = createEditor(mount, editorEnv({
      onTransaction: (_v, tr) => {
        if (tr.docChanged && !tr.getMeta('load')) {
          active.dirty = true;
          clearTimeout(commitTimer);
          commitTimer = setTimeout(commit, 600);
        }
      },
    }));
    editor.setDoc(doc);
    active = { master: page.master, part, kind: k, pageIndex, editor, layer, box, tag, dirty: false };
    view().setProps({ editable: () => false });
    docArea.canvas.classList.add('hf-mode');
    store.set({ contextual: 'headerFooter', activeTab: 'headerFooter', hfEditing: `${part}:${k}` });
    layerGeometry();
    requestAnimationFrame(() => { if (active?.editor === editor) { layerGeometry(); editor.focus(); } });
  }

  function close({ focusBody = true } = {}) {
    if (!active) return;
    commit();
    active.editor.view.destroy();
    active.layer.remove();
    active = null;
    view().setProps({ editable: () => true });
    docArea.canvas.classList.remove('hf-mode', 'hf-hide-body');
    const s = store.get();
    store.set({ contextual: null, hfEditing: null, ...(s.activeTab === 'headerFooter' ? { activeTab: 'home' } : {}) });
    if (focusBody) mainEditor.focus();
  }

  // Double-click a header/footer area to edit it; double-click the body to go back.
  docArea.canvas.addEventListener('dblclick', (e) => {
    if (e.target.closest('.hf-edit-box')) return;
    const pages = docArea.pages;
    const stackRect = docArea.view.stack.getBoundingClientRect();
    const z = store.get().zoom / 100;
    const y = (e.clientY - stackRect.top) / z;
    const i = pages.findIndex((p) => y >= p.top && y <= p.top + p.box.pageHeight);
    if (i < 0) return;
    const p = pages[i];
    const local = y - p.top;
    if (local < p.box.top) { e.preventDefault(); open({ pageIndex: i, part: 'header' }); } else if (local > p.box.bottom) { e.preventDefault(); open({ pageIndex: i, part: 'footer' }); } else if (active) { e.preventDefault(); close(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active && active.editor.view.hasFocus() && !document.querySelector('.menu, .dlg-overlay')) { e.preventDefault(); close(); }
  });

  // ------------------------------------------------------------ options & navigation

  const masterTree = () => findMaster(session().state, active?.master || docArea.pages[docArea.pageAt(view().state.selection.head)]?.master);

  /** Sections in page order: [{ master, firstPage }]. */
  function sectionStarts() {
    const out = [];
    docArea.pages.forEach((p, i) => { if (!out.length || out[out.length - 1].master !== p.master || p.indexInMaster === 0) out.push({ master: p.master, page: i }); });
    return out;
  }

  function goSection(dir) {
    if (!active) return;
    const secs = sectionStarts();
    const cur = secs.findLastIndex((s) => s.page <= active.pageIndex);
    const next = secs[cur + dir];
    if (next) open({ pageIndex: next.page, part: active.part });
  }

  /** The same part of the previous section's page style, as XML (for Link to Previous). */
  function previousPartXml() {
    if (!active) return null;
    const secs = sectionStarts();
    const cur = secs.findLastIndex((s) => s.page <= active.pageIndex);
    const prev = secs[cur - 1];
    if (!prev || prev.master === active.master) return null;
    const tree = findPart(session().state, prev.master, active.part, active.kind).tree || findPart(session().state, prev.master, active.part, 'right').tree;
    return { master: prev.master, xml: tree ? treeToXml({ n: 'x', a: {}, c: tree.c || [] }) : '' };
  }

  function linkedToPrevious() {
    const p = previousPartXml();
    if (!p || !active) return false;
    commit();
    const own = findPart(session().state, active.master, active.part, active.kind).tree;
    return treeToXml({ n: 'x', a: {}, c: own?.c || [] }) === p.xml;
  }

  function linkToPrevious() {
    const p = previousPartXml();
    if (!p || !active) return;
    const st = session().state;
    const tree = findPart(st, p.master, active.part, active.kind).tree || findPart(st, p.master, active.part, 'right').tree;
    const doc = partToDoc(st, docArea.styleIndex, tree);
    const ed = active.editor;
    ed.view.dispatch(ed.view.state.tr.replaceWith(0, ed.view.state.doc.content.size, doc.content));
    commit();
  }

  function setHeaderDistance(part, valueCm) {
    const name = active?.master || masterTree()?.a['style:name'];
    if (!name) return;
    editState(view(), session().state, PAGE_KEYS, (s) => updatePageLayouts(s, [name], (a, layout) => {
      const e = hfExtent(layout);
      const side = part === 'header' ? 'top' : 'bottom';
      const edge = (toPx(a[`fo:margin-${side}`] || '0cm') || 0) / CM;
      const body = edge + (part === 'header' ? e.headerMin + e.headerGap : e.footerMin + e.footerGap);
      const gap = part === 'header' ? e.headerGap : e.footerGap;
      return { attrs: { [`fo:margin-${side}`]: cm(valueCm) }, [part]: { 'fo:min-height': cm(Math.max(0, body - valueCm - gap)) } };
    }));
  }

  /** Header / footer distances from the page edge (cm) for the current page style. */
  function distances() {
    const m = masterTree();
    const l = m && findLayout(session().state, m.a['style:page-layout-name']);
    const p = (l?.c || []).find((c) => c.n === 'style:page-layout-properties')?.a || {};
    return { header: (toPx(p['fo:margin-top'] || '0cm') || 0) / CM, footer: (toPx(p['fo:margin-bottom'] || '0cm') || 0) / CM };
  }

  function remove(part) {
    const page = docArea.pages[docArea.pageAt(view().state.selection.head)];
    const name = active?.master || page?.master;
    if (!name) return;
    if (active?.part === part) { active.dirty = false; close({ focusBody: true }); }
    editState(view(), session().state, PAGE_KEYS, (s) => removePart(s, name, part));
  }

  return {
    open, close, commit, remove,
    isActive: () => !!active,
    activeEditor: () => active?.editor || null,
    current: () => (active ? { master: active.master, part: active.part, kind: active.kind } : null),
    relocate,
    goPart: (part) => { if (active) open({ pageIndex: active.pageIndex, part }); },
    previous: () => goSection(-1),
    next: () => goSection(1),
    hasPrevious: () => { const secs = sectionStarts(); return !!active && secs.findLastIndex((s) => s.page <= active.pageIndex) > 0; },
    hasNext: () => { const secs = sectionStarts(); return !!active && secs.findLastIndex((s) => s.page <= active.pageIndex) < secs.length - 1; },
    linkedToPrevious, linkToPrevious, canLink: () => !!previousPartXml(),
    masterName: () => masterTree()?.a['style:name'] || null,
    reopen: () => { if (active) { const a = { pageIndex: active.pageIndex, part: active.part }; close({ focusBody: false }); requestAnimationFrame(() => requestAnimationFrame(() => open(a))); } },
    setDistance: setHeaderDistance, distances,
    toggleBody: () => docArea.canvas.classList.toggle('hf-hide-body'),
    bodyShown: () => !docArea.canvas.classList.contains('hf-hide-body'),
  };
}
