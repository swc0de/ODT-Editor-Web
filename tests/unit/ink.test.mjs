import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkAttrs, centreLine, recognise, HMM } from '../../src/core/ink.js';

const gp = (a) => a.auto.props['style:graphic-properties'].a;

test('a mouse stroke is a smooth stroked path; a pressure stroke a filled outline whose centre line is recoverable', () => {
  const pts = [{ x: 10, y: 10 }, { x: 40, y: 30 }, { x: 80, y: 20 }, { x: 120, y: 40 }];
  const plain = inkAttrs(pts, { tool: 'pen', colour: '#ff0000', width: 2, name: 'Pen 1', z: 1 });
  assert.equal(plain.element, 'draw:path');
  assert.equal(gp(plain)['draw:fill'], 'none');
  assert.equal(gp(plain)['svg:stroke-color'], '#ff0000');
  assert.match(plain.frameAttrs['svg:d'], /^M[\d.]+ [\d.]+Q/);
  const pressed = inkAttrs(pts.map((p, i) => ({ ...p, p: 0.2 + i * 0.2 })), { tool: 'pen', colour: '#0000ff', width: 4, name: 'Pen 2', z: 2 });
  assert.equal(gp(pressed)['draw:fill'], 'solid');
  assert.equal(gp(pressed)['draw:stroke'], 'none');
  assert.match(pressed.frameAttrs['svg:d'], /Z$/);
  // The centre line comes back within a pixel of the original (in the object's own space).
  const centre = centreLine(pressed.frameAttrs).map((p) => ({ x: p.x * HMM, y: p.y * HMM }));
  const ox = parseFloat(pressed.frameAttrs['svg:x']) * (96 / 2.54);
  const oy = parseFloat(pressed.frameAttrs['svg:y']) * (96 / 2.54);
  centre.forEach((p, i) => { assert.ok(Math.abs(p.x + ox - pts[i].x) < 1 && Math.abs(p.y + oy - pts[i].y) < 1, `point ${i}`); });
  // Highlighters are half transparent.
  const hl = inkAttrs(pts, { tool: 'highlighter', colour: '#ffff00', width: 12, name: 'Highlighter 1', z: 3 });
  assert.equal(gp(hl)['svg:stroke-opacity'], '50%');
});

test('Ink to Shape recognises lines, arrows, rectangles, ellipses and triangles', () => {
  const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 50 + (i % 2) }));
  assert.equal(recognise(line).type, 'line');
  const arrow = [...line, { x: 175, y: 35 }, { x: 160, y: 25 }, { x: 175, y: 38 }, { x: 190, y: 51 }, { x: 175, y: 65 }, { x: 162, y: 75 }];
  assert.equal(recognise(arrow).type, 'arrow');
  const rect = [];
  for (let i = 0; i <= 10; i++) rect.push({ x: i * 20, y: 0 });
  for (let i = 0; i <= 10; i++) rect.push({ x: 200, y: i * 12 });
  for (let i = 10; i >= 0; i--) rect.push({ x: i * 20, y: 120 });
  for (let i = 10; i >= 0; i--) rect.push({ x: 0, y: i * 12 });
  assert.equal(recognise(rect).type, 'rectangle');
  const ellipse = Array.from({ length: 41 }, (_, i) => ({ x: 100 + 90 * Math.cos((i / 40) * Math.PI * 2), y: 60 + 50 * Math.sin((i / 40) * Math.PI * 2) }));
  assert.equal(recognise(ellipse).type, 'ellipse');
  const tri = [];
  const corners = [[0, 100], [60, 0], [120, 100], [0, 100]];
  for (let k = 0; k < 3; k++) for (let i = 0; i < 10; i++) tri.push({ x: corners[k][0] + ((corners[k + 1][0] - corners[k][0]) * i) / 10, y: corners[k][1] + ((corners[k + 1][1] - corners[k][1]) * i) / 10 });
  tri.push({ x: 0, y: 100 });
  assert.equal(recognise(tri).type, 'triangle');
  // A scribble is left as ink.
  const scribble = Array.from({ length: 30 }, (_, i) => ({ x: i * 7, y: (i % 3) * 25 + (i % 5) * 9 }));
  assert.equal(recognise(scribble), null);
});
