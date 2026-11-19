/**
 * Handles on a selected drawing object: eight resize handles (corners keep
 * the picture's proportions; Shift toggles), a rotation handle, the two ends
 * of a line, crop handles in crop mode, and dragging a floating object to
 * move it. Every gesture previews on the DOM and commits one undoable change.
 */
import { toPx } from './units.js';
import { sizeOf, withSize, withPosition, withRotation, rotationOf, withGraphic, withFrameAttrs, cm, originOf, positionOf } from '../core/objects.js';

const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const el = (cls) => { const e = document.createElement('span'); e.className = cls; return e; };

export function attachHandles(ov) {
  const env = ov.env;
  const layer = el('obj-handles');
  layer.setAttribute('aria-hidden', 'true');
  const a = ov.attrs;
  const cropping = env.cropMode?.() && a.kind === 'image';
  const isLine = a.element === 'draw:line';
  const floating = ov.wrap !== 'inline';
  ov.box.append(layer);
  if (cropping) layer.classList.add('cropping');
  // Mouse events that follow a handle drag mustn't move the text selection.
  layer.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  layer.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });

  const zoom = () => env.zoom?.() || 1;
  const start = (e, onMove, onEnd) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX; const sy = e.clientY;
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);
    ov.dom.classList.add('obj-dragging');
    const move = (ev) => onMove((ev.clientX - sx) / zoom(), (ev.clientY - sy) / zoom(), ev);
    const up = (ev) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      ov.dom.classList.remove('obj-dragging');
      onEnd((ev.clientX - sx) / zoom(), (ev.clientY - sy) / zoom(), ev);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  // ---------------------------------------------------------- lines
  if (isLine) {
    const fa = a.frameAttrs;
    const p1 = { x: toPx(fa['svg:x1'] || '0'), y: toPx(fa['svg:y1'] || '0') };
    const p2 = { x: toPx(fa['svg:x2'] || '0'), y: toPx(fa['svg:y2'] || '0') };
    const ox = Math.min(p1.x, p2.x); const oy = Math.min(p1.y, p2.y);
    for (const [key, p] of [['1', p1], ['2', p2]]) {
      const hd = el('obj-handle end');
      hd.style.left = `${p.x - ox}px`;
      hd.style.top = `${p.y - oy}px`;
      hd.addEventListener('pointerdown', (e) => start(e, (dx, dy) => { hd.style.left = `${p.x - ox + dx}px`; hd.style.top = `${p.y - oy + dy}px`; }, (dx, dy) => {
        if (!dx && !dy) return;
        ov.setAttrs(withFrameAttrs(a, { [`svg:x${key}`]: cm(p.x + dx), [`svg:y${key}`]: cm(p.y + dy) }));
      }));
      layer.append(hd);
    }
    moveHandler();
    return { remove: () => { layer.remove(); ov.box.onpointerdown = null; } };
  }

  // ---------------------------------------------------------- resize
  const { w, h } = sizeOf(a);
  for (const d of DIRS) {
    const hd = el(`obj-handle ${cropping ? 'crop' : 'size'} ${d}`);
    hd.dataset.dir = d;
    hd.addEventListener('pointerdown', (e) => (cropping ? cropDrag(e, d) : resizeDrag(e, d)));
    layer.append(hd);
  }

  function resizeDrag(e, d) {
    const keepDefault = a.kind === 'image' && d.length === 2;
    const o = floating ? originOf(a) : { x: 0, y: 0 };
    const rot = rotationOf(a);
    let nw = w; let nh = h; let nx = o.x; let ny = o.y;
    const calc = (dx, dy, ev) => {
      const keep = keepDefault !== !!ev.shiftKey;
      nw = w + (d.includes('e') ? dx : d.includes('w') ? -dx : 0);
      nh = h + (d.includes('s') ? dy : d.includes('n') ? -dy : 0);
      if (keep && d.length === 2) {
        // The dimension dragged furthest decides the scale.
        const k = Math.abs(nw / w - 1) >= Math.abs(nh / h - 1) ? nw / w : nh / h;
        nw = w * k; nh = h * k;
      }
      nw = Math.max(4, nw); nh = Math.max(4, nh);
      nx = o.x + (d.includes('w') ? w - nw : 0);
      ny = o.y + (d.includes('n') ? h - nh : 0);
    };
    start(e, (dx, dy, ev) => {
      calc(dx, dy, ev);
      ov.box.style.width = `${nw}px`;
      ov.box.style[a.kind === 'textbox' ? 'minHeight' : 'height'] = `${nh}px`;
      if (floating) ov.box.style.translate = `${nx - o.x}px ${ny - o.y}px`;
    }, (dx, dy, ev) => {
      if (!dx && !dy) { ov.render(ov.node); return; }
      calc(dx, dy, ev);
      let next = withSize(a, nw, nh);
      if (floating && (nx !== o.x || ny !== o.y)) next = rot ? withRotation(next, rot, { x: nx, y: ny }) : withPosition(next, { x: nx, y: ny });
      else if (rot) next = withRotation(next, rot, o);
      ov.setAttrs(next);
    });
  }

  // ---------------------------------------------------------- crop
  function cropDrag(e, d) {
    const nat = ov.natural;
    if (!nat) return;
    const gp = ov.gp;
    const m = /rect\(([^)]*)\)/.exec(gp['fo:clip'] || '');
    const clip = m ? m[1].split(/[\s,]+/).filter(Boolean).map((x) => (x === 'auto' ? 0 : toPx(x) || 0)) : [0, 0, 0, 0];
    const [t0, r0, b0, l0] = clip;
    const sx = w / Math.max(1, nat.w - l0 - r0);
    const sy = h / Math.max(1, nat.h - t0 - b0);
    const o = floating ? originOf(a) : { x: 0, y: 0 };
    let res = null;
    const calc = (dx, dy) => {
      let [t, r, b, l] = [t0, r0, b0, l0];
      if (d.includes('w')) l = Math.max(0, Math.min(nat.w - r - 4, l0 + dx / sx));
      if (d.includes('e')) r = Math.max(0, Math.min(nat.w - l - 4, r0 - dx / sx));
      if (d.includes('n')) t = Math.max(0, Math.min(nat.h - b - 4, t0 + dy / sy));
      if (d.includes('s')) b = Math.max(0, Math.min(nat.h - t - 4, b0 - dy / sy));
      const nw = (nat.w - l - r) * sx; const nh = (nat.h - t - b) * sy;
      res = { t, r, b, l, nw, nh, x: o.x + (l - l0) * sx, y: o.y + (t - t0) * sy };
    };
    start(e, (dx, dy) => {
      calc(dx, dy);
      ov.box.style.width = `${res.nw}px`;
      ov.box.style.height = `${res.nh}px`;
      const img = ov.box.querySelector('img');
      if (img) Object.assign(img.style, { left: `${-res.l * sx}px`, top: `${-res.t * sy}px`, width: `${nat.w * sx}px`, height: `${nat.h * sy}px` });
    }, (dx, dy) => {
      if (!dx && !dy) return;
      calc(dx, dy);
      const any = res.t || res.r || res.b || res.l;
      let next = withGraphic(withSize(a, res.nw, res.nh), { 'fo:clip': any ? `rect(${cm(res.t)}, ${cm(res.r)}, ${cm(res.b)}, ${cm(res.l)})` : null });
      if (floating) next = withPosition(next, { x: res.x, y: res.y });
      ov.setAttrs(next);
    });
  }

  // ---------------------------------------------------------- rotate
  if (!cropping) {
    const rh = el('obj-handle rotate');
    rh.addEventListener('pointerdown', (e) => {
      const r = ov.box.getBoundingClientRect();
      const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
      const base = rotationOf(a);
      const ang = (ev) => {
        // Screen angle of the pointer around the centre, as ODF degrees (counter-clockwise, 0 = handle up).
        let deg = -(Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) * 180) / Math.PI;
        if (!ev.altKey) deg = Math.round(deg / (ev.shiftKey ? 15 : 1)) * (ev.shiftKey ? 15 : 1);
        return ((deg % 360) + 360) % 360;
      };
      let last = base;
      start(e, (_dx, _dy, ev) => { last = ang(ev); ov.box.style.transform = `rotate(${-last}deg)`; }, (_dx, _dy, ev) => {
        last = ang(ev);
        if (Math.abs(last - base) < 0.01) return;
        ov.setAttrs(withRotation(a, last, floating ? originOf(a) : { x: 0, y: 0 }));
      });
    });
    layer.append(rh);
  }

  moveHandler();

  // ---------------------------------------------------------- move
  function moveHandler() {
    if (!floating || cropping) return;
    ov.box.onpointerdown = (e) => {
      // Clicks on the text of a text box / shape edit the text; drag the border to move.
      if (e.button !== 0 || e.target.closest('.obj-handle') || e.target.closest('.obj-text .ProseMirror')) return;
      if (!ov.selected) return;
      const o = isLine ? null : originOf(a);
      let moved = false;
      start(e, (dx, dy) => { moved = moved || Math.abs(dx) + Math.abs(dy) > 2; ov.box.style.translate = `${dx}px ${dy}px`; }, (dx, dy, ev) => {
        ov.box.style.translate = '';
        if (!moved) return;
        env.moveObject?.(ov, { dx, dy, origin: o, clientX: ev.clientX, clientY: ev.clientY });
      });
    };
  }

  return { remove: () => { layer.remove(); ov.box.onpointerdown = null; } };
}

export { positionOf };
