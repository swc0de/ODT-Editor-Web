/**
 * Ribbon Cut / Copy / Paste. Keyboard shortcuts use the browser's native
 * clipboard events (handled by ProseMirror); the buttons go through
 * execCommand / the async Clipboard API, which may ask for permission.
 */
import { t } from '../i18n/index.js';

export function createClipboardActions(editor, toast) {
  const exec = (cmd, blockedKey) => {
    editor.focus();
    let ok = false;
    try { ok = document.execCommand(cmd); } catch { ok = false; }
    if (!ok) toast(t(blockedKey));
    return ok;
  };
  return {
    cut: () => exec('cut', 'file.copyBlocked'),
    copy: () => exec('copy', 'file.copyBlocked'),
    async paste() {
      editor.focus();
      try {
        if (navigator.clipboard?.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes('text/html')) { editor.view.pasteHTML(await (await item.getType('text/html')).text()); return true; }
          }
          for (const item of items) {
            if (item.types.includes('text/plain')) { editor.view.pasteText(await (await item.getType('text/plain')).text()); return true; }
          }
          return true;
        }
        if (navigator.clipboard?.readText) { editor.view.pasteText(await navigator.clipboard.readText()); return true; }
      } catch (e) {
        console.warn('Clipboard read failed:', e.message);
      }
      toast(t('file.pasteBlocked'));
      return false;
    },
  };
}
