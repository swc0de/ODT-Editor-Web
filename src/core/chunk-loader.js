/**
 * Loads a code chunk embedded in the page as base64 text
 * (<script type="text/plain" id="odt-…">) through a blob: URL import.
 */
const loading = new Map();

export function loadChunk(id, missing = 'This feature is not included in this build.') {
  if (!loading.has(id)) {
    const p = (async () => {
      const el = document.getElementById(id);
      const b64 = el?.textContent.trim();
      if (!b64 || b64.startsWith('%%')) throw new Error(missing);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
      try { return await import(/* webpackIgnore: true */ url); } finally { URL.revokeObjectURL(url); }
    })();
    p.catch(() => loading.delete(id));
    loading.set(id, p);
  }
  return loading.get(id);
}
