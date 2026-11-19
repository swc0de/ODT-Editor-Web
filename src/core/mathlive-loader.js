/** Loads the equation editor engine (MathLive) from the chunk embedded in the page. */
let loading = null;

export function loadMathLive() {
  loading ??= (async () => {
    const el = document.getElementById('odt-mathlive');
    const b64 = el?.textContent.trim();
    if (!b64 || b64.startsWith('%%')) throw new Error('The equation editor is not included in this build.');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    try { return await import(/* webpackIgnore: true */ url); } finally { URL.revokeObjectURL(url); }
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
