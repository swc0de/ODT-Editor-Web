/**
 * Icons: original line icons in the Lucide style. Icon nodes from the
 * `lucide` package (ISC) are tree-shaken by esbuild, so only the icons that
 * are imported here end up in the bundle. App-specific icons can be added to
 * CUSTOM as [tag, attrs] node lists in the same 24×24 stroke format.
 */
import { FileText, Moon, Sun, Pilcrow } from 'lucide';
import { LOGO_SVG } from './logo.js';

const ICONS = {
  'file-text': FileText,
  moon: Moon,
  sun: Sun,
  pilcrow: Pilcrow,
};

const CUSTOM = {};

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Returns an inline SVG string for an icon name ('' if unknown). */
export function iconSvg(name, { size = 16, strokeWidth = 1.6, className = '' } = {}) {
  if (name === 'logo') return LOGO_SVG;
  const node = ICONS[name] || CUSTOM[name];
  if (!node) return '';
  const children = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="icon ${esc(className)}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`
  );
}

export function registerIcon(name, node) { CUSTOM[name] = node; }
export const hasIcon = (name) => name === 'logo' || name in ICONS || name in CUSTOM;
