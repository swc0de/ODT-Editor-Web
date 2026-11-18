# ODT Editor

A full word processor for **OpenDocument Text (.odt)** that runs entirely in your
browser from **one self-contained HTML file**: `dist/odt-editor.html`.
No server, no uploads, no analytics — open the file (even from `file://`, even
offline) and everything happens locally.

> **Status: milestone M0 (scaffold).** The build, the test harness, theme
> tokens, the command registry and i18n are in place, and the app shows a blank
> A4 page. The ribbon UI, editing and ODT open/save arrive in the next
> milestones — see [MILESTONES.md](MILESTONES.md) and [PROGRESS.md](PROGRESS.md).

## Using it

Open `dist/odt-editor.html` in a current Chromium-based browser, Firefox or
Safari. That's it. The file has every script, stylesheet, icon and font inlined,
and a Content-Security-Policy that blocks all network access, so it cannot
phone home.

## Development

Requirements: Node.js 20+ (22 recommended). Playwright's Chromium is needed for
the e2e tests; LibreOffice (`soffice`) is optional and used for extra
interoperability checks.

```bash
npm install
npm run build        # → dist/odt-editor.html (minified, everything inlined)
npm run watch        # rebuild on change (unminified, inline source maps)
npm test             # unit tests (node:test) + e2e tests (Playwright, Chromium)
npm run fixtures     # regenerate tests/fixtures/*.odt (+ LibreOffice exports if soffice exists)
npm run screenshots  # capture dark/light screenshots into reference/compare/
```

`node tests/make-fixtures.mjs --check` additionally verifies that LibreOffice
opens every fixture.

### Project layout

```
build.mjs              esbuild bundling + inlining into one HTML file
src/
  index.html           page template (CSP, inline CSS/JS/fonts slots)
  config.js            app name, version, defaults — the name lives only here
  main.js              entry point
  core/                command registry, settings; later: schema, ODT I/O, styles, autosave
  layout/              units, fonts; later: pagination, rulers, measurement
  ui/                  theme, icons, logo; later: ribbon, backstage, dialogs, panes, status bar
  features/<tab>/      one folder per ribbon tab (file, home, insert, draw, design, layout,
                       references, mailings, review, view, developer, help)
  i18n/                all user-facing strings (English (UK) default)
  styles/              theme tokens (dark + light) and component CSS
assets/fonts/          bundled fonts as WOFF2 (+ LICENSE.md)
tests/
  make-fixtures.mjs    generates the ODT fixtures
  fixtures/            generated fixtures + LibreOffice-written lo-*.odt files
  unit/                node:test unit tests
  e2e/                 Playwright tests against dist/odt-editor.html
reference/             UI reference screenshots; compare/ holds generated comparisons
```

### Architecture notes

- **Commands.** Every action is a command (`id`, label, icon, shortcut,
  enabled/checked state, `run()`) in `src/core/command-registry.js`. The ribbon,
  menus, keyboard shortcuts, the Alt+Q search box and the tests all go through
  it. A command registered without `run()` is shown disabled as "Coming soon".
- **Themes.** All colours are CSS custom properties in `src/styles/tokens.css`,
  switched via `<html data-theme="dark|light">` (dark by default, or follow the
  system).
- **Strings.** All user-facing text goes through `t()` in `src/i18n/`.
- **Offline guarantee.** The build fails if the output references any remote
  resource, the page's CSP blocks network requests, and an e2e test asserts
  that loading the app makes zero network requests.
- **Editing core (from M2):** ProseMirror with a schema mapped 1:1 to ODT
  concepts; zip I/O with fflate; a pagination layer for Print Layout (M3).

## Licences

- App code: MIT.
- Bundled fonts: Carlito, Caladea, Liberation Sans/Serif/Mono — SIL Open Font
  License 1.1 (see `assets/fonts/LICENSE.md`).
- Libraries bundled into the HTML file: ProseMirror (MIT), fflate (MIT),
  Lucide icons (ISC).

UI inspired by the open-source WordCraft project (MIT/Apache-2.0).

## Known limitations (M0)

- Only the scaffold exists: no ribbon, no editing, no open/save yet.
- No reference screenshots have been supplied yet, so visual comparison is
  limited to the generated dark/light captures in `reference/compare/`.
