# Progress

The memory between sessions. Statuses: `todo`, `in progress`, `awaiting approval`, `approved`.

| Milestone | Status |
|---|---|
| M0 — Scaffold, build, test harness | approved |
| M1 — App shell and complete ribbon UI (visual match) | approved |
| M2 — Document model and ODT open/save | awaiting approval |
| M3 — Print Layout: pagination, rulers, status bar, zoom | todo |
| M4 — Home tab: character and paragraph formatting, styles, lists, find | todo |
| M5 — Layout and Design tabs, headers/footers, sections | todo |
| M6 — Tables | todo |
| M7 — Insert tab: pictures, shapes, text boxes, links, symbols | todo |
| M8 — References | todo |
| M9 — Review: comments, track changes, proofing | todo |
| M10 — Draw tab | todo |
| M11 — Mailings and Developer | todo |
| M12 — View tab and windows | todo |
| M13 — Import/export, Options, polish and final audit | todo |

## Environment

- Node 22, npm 10. Playwright 1.63 with the preinstalled Chromium (`@playwright/test` pinned to the same version).
- **LibreOffice: installed** — `soffice` = LibreOffice 24.2.7.2 (detected by `tests/make-fixtures.mjs`). Used to produce genuine LibreOffice-written fixtures (`tests/fixtures/lo-*.odt`) and, with `--check`, to verify every fixture opens. The lo-*.odt files are committed so tests also run without LibreOffice.
- **Reference screenshots** (supplied during M1, saved with descriptive names): `home-document-dark.png` (2552×1331), `backstage-home-dark.png` (2554×1370), and ribbon crops `ribbon-insert-dark.png`, `ribbon-draw-dark.png`, `ribbon-layout-dark.png`, `ribbon-view-dark.png`. All dark theme, 1:1 pixel scale. No light-theme references yet.

## M0 — Scaffold, build, test harness (approved)

Built:
- npm project: esbuild, ProseMirror packages, fflate, lucide (icons), Playwright.
- `npm run build` → one file, `dist/odt-editor.html` (~3.4 MiB, of which ~3.3 MiB is the five embedded font families). JS, CSS, fonts (base64 WOFF2), icons and favicon all inlined. The build fails if any remote resource is referenced; a strict CSP blocks network access at runtime.
- `src/` structure per CLAUDE.md: `core/` (command registry, settings), `layout/` (units, fonts), `ui/` (theme, icons, logo), `features/<12 tabs>/`, `i18n/` (en-GB), `styles/` (tokens for dark + light, shell CSS), `config.js` (app name defined once; build reads it for `<title>`).
- Command registry with shortcut normalisation (Mod = Ctrl/⌘, physical-key matching for shifted characters), enabled/checked state, "Coming soon" for commands without `run()`, ranked search for Alt+Q, change notifications.
- i18n `t()` with interpolation, Intl plural rules, locale fallback to en-GB.
- Fixtures (`npm run fixtures`): formatting zoo, styles hierarchy, lists, tables (merged cells, nested, header rows), images (PNG/SVG, inline/floating/captioned), headers/footers (first/left/right, page X of Y), footnotes/endnotes, TOC, comments, tracked changes, sections/columns/master pages, bookmarks & fields, 50- and 100-page documents (51/101 pages in LibreOffice), an .ott template, plus 10 LibreOffice-written `lo-*.odt` files.
- Tests: 34 unit tests (registry, i18n, units, every fixture's package structure: mimetype first/stored/no extra field, manifest complete, XML well-formed) and 7 Playwright e2e tests (no console errors, zero network requests, works offline, title = app name, fonts load, theme switching persists, registry/i18n wired, A4 page size).
- Screenshots: `reference/compare/m0-dark.png`, `m0-light.png` (1600×900).

Decisions:
- **Fonts are embedded unmodified** (lossless TTF→WOFF2, no subsetting). Carlito and Liberation have OFL Reserved Font Names; subsetting would make a "Modified Version" that may not keep those names. Cost: larger file (~3.3 MiB of fonts).
- `dist/odt-editor.html` is committed so it can be downloaded and opened without building.
- Default comparison viewport: 1600×900 (will switch to the reference screenshots' size once supplied).
- Command ids are dotted (`theme.light`, later `home.bold`, …); labels are i18n keys.
- `window.odtEditor` exposes the registry for tests and debugging.

Known issues / not applicable yet:
- No reference screenshots to compare against.
- Typing-latency performance check is not applicable until editing exists (M2/M3); the 50/100-page fixtures are ready for it.

## M1 — App shell and complete ribbon UI (approved)

Built:
- Tab bar with all 13 tabs in screenshot order (**Zotero** added because the screenshots show it), accent text + underline on the active tab, Comments / Editing ▾ / Share on the right.
- Ribbon framework (`src/ui/ribbon/`): groups with centred labels, dividers, dialog launchers; large, small, icon-only, split (large and small), toggle, combo, select, spin, checkbox and gallery controls; dropdown menus with submenus, headers and widgets (colour palettes, table grid picker, symbol grid, shapes, list libraries); hover / pressed / checked / disabled states; collapse with Ctrl+F1 or double-clicking a tab (clicking a tab then "peeks"); responsive collapsing of right-most groups into dropdown buttons; KeyTips (Alt or F10; prefix-free letters per tab); arrow-key navigation; F6 region cycling.
- Every tab populated from `src/features/<tab>/index.js`, each control bound to a command id (~430 commands). Unbuilt commands are dimmed with a "Coming soon" tooltip and toast; their menus still open so the UI can be explored. Contextual commands (Arrange group, Cut, View Side by Side) are dimmed until applicable.
- Working now: tab switching, Backstage navigation, Interface Theme (Dark/Light/System), Editing mode menu, Draw ▸ Select, View ▸ Print Layout / Vertical, ribbon collapse, Alt+Q search, KeyTips, status-bar customisation (right-click, remembered).
- Static horizontal and vertical rulers aligned to the page (numbers only in the text area, margins shaded, indent markers, tab selector cycling its 7 types), canvas, A4 page, status bar (Page 1 of 1, 0 words, English (United Kingdom), Focus, Read/Print/Web, zoom − slider + 100%).
- Backstage: indigo nav with ‹ back, Home/New/Open/Info/Recover/Save/Save As/Print/Export/Close/Options and About at the bottom; Home page with time-based greeting, four real rendered template previews (original sample content), More templates →, Recent empty state. Other pages are placeholders naming their milestone. Esc / ‹ return.
- Alt+Q command search: every non-hidden command with its ribbon location and shortcut; Enter runs it.
- i18n: all strings in `src/i18n/en-GB/*.js` (app, commands, ribbon, ui).
- Tests: 41 unit (registry, i18n, units, fixtures, ribbon definitions: every reference resolves, every icon and label exists, KeyTips prefix-free) + 22 e2e (tabs, every panel's controls bound, Home groups, coming-soon tooltip/toast, collapse/peek, responsive collapse, menus + keyboard, table grid, KeyTips, Alt+Q, Backstage, status bar customisation, rulers, F6, Ctrl+S default suppressed; no console errors or network requests).
- Comparisons: `node tests/screenshots.mjs` → `reference/compare/<name>-compare.png` (reference / ours with coming-soon controls at full strength / ours as shipped) and `<name>-light.png`.

Decisions (screenshot vs brief):
- Colours sampled from the screenshots: accent `#7a93f0`, Share = accent fill with dark text `#11162e` (brief said deeper blue `#5b6ee1`), ribbon `#292929`, checked `#2e3a66`/`#5467ab`, gallery tiles `#c8c8c8`, Backstage nav `#27315c` / active `#4e5679`.
- The Backstage screenshot shows a "Discord community" link; it is **left out** because the brief explicitly forbids it.
- The font combo shows "Aptos" with the ⚠ badge (as in the screenshot) because Aptos isn't bundled; documents render with Carlito in its place.
- The row-1 Font icon after Clear Formatting is Phonetic Guide (ODT ruby); the brief's "Text Effects icon" is the row-2 A ▾.
- Comments/Editing/Share keep full brightness (as in the screenshot) even though Comments and Share's items are coming soon; their tooltips say so.
- Tab content for Design, References, Mailings, Review, Developer, Zotero and Help follows the brief (no screenshots of them).

Unresolved differences from the screenshots:
- The reference renders text in Segoe UI on Windows; here the UI font falls back to Inter/Noto, so text is ~2–4% wider and some groups sit a few pixels off.
- Icons are original Lucide-style line icons, so their shapes differ from the reference's.
- Most controls are dimmed ("Coming soon") whereas the reference shows them active; the middle row of each comparison shows the layout without dimming.
- The zoom slider and rulers are static until M3.

Performance: typing latency is still not applicable (no editor until M2).

## M2 — Document model and ODT open/save (awaiting approval)

Built:
- **Schema** (`src/core/schema.js`): paragraph, heading, list/list_item (incl. list headers), table/row/cell (merged cells, nested), section, frame (images, text boxes, objects), note, annotation (+ end), bookmark (bookmarks and reference marks), field (any text field: element + attributes + text), change_marker, tab, hard_break, and **opaque_block / opaque_inline** holding verbatim XML for anything else (TOCs until M8, ruby, shapes, unknown elements). Marks: link, charStyle (named character style), textProps (direct formatting).
- **Formatting model mirrors ODF**: blocks keep their named style plus `auto` (the content of an automatic style: style attributes + `*-properties`); text keeps `charStyle` + `textProps`. Nested spans are flattened by merging properties. Note and comment bodies are stored as nested block JSON.
- **Import** (`src/core/odt/import.js`): content/styles/meta/settings; style hierarchy and automatic styles; ODF white-space rules (collapsing, text:s, leading space); repeated rows/cells expanded; covered cells regenerated from spans; pictures and every other package file kept; unknown namespaces kept; encrypted packages refused with a clear message.
- **Export** (`src/core/odt/export.js`): ODF 1.3 package, `mimetype` first/stored/no extra field, manifest of every entry (plus kept directory entries), automatic styles generated from the model and **de-duplicated by content**, kept automatic styles written only if still referenced, generated names never clash, unreferenced pictures dropped, `xml:id`s de-duplicated, missing built-in styles (e.g. List Bullet after a paste) added, meta.xml with generator/date/editing cycles/statistics, Thumbnails/thumbnail.png (canvas rendering of the first page).
- **Rendering**: generated stylesheet for named paragraph/character/list/table/cell/section styles (`src/core/odt/styles.js`, `css.js`); page size and margins from the default master page; images via blob URLs with float/centre placement; fields shaded; notes as superscript citations; comment anchors; page-break markers; preserved content shown as labelled read-only boxes.
- **Editing** (`src/core/editor.js`): ProseMirror with history (500 ms grouping), Enter / Shift+Enter (line break) / Tab (tab), heading → Normal on Enter, IME, drop cursor/gap cursor. **Paste**: own content is lossless (data attributes); HTML from other apps (Word, LibreOffice, browsers) is cleaned and mapped — b/i/u/s/sub/sup, `<font>`, inline styles (weight, style, decoration, colour, background, size, family), headings, lists, tables, data: images (stored in Pictures/); Word Mso classes → Title/Subtitle/Quote/No Spacing; pasting into an empty paragraph keeps the pasted paragraph's style; Ctrl+Shift+V plain text. Ribbon Cut/Copy/Paste/Select All work (Clipboard API where permitted).
- **Files** (`src/core/session.js`): New (Ctrl+N, templates from the Backstage become real documents), Open (Ctrl+O via File System Access picker or `<input type=file>`, drag & drop, Backstage Open/Recent), Save (Ctrl+S: write-back to the opened file where the File System Access API is available, otherwise download), Save As (F12, Backstage page), Download a copy (Share ▾), Close; `.ott` opens as a new untitled document; dirty indicator "● " in the window title; Recent (IndexedDB) with pin/remove and stored copies for reopening.
- **Never lose work**: autosave to IndexedDB every 30 s, on window blur and when the tab is hidden; Backstage ▸ Recover lists and restores autosaved documents (toast on startup when any exist); Save/Don't Save/Cancel prompt before New/Open/Close; beforeunload guard.
- Status bar word count is live.
- Tests: 41 unit + 67 e2e. Round-trip for all 25 fixtures (open → save via the real session path → re-open: identical body, styles, master pages, prelude, files), package rules checked on every saved file, **LibreOffice reads identical text from our saved files and the originals** (24.2.7.2), editing/IME/paste (HTML, Word, LibreOffice, plain, internal), files (open, save, reopen, Save As, New guard, Recent + pin, templates, drag & drop, autosave + Recover after reload, beforeunload, bad file), performance.
- **Performance**: typing on the 50-page fixture — main-thread work per keystroke median ≈2 ms (p95 ≈3 ms); ≤ 2 of 40 keystrokes miss the next frame. (Event Timing durations are one frame, 16 ms, the minimum at 60 Hz.) The perf test runs as its own Playwright project after the others.

Decisions:
- Notes/comments bodies, text boxes, TOCs and shapes are preserved and displayed but not editable until their milestones (M7–M9).
- The rulers redraw only when geometry changes; in this continuous view the vertical ruler covers one page height (each page gets its own in M3).
- Test runs pass settings defaults through `window.__ODT_TEST_DEFAULTS__` (no native pickers): seeding localStorage from a Playwright init script races with Chromium's storage on reload and loses writes. The app itself keeps settings reliably.
- Fixture generator now declares the ooo/ooow namespaces (the hidden-text condition used an undeclared prefix, which made LibreOffice read the original differently).

Known limitations:
- Continuous view only: no page breaks between pages, headers/footers not shown yet (all kept in the file) — M3/M5.
- List numbering: restart/continue across separate lists isn't rendered yet (kept in the file) — M4.
- Content inside covered (merged-away) table cells, which is rare, is not kept; repeated rows/cells are written out individually.
- Image effects (opacity, crop, rotation) aren't rendered yet — M7.
- Tracked changes are kept but not shown — M9.
- A word-count field shows our statistic, which can differ from LibreOffice's by about 1 word.
- Native Save pickers (File System Access) only exist in Chromium-based browsers; elsewhere saving downloads the file. These pickers can't be exercised in automated tests.
