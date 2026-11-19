/**
 * Tracked changes ↔ ODF.
 *
 * In the editor a change is a mark on the text (insertion / deletion /
 * formatChange with { author, date, cid }) and, when a paragraph's ending
 * was inserted or deleted, the paragraph's `change` attribute. Deleted text
 * stays in the document (shown struck through) until it is accepted.
 *
 * ODF keeps changes in text:tracked-changes (office:text prelude):
 *   insertion      text:change-start … text:change-end around the new text
 *                  (spanning paragraphs when paragraph breaks were inserted)
 *   deletion       a text:change point where the text was; the deleted
 *                  paragraphs (one or more text:p) live in the region
 *   format-change  text:change-start … text:change-end
 *
 * importChanges() turns change markers + regions into marks; exportChanges()
 * does the reverse. Regions it can't express (deleted tables, changes inside
 * text boxes…) stay as markers and prelude XML, untouched.
 */

const TEXTBLOCK = new Set(['paragraph', 'heading']);
const CONTAINERS = new Set(['list', 'list_item', 'table', 'table_row', 'table_cell', 'section', 'index']);
const MARK_OF = { insertion: 'insertion', deletion: 'deletion', 'format-change': 'formatChange' };

/** A new change id. */
export const newChangeId = () => `ct${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const withMark = (node, mark) => {
  const marks = (node.marks || []).filter((m) => m.type !== mark.type);
  return { ...node, marks: [...marks, mark] };
};

/**
 * Import. blocks: body block JSON (with change_marker nodes); regions:
 * Map(id → { type, author, date, blocks? (deletion content JSON) }).
 * Returns { blocks, used: Set(ids converted) }.
 */
export function importChanges(blocks, regions) {
  const used = new Set();
  if (!regions.size) return { blocks, used };
  const open = new Map(); // id → region (insertions and format changes)
  const markFor = (id, r) => ({ type: MARK_OF[r.type], attrs: { author: r.author, date: r.date, cid: id, old: null } });

  const convertible = (r) => r && (r.type === 'insertion' || r.type === 'format-change' || (r.type === 'deletion' && (r.blocks || []).every((b) => TEXTBLOCK.has(b.type))));

  function textblock(tb) {
    const out = [];
    let cur = { ...tb, content: [] };
    const push = (n) => {
      let node = n;
      for (const [id, r] of open) node = withMark(node, markFor(id, r));
      cur.content.push(node);
    };
    for (const n of tb.content || []) {
      if (n.type === 'change_marker') {
        const id = n.attrs?.changeId;
        const r = regions.get(id);
        if (!convertible(r)) { cur.content.push(n); continue; }
        if (n.attrs.kind === 'start' && r.type !== 'deletion') { open.set(id, r); used.add(id); continue; }
        if (n.attrs.kind === 'end' && r.type !== 'deletion') { open.delete(id); used.add(id); continue; }
        if (n.attrs.kind === 'point' && r.type === 'deletion') {
          used.add(id);
          const mark = markFor(id, r);
          const del = r.blocks.length ? r.blocks : [{ type: 'paragraph', attrs: {} }];
          del.forEach((d, k) => {
            if (k > 0) {
              // The deleted paragraph break: end this paragraph here.
              cur.attrs = { ...cur.attrs, change: { type: 'deletion', ...mark.attrs } };
              out.push(cur);
              cur = { type: d.type, attrs: { ...d.attrs, change: null }, content: [] };
            }
            for (const c of d.content || []) cur.content.push(withMark(c, mark));
          });
          continue;
        }
        cur.content.push(n);
        continue;
      }
      push(n);
    }
    // An insertion still open at the end of the paragraph: its break was inserted.
    const ins = [...open].find(([, r]) => r.type === 'insertion');
    if (ins) cur.attrs = { ...cur.attrs, change: { type: 'insertion', ...markFor(ins[0], ins[1]).attrs } };
    out.push(cur);
    return out.map((b) => (b.content.length ? b : (({ content, ...rest }) => rest)(b)));
  }

  function list(arr) {
    const out = [];
    for (const b of arr) {
      if (TEXTBLOCK.has(b.type)) out.push(...textblock(b));
      else if (CONTAINERS.has(b.type) && b.content) out.push({ ...b, content: list(b.content) });
      else out.push(b);
    }
    return out;
  }
  return { blocks: list(blocks), used };
}

// ------------------------------------------------------------------ export

const changeOf = (node, type) => (node.marks || []).find((m) => m.type === type)?.attrs || null;

/**
 * Export. Returns { doc JSON (marks replaced by change markers, deleted text
 * removed, paragraphs with a deleted break merged), regions: [{ id, type,
 * author, date, blocks }] }.
 */
export function exportChanges(docJson) {
  const regions = [];
  const seen = new Map(); // cid → times used as a region id
  const regionId = (cid) => {
    const base = cid || newChangeId();
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}_${n + 1}` : base;
  };
  // Open runs carried from one paragraph to the next.
  const run = { insertion: null, formatChange: null }; // { cid, id }

  const marker = (kind, id) => ({ type: 'change_marker', attrs: { kind, changeId: id } });
  const strip = (n) => {
    const marks = (n.marks || []).filter((m) => !['insertion', 'deletion', 'formatChange'].includes(m.type));
    const c = { ...n };
    if (marks.length) c.marks = marks; else delete c.marks;
    return c;
  };

  /** One merged group of textblocks (joined by deleted breaks) → one textblock. */
  function group(tbs) {
    const content = [];
    let del = null; // { region, block } while inside deleted text
    const closeDel = () => { del = null; };
    const openDel = (attrs, tb) => {
      const id = regionId(attrs.cid);
      const region = { id, type: 'deletion', author: attrs.author, date: attrs.date, blocks: [] };
      regions.push(region);
      content.push(marker('point', id));
      del = { region, cid: attrs.cid, block: { type: tb.type, attrs: { ...tb.attrs, change: null }, content: [] } };
      region.blocks.push(del.block);
    };
    const step = (type, n) => {
      const a = changeOf(n, type);
      const r = run[type];
      if (r && (!a || a.cid !== r.cid)) { content.push(marker('end', r.id)); run[type] = null; }
      if (a && !run[type]) {
        const id = regionId(a.cid);
        regions.push({ id, type: type === 'insertion' ? 'insertion' : 'format-change', author: a.author, date: a.date });
        content.push(marker('start', id));
        run[type] = { cid: a.cid, id };
      }
    };
    tbs.forEach((tb, i) => {
      for (const n of tb.content || []) {
        const d = changeOf(n, 'deletion');
        if (d && (!del || del.cid !== d.cid)) { step('insertion', n); step('formatChange', n); }
        if (d) {
          if (!del || del.cid !== d.cid) { closeDel(); openDel(d, tb); }
          del.block.content.push(strip(n));
          continue;
        }
        closeDel();
        step('insertion', n);
        step('formatChange', n);
        content.push(strip(n));
      }
      const ch = tb.attrs?.change;
      if (i < tbs.length - 1) {
        // A deleted break: the deletion continues into the next paragraph's text.
        if (!del || del.cid !== ch.cid) { closeDel(); openDel(ch, tb); }
        const next = tbs[i + 1];
        del.block = { type: next.type, attrs: { ...next.attrs, change: null }, content: [] };
        del.region.blocks.push(del.block);
      }
    });
    // Runs continue past the end only when this paragraph's break was inserted (and the run continues).
    const last = tbs[tbs.length - 1];
    const brk = last.attrs?.change;
    for (const type of ['insertion', 'formatChange']) {
      const r = run[type];
      if (r && !(type === 'insertion' && brk?.type === 'insertion' && brk.cid === r.cid)) { content.push(marker('end', r.id)); run[type] = null; }
    }
    if (brk?.type === 'insertion' && !run.insertion) {
      // Only the break itself was inserted.
      const id = regionId(brk.cid);
      regions.push({ id, type: 'insertion', author: brk.author, date: brk.date });
      content.push(marker('start', id));
      run.insertion = { cid: brk.cid, id };
    }
    // Strip the empty text runs left in deletion blocks.
    for (const r of regions) for (const b of r.blocks || []) if (!b.content?.length) delete b.content;
    const out = { ...tbs[0], attrs: { ...tbs[0].attrs, change: null } };
    if (content.length) out.content = content; else delete out.content;
    return out;
  }

  function closeRuns(into) {
    // A run can't continue past a non-paragraph: close it in the last paragraph written.
    for (const type of ['insertion', 'formatChange']) {
      const r = run[type];
      if (!r) continue;
      const tb = into;
      if (tb) tb.content = [...(tb.content || []), marker('end', r.id)];
      run[type] = null;
    }
  }

  function list(arr) {
    const out = [];
    let lastTb = null;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (TEXTBLOCK.has(b.type)) {
        const tbs = [b];
        // Paragraphs joined by deleted breaks are one paragraph in ODF.
        while (tbs[tbs.length - 1].attrs?.change?.type === 'deletion' && TEXTBLOCK.has(arr[i + 1]?.type)) tbs.push(arr[++i]);
        lastTb = group(tbs);
        out.push(lastTb);
      } else {
        closeRuns(lastTb);
        lastTb = null;
        out.push(CONTAINERS.has(b.type) && b.content ? { ...b, content: list(b.content) } : b);
      }
    }
    closeRuns(lastTb);
    return out;
  }
  const doc = { ...docJson, content: list(docJson.content || []) };
  return { doc, regions };
}

/** Whether a document has any tracked changes (marks or paragraph breaks). */
export function hasChanges(doc) {
  let found = false;
  doc.descendants((n) => {
    if (found) return false;
    if (n.attrs?.change || n.marks?.some((m) => m.type.name === 'insertion' || m.type.name === 'deletion' || m.type.name === 'formatChange')) found = true;
    return !found;
  });
  return found;
}
