# ODT Editor

A full word processor for **OpenDocument Text (.odt)** that runs entirely in your
browser from **one self-contained HTML file**: `dist/odt-editor.html`.
No server, no uploads, no analytics — open the file (even from `file://`, even
offline) and everything happens locally.

> **Status: milestone M4 (Home tab).** Open .odt/.ott files and edit them on
> real pages with the whole Home tab: character and paragraph formatting and
> their dialogs, lists, styles and the Styles pane, find and replace, Format
> Painter, paste options, AutoCorrect, the mini-toolbar and context menu —
> plus live rulers, zoom and an autosaving, crash-safe save/open workflow.
> Other ribbon tabs arrive in later milestones — see [MILESTONES.md](MILESTONES.md)
> and [PROGRESS.md](PROGRESS.md). Controls for features that aren't built yet
> are dimmed with a "Coming soon" tooltip.

## Working with files

- **Open**: Ctrl+O, drag an `.odt` onto the window, or File ▸ Open / Recent.
  Opening a template (`.ott`) starts a new document from it.
- **Save**: Ctrl+S. In Chromium-based browsers (Chrome, Edge) the file you
  opened is updated in place; elsewhere the document is downloaded.
  Save As: F12 or File ▸ Save As.
- **Never lose work**: the document is autosaved in this browser every 30
  seconds and whenever you switch away; File ▸ Recover brings back anything
  that wasn't saved. You are asked before unsaved changes are discarded.
- **Fidelity**: anything the editor doesn't understand yet (tables of
  contents, text boxes, tracked changes, unknown elements…) is kept and
  written back unchanged.

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
npm test             # unit tests (node:test) + e2e tests (Playwright, Chromium), incl. round-trips
npm run fixtures     # regenerate tests/fixtures/*.odt (+ LibreOffice exports if soffice exists)
npm run screenshots  # compare against reference/*.png → reference/compare/
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
  core/                command registry, settings, schema, editor, session (open/save/autosave),
                       storage (IndexedDB), clipboard; odt/ = import, export, styles, CSS, package
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

## Keyboard

- **Alt** (or F10): KeyTips — letters over tabs, then over the active tab's controls. Esc goes back.
- **Alt+Q**: search every command.
- **Ctrl+F1**: collapse/expand the ribbon (or double-click a tab).
- **F6 / Shift+F6**: move between the tab bar, ribbon, document and status bar.
- Arrow keys move between tabs and between ribbon controls; menus support ↑ ↓ → ← Home End and type-ahead.

## Print Layout

- Pages, headers/footers and page numbers follow the document's page styles.
- Rulers: drag the margins, the indent markers and tab stops; click the ruler
  to add a tab stop of the type shown in the corner selector.
- Zoom: Ctrl+wheel, the status bar slider, View ▸ Zoom (or One Page / Page
  Width / Multiple Pages). View ▸ Side to Side lays pages out horizontally.

## Home tab

- Formatting: Ctrl+B/I/U, Ctrl+= / Ctrl+Shift+= (sub/superscript), Ctrl+] / Ctrl+[
  (font size), Shift+F3 (change case), Ctrl+Space (clear character formatting),
  Ctrl+D (Font dialog), Ctrl+L/E/R/J (align), Ctrl+1/2/5 (line spacing),
  Ctrl+M / Ctrl+Shift+M (indent), Ctrl+Q (clear paragraph formatting),
  Ctrl+Shift+8 (Show ¶), Ctrl+Shift+C (Format Painter; double-click the button
  to lock it), F4 (repeat).
- Styles: Ctrl+Shift+N (Normal), Ctrl+Alt+1/2/3 (headings), Ctrl+Alt+Shift+S
  (Styles pane). Styles you create or modify are saved as ODF styles.
- Lists: type `* `, `- `, `1. ` or `a) ` to start a list; Tab / Shift+Tab
  change the level; Enter on an empty item ends the list.
- Find: Ctrl+F (Navigation pane), Ctrl+H (Find and Replace with match case,
  whole words, wildcards, regular expressions and formatting), Ctrl+G (Go To).
- F8 extends the selection; Shift+F5 goes back to where you last edited.
- Dictate uses the browser's speech recognition where available.

## Known limitations (M4)

- Coming soon on the Home tab: the Clipboard pane, Phonetic Guide, Enclose
  Characters, Glow, the Editor (spelling) pane.
- Headers and footers are shown but not editable yet (M5); all pages use the
  first page style's width; page-level columns and footnotes at the page
  bottom aren't laid out yet; table header rows aren't repeated (M6).
- Footnotes, comments, text boxes, tables of contents and tracked changes are
  kept and displayed but not editable yet.
- Content inside merged-away table cells (rare) is not kept.
- Password-protected ODT files can't be opened.
- Backstage Info, Print, Export and Options are placeholders.
