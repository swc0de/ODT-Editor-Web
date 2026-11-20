/**
 * Unit conversions. Internally the layout works in CSS pixels at 96 dpi;
 * ODT stores lengths with units ("2.54cm", "12pt", "0.5in").
 */
export const PX_PER_IN = 96;
export const PX_PER_CM = PX_PER_IN / 2.54;
export const PX_PER_MM = PX_PER_CM / 10;
export const PX_PER_PT = PX_PER_IN / 72;
export const PX_PER_PC = PX_PER_PT * 12;

const FACTORS = { px: 1, in: PX_PER_IN, cm: PX_PER_CM, mm: PX_PER_MM, pt: PX_PER_PT, pc: PX_PER_PC };

export const UNITS = Object.freeze(['cm', 'mm', 'in', 'pt']);

/** Converts a value from one unit to another. */
export function convert(value, from, to) {
  if (!(from in FACTORS) || !(to in FACTORS)) throw new Error(`Unknown unit ${from} → ${to}`);
  return (value * FACTORS[from]) / FACTORS[to];
}

/** Parses an ODF/CSS length ("2.54cm", "-0.5in", "12pt") → { value, unit }, or null. */
export function parseLength(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^(-?\d*\.?\d+(?:e-?\d+)?)\s*(px|in|cm|mm|pt|pc)?$/i);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: (m[2] || 'px').toLowerCase() };
}

/** Length string → pixels (NaN if unparsable). */
export function toPx(str) {
  const l = parseLength(str);
  return l ? convert(l.value, l.unit, 'px') : NaN;
}

/** Formats a number with a unit for ODF output, trimming trailing zeros. */
export function formatLength(value, unit, decimals = 4) {
  const n = Number(value.toFixed(decimals));
  return `${Object.is(n, -0) ? 0 : n}${unit}`;
}

/** Pixels → ODF length string in the given unit. */
export function pxToLength(px, unit = 'cm', decimals = 4) {
  return formatLength(convert(px, 'px', unit), unit, decimals);
}

/** How lengths are shown in the UI: File ▸ Options ▸ Advanced ▸ measurement units. */
export const UNIT_DECIMALS = Object.freeze({ cm: 2, mm: 1, in: 2, pt: 1 });
export const UNIT_STEP = Object.freeze({ cm: 0.1, mm: 1, in: 0.05, pt: 1 });

/** "1.5 cm", "12pt", '2"' or a bare number (in `unit`) → value in `to`; null if not a length. */
export function parseUserLength(text, unit, to) {
  const m = String(text).trim().replace(',', '.').match(/^(-?\d*\.?\d+)\s*(cm|mm|pt|in|")?$/i);
  if (!m) return null;
  const u = m[2] === '"' ? 'in' : (m[2] || unit).toLowerCase();
  return convert(parseFloat(m[1]), u, to);
}
