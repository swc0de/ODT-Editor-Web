# Progress

The memory between sessions. Statuses: `todo`, `in progress`, `awaiting approval`, `approved`.

| Milestone | Status |
|---|---|
| M0 — Scaffold, build, test harness | approved |
| M1 — App shell and complete ribbon UI (visual match) | approved |
| M2 — Document model and ODT open/save | approved |
| M3 — Print Layout: pagination, rulers, status bar, zoom | approved |
| M4 — Home tab: character and paragraph formatting, styles, lists, find | approved |
| M5 — Layout and Design tabs, headers/footers, sections | approved |
| M6 — Tables | approved |
| M7 — Insert tab: pictures, shapes, text boxes, links, symbols | approved |
| M8 — References | approved |
| M9 — Review: comments, track changes, proofing | approved |
| M10 — Draw tab | approved |
| M11 — Mailings and Developer | approved |
| M12 — View tab and windows | awaiting approval |
| M13 — Import/export, Options, polish and final audit | todo |

## Environment

- Node 22, npm 10. Playwright 1.63 with the preinstalled Chromium (`@playwright/test` pinned to the same version).
- **LibreOffice: installed** — `soffice` = LibreOffice 24.2.7.2 (detected by `tests/make-fixtures.mjs`). Used to produce genuine LibreOffice-written fixtures (`tests/fixtures/lo-*.odt`) and, with `--check`, to verify every fixture opens. The lo-*.odt files are committed so tests also run without LibreOffice.
- **LibreOffice Math** (`libreoffice-math`) was added in M7 (`apt-get install libreoffice-math`) so LibreOffice can draw and re-save equations in the round-trip checks; without it LibreOffice shows formula objects as placeholders. Tests don't depend on it being present.
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

## M2 — Document model and ODT open/save (approved)

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
- List numbering: restart/continue across separate lists isn't rendered yet (kept in the file) — M4 (done in M4).
- Content inside covered (merged-away) table cells, which is rare, is not kept; repeated rows/cells are written out individually.
- Image effects (opacity, crop, rotation) aren't rendered yet — M7.
- Tracked changes are kept but not shown — M9.
- A word-count field shows our statistic, which can differ from LibreOffice's by about 1 word.
- Native Save pickers (File System Access) only exist in Chromium-based browsers; elsewhere saving downloads the file. These pickers can't be exercised in automated tests.

## M3 — Print Layout: pagination, rulers, status bar, zoom (approved)

Built:
- **Pagination** (`src/layout/paginator.js`) over the single ProseMirror flow: page backgrounds are drawn behind the editor (`page-view.js`) and gaps are inserted as decorations — a block widget before a block that moves to the next page, a line-start widget that splits a paragraph, and translateY row shifts (+ spacer) that split a table between rows (split tables switch to separate borders so cell borders move with their rows). Honours page size/margins from the master page's page layout, header/footer heights and spacing, widows/orphans (default 2), keep-together, keep-with-next, break-before/after page, master-page switches and page-number restarts.
- **Incremental**: measurements are in "natural" coordinates (DOM position minus the gaps above). A re-layout restarts at the last clean page start before the edit and stops as soon as a page boundary coincides with the previous layout (gaps and page starts are mapped through every transaction in the plugin state). Long re-layouts are processed in 6 ms slices across frames; while typing, repagination waits for a 100 ms pause (like Word's background pagination).
- **Headers and footers** (read-only until M5) rendered on every page from the master page — first / left / right variants, page-number and page-count fields filled in per page.
- **Live rulers** (`ruler.js`): horizontal ruler numbered from the margin with shaded margins; drag the margin edges (page layout margins), the first-line / hanging / left / right indent markers (paragraph indents, undoable), tab stops (click to add the selector's type — left, centre, right, decimal; drag to move; drag off to remove). Tab selector also places first-line / hanging indents. Vertical ruler follows the caret's page with draggable top/bottom margins. A dashed guide line follows drags; Alt disables the 0.25 cm snap.
- **Tab stops** (`tabs.js`): tabs render at the paragraph's real stops (left/centre/right/decimal, relative to the indent, default interval after the last stop) with dotted/dashed/solid leaders.
- **Status bar**: Page X of Y (caret page), live word count, language, Print Layout button, zoom slider (drag/click/arrow keys, snaps to 100 %), − / + and the zoom % (opens the Zoom dialog).
- **View tab**: Zoom dialog (200/100/75 %, page width, text width, whole page, many pages, percent), 100 %, Zoom In/Out, One Page, Multiple Pages, Page Width, Ctrl+wheel; Page Movement Vertical / Side to Side (Side to Side uses CSS columns of the body height, one per page); Show: Ruler, Gridlines (0.5 cm grid on page bodies), Hide White Space. Zoom and ruler visibility are remembered.
- Tests: 41 unit + 80 e2e (13 new pagination/zoom/ruler tests: 50-page doc with every line inside a page body, headers/footers per page with page X of Y, page breaks at the body top, keep-with-next across a 100-page doc, widows/orphans ≥ 2 lines, table split between rows, **incremental layout after edits equals a full re-layout**, status bar page numbers, zoom via wheel/buttons/slider/dialog/page width, Side to Side, Ruler/Gridlines/Hide White Space, indent drag + undo, tab stop add/align/remove, margin drag).
- **Performance**: 50 pages — main-thread ≈3 ms per keystroke; 100 pages — ≈4 ms (start and middle), no long tasks, scrolling the whole document at 60 fps (p95 16.7 ms frames). Page counts: 50 / 100 for the long fixtures (LibreOffice: 51 / 101).

Decisions:
- A block moved to the top of a page drops its space-before (as Word does).
- The perf test allows up to 6 of 40 keystrokes to miss the next frame: headless Chromium's software rendering varies from run to run, while the main-thread time (the latency requirement) stays at 3–6 ms.
- Ruler margin drags change the page style directly; they are not in the editor's undo history yet (M5 brings page setup with undo).
- ODF has no "bar" tab, so the tab selector offers left, centre, right, decimal, first-line indent and hanging indent.

Known limitations:
- All pages use the first master page's width and left/right margins; a master page with a different width (e.g. landscape) changes height, top/bottom margins and headers/footers only (M5).
- Page-level columns (in the page layout) aren't laid out yet; multi-column sections are kept on one page rather than split (M5).
- Table header rows aren't repeated on following pages yet; a row taller than a page isn't split (M6).
- Footnotes aren't placed at the page bottom yet (M8).
- In a justified paragraph split across pages, the last line before the break isn't justified.
- Side to Side uses one page size for all pages and the browser's own fragmentation.
- Read Mode / Web Layout / Focus buttons and the Language dialog remain "Coming soon" (M12 / M9).

## M4 — Home tab: character and paragraph formatting, styles, lists, find (approved)

Built:
- **Character formatting** (`core/commands/text.js`): every Font-group control works on all selection ranges (and on the stored marks for the next typed text). Font name/size combos follow the selection (the font list includes the bundled fonts; choosing a font adds its `style:font-face`), Grow/Shrink (Ctrl+] / Ctrl+[), Change Case ▾ (+ Shift+F3 cycling), Clear All Formatting, Bold/Italic/Underline (+ double/thick/dotted/dashed/wave, underline colour), Strikethrough, Sub/Superscript (Ctrl+= / Ctrl+Shift+=), Character Border, Text Effects ▾ Outline/Shadow, Highlight and Font Colour palettes (the split button repeats the last colour), Ctrl+Space clears character formatting. Direct formatting is stored as ODF text properties; values equal to the style's (or the initial value) are dropped, so turning bold off removes the property.
- **Font dialog** (Ctrl+D / launcher): font, style, size, colour, underline style + colour, strikethrough / double, super/subscript, small caps, all caps, hidden, outline, shadow; Advanced: scale, character spacing (expanded/condensed by), raised/lowered position, kerning; live preview.
- **Paragraph formatting** (`core/commands/paragraph.js`): align (Ctrl+L/E/R/J, toggling back to left), LTR/RTL, line spacing presets (Ctrl+1/2/5) and Add/Remove space, Shading palette, Borders ▾ (bottom/top/left/right/none/all/outside, horizontal line), Increase/Decrease indent (Ctrl+M / Ctrl+Shift+M; changes the list level inside lists), Sort, Ctrl+Q. **Paragraph dialog**: alignment, direction, indents (left/right/first line/hanging), spacing before/after, line spacing (single/1.5/double/at least/exactly/multiple), widow/orphan control, keep with next, keep lines together, page break before; **Tabs dialog** (positions, alignment, dot/dash/line leaders, clear/clear all); **Borders and Shading** dialog (box/custom sides, style, width, colour, fill; paragraph or text).
- **Show ¶** (Ctrl+Shift+8): pilcrows, space dots, tab arrows and hidden text (hidden text is otherwise hidden, as in Word).
- **Lists** (`core/commands/lists.js`): Bullets / Numbering / Multilevel galleries (6 presets each, de-duplicated automatic list styles L1, L2…), Define New Bullet / Number Format / Multilevel List, Set Numbering Value, Restart at 1 and Continue Numbering (context menu), Tab / Shift+Tab level changes, Enter on an empty item or Backspace at the start leaves the list. Labels are computed by a plugin from the ODF list styles (levels, prefixes/suffixes, display-levels, start values, continue-numbering, continue-list, list headers).
- **Styles**: the gallery is live (selection shows the current style; samples use the document's style colours/fonts), applies paragraph styles (headings become `text:h` with their outline level) and character styles; Ctrl+Shift+N, Ctrl+Alt+1/2/3; Create a Style, Clear Formatting, Apply Styles…. **Styles pane** (launcher, Ctrl+Alt+Shift+S): every paragraph/character style, show preview, only styles in use, and per style Update to Match Selection, Modify… (name, based on, next style, bold/italic/underline, Font… and Paragraph… dialogs), Delete (text goes back to the parent style); New Style…, Clear All. Changes are written to `office:styles` with inheritance (parent-style-name) and next-style kept as ODF; missing built-in styles are added on first use.
- **Find** (Ctrl+F): Navigation pane (left dock, resizable) with Headings / Pages / Results tabs, live highlights, result snippets, previous/next, options (match case, whole words, wildcards, regex). **Find and Replace** (Ctrl+H, modeless, draggable): match case, whole words, Word-style wildcards (? * [ ] [! ] < > @ {n,m}), regular expressions with $1 groups, find formatting and replace formatting, Replace / Replace All (one undo step). **Go To** (Ctrl+G): page (absolute or ±), heading, bookmark.
- **Select ▾**: Select All, Select Objects (cycles frames), Select Text with Similar Formatting (a real multi-range selection; formatting commands apply to every range).
- **Clipboard**: Paste ▾ Keep Source Formatting / Merge Formatting / Keep Text Only, Paste Special…, Set Default Paste… (within the document / from other programs), a floating Paste Options button after every paste that re-pastes the same content in another mode. **Format Painter** (Ctrl+Shift+C): click to apply once, double-click to lock, Esc to stop; copies paragraph formatting when the source is a caret or whole paragraphs.
- **AutoCorrect** as you type (`core/editing-plugins.js`): smart quotes, `--` / spaced ` - ` → en dash, `---` → em dash, `...` → …, (c) (r) (tm), -> <-, `* ` / `- ` bullets, `1. ` `a) ` `i. ` numbering, capitalise the first letter of sentences; Backspace right after a correction undoes it.
- **Mini-toolbar** on mouse selections (font, size, grow/shrink, clear, B I U, highlight, colour, bullets, numbering, painter, styles; fades with distance) and a **context menu** (cut/copy/paste options, Font…, Paragraph…, list numbering items, Find, link, comment).
- **Dictate** (Web Speech API, en-GB, spoken punctuation); disabled where unsupported.
- Shortcuts from the brief: F4 repeats the last formatting command, F8 extends the selection (word → sentence → paragraph → document), Shift+F5 returns to previous edit locations. App shortcuts now run before ProseMirror's own key handling in the document.
- Tests: 50 unit + 93 e2e (12 new Home tests). The formatting round-trip test applies every character and paragraph formatting type, saves, re-opens (identical model) and has LibreOffice convert the file to HTML to prove it reads bold, italic, super/subscript, colours, alignment, headings and lists. Lists and styles have their own round-trips (custom style with inheritance in styles.xml).
- Performance: 50 pages ≈2.7 ms per keystroke (main thread; 1–2 of 40 keystrokes miss a frame in headless Chromium), 100 pages ≈4 ms. The ribbon's state sync waits for a typing pause, and list labels / nested-list kinds are recomputed only when blocks change, not while typing inside a paragraph.
- Screenshots: `reference/compare/m4-*.png` (panes, Font/Paragraph dialogs, Replace, mini-toolbar, Bullets menu) in dark and light.

Decisions:
- Shift+F3 cycles lowercase → Capitalise Each Word → UPPERCASE → lowercase (Word's order).
- Clear All Formatting resets to Normal; Ctrl+Space clears character formatting only (as in Word).
- Built-in styles can't be deleted; a deleted custom style's paragraphs go to its parent.
- Nested lists without their own style follow the outer list's bullet/number kind (as the importer does).

Known limitations:
- Coming soon: Clipboard pane (launcher), Phonetic Guide, Enclose Characters, Text Effects ▸ Glow, Editor (spelling pane, M9), Layout ▸ Selection Pane (M5/M7).
- Paste Options: the floating button disappears at the next edit or selection change; Merge Formatting keeps bold/italic/underline and links only.
- The Find formatting filter offers bold, italic, underline, highlight and strikethrough (not arbitrary Font-dialog formatting).
- The Navigation pane's Pages tab shows page tiles, not live thumbnails.

## M5 — Layout and Design tabs, headers/footers, sections (approved)

Built:
- **Undoable document-wide changes** (`core/state-step.js`): a ProseMirror step that swaps DocumentState fields (page styles, page layouts, named styles, list styles, font faces, line numbering), so page setup, header/footer edits, style edits (M4's included) and ruler margin drags undo and redo with ordinary edits.
- **Page Setup** (`core/page-setup.js`, `features/layout`): Margins presets (Normal, Narrow, Moderate, Wide, Mirrored — measured to the body as in Word, converted to ODF page margins when there is a header/footer), Orientation, Size (A4, A5, A3, Letter, Legal, B5), Page Setup dialog (margins, mirror margins, paper size, custom size, header/footer distances, different first / odd & even, apply to this section or whole document). A page style shared by several sections is copied so only the current section changes.
- **Sections**: Breaks ▸ Next Page / Even Page / Odd Page create a new page style (master page) copied from the current one (`Section 2`…; even/odd use a left-/right-only page style that continues with a normal one, and a blank page is inserted when needed). Each section can have its own size, orientation, margins, headers and footers; pages of other widths (landscape) are centred, and their text is laid out at their own width (`layout/regions.js`). Continuous breaks start a `text:section`.
- **Columns** (One, Two, Three, Left, Right, More Columns… with spacing, line between, apply to selection / section / this point forward), saved as `text:section` column styles (page-level columns from LibreOffice files are laid out too). Multi-column text is split across pages with `column-span: all` spacers; each pass measures where the browser actually put them and corrects the split (`paginator.js` layoutRegion), so every line stays inside a page body.
- **Breaks**: Page (also Ctrl+Enter), Column, Text Wrapping (`loext:clear`).
- **Line Numbers**: None, Continuous, Restart Each Page, Restart Each Section (`text:line-number` restarts), Suppress for Current Paragraph, options (start, distance from text, count by); numbers drawn in the margin after each layout.
- **Hyphenation**: None / Automatic / options (hyphenate capitals, consecutive hyphen limit); automatic hyphenation uses bundled en-GB Liang patterns (`hyphen`, ISC) as soft-hyphen widgets in paragraphs with `fo:hyphenate`.
- **Text Direction** for table cells (rotate 90° / 270°, `style:writing-mode`).
- **Layout ▸ Paragraph** spin boxes follow the selection and set indents/spacing (↑/↓ steps).
- **Headers and footers** (`ui/header-footer.js`, `core/hf-content.js`): double-click a header/footer area (or Insert ▸ Header ▸ Edit Header) to edit in place with a full editor (all Home formatting works there); the body dims and is read-only; Esc, Close Header and Footer or double-clicking the body returns. Changes are written to the page style (with automatic styles MP/MT in styles.xml, unused ones pruned) as undoable steps. Adding a header keeps the body where it was. Contextual **Header & Footer** tab: Header ▾ / Footer ▾ galleries (Blank, Three Columns, Title and Page Number, Simple Rule / Page Number Centred, Page X of Y), Page Number ▾, Date & Time, Document Info (author, file name, title, number of pages), Go to Header/Footer, Previous/Next section, Link to Previous, Different First Page, Different Odd & Even Pages, Show Document Text, Header/Footer distance spins, Close.
- **Page numbers**: Top / Bottom of Page (left, centre, right), Current Position (body page-number fields show their own page's number), Format Page Numbers (1, a, A, i, I; continue or start at N per section), Remove Page Numbers.
- **Design tab** (`features/design`): Themes (Classic, Harbour, Meadow, Ember, Ink, Dune: colours + font pairs), Style Sets (Default, Basic, Elegant, Formal, Lines, Minimal, Shaded), Colours, Fonts, Paragraph Spacing (Default, No Paragraph Space, Compact, Tight, Open, Relaxed, Double), Set as Default (new documents use the styles), Watermark (CONFIDENTIAL, DO NOT COPY, DRAFT, SAMPLE, URGENT, ASAP, custom text/picture, remove — written as LibreOffice-style fontwork/picture in the header), Page Colour, Page Borders (box / shadow, style, width, colour).
- Ribbon: contextual tabs (hidden until active); a long-standing tooltip bug that printed "nullnull" is fixed.
- Tests: 50 unit + 102 e2e (9 new M5 tests). Each saves, re-opens (identical model) and, where it matters, has **LibreOffice open and re-save** our file to prove it keeps sections/columns, master pages, header text, page-number fields and watermarks. Performance: 50 pages ≈3.2 ms per keystroke main thread (4–5 of 40 keystrokes miss a frame in headless Chromium), 100 pages ≈4 ms.
- Screenshots: `reference/compare/m5-*.png` (columns menu, watermarked pages, header editing with the contextual tab, Page Setup, Design themes) in dark and light.

Decisions:
- Columns use `text:section` (Word's "section columns"); page-level columns already in a file are kept and laid out.
- Even/odd section breaks use a left-/right-only page style followed by a normal copy (so LibreOffice doesn't insert blank pages between every page of the section).
- Text Direction applies to table cells; rotated body text isn't offered.
- Watermark shapes are kept out of the header editor and re-attached when the header is saved. (An earlier version's fontwork path referenced undefined formula values and crashed LibreOffice; caught by the LibreOffice round-trip test and fixed.)
- Margin presets keep Word's meaning (distance to the body text) even with a header or footer.

Known limitations:
- Columns are laid out in the browser and balanced per page; a single paragraph taller than a column isn't split across pages inside a column region.
- Line numbers count body paragraphs only (not tables, text boxes or notes).
- Hyphenation patterns are British English only.
- Design ▸ Effects (shape effects) is "Coming soon" (M7). Insert ▸ Page Number ▸ Page Margins is "Coming soon" (needs frames, M7).
- Different first page / odd & even apply to the page style; "Link to Previous" copies the previous section's header/footer (ODF has no linking), and is checked while they are identical.
- Side to Side view still uses the first page style's size.

## M6 — Tables (approved)

Built:
- **Table model** (`core/odt/import.js`, `export.js`, `schema.js`): automatic table, column, row and cell styles become direct formatting on the nodes (`auto`); named styles stay named. On save they're regenerated and de-duplicated (`Tab1`, `TabCol1`, `TabRow1`, `TabCell1`); merged cells (`number-columns/rows-spanned` + covered cells), column widths (absolute + relative), heading rows (`table:table-header-rows`), nested tables, formulas and cell values round-trip.
- **Insert ▸ Table**: the grid picker (up to 10×8), Insert Table… (columns, rows, fixed width / AutoFit to contents / window), Draw Table (drag a rectangle to make a table; drag across a cell to split it), Convert Text to Table (tabs, commas, paragraphs or another character), Quick Tables (Tabular List, Matrix, With Subheads, Calendar).
- **Table Design** contextual tab (shown while the caret is in a table): Table Style Options (Header Row, Total Row, Banded Rows, First Column, Last Column, Banded Columns), a Table Styles gallery of 8 styles drawn as mini previews (applied as direct cell formatting; the style name and options are also written as ODF `table:template-name` / `table:use-*-styles`), Shading, Border Styles (8 presets that load the pen and start the border painter), Line Style, Line Weight, Pen Colour, Borders ▾ (bottom, top, left, right, none, all, outside, inside, inside horizontal/vertical) and Border Painter (click cell edges).
- **Table Layout** contextual tab: Select (cell, column, row, table), View Gridlines, Properties (table width / alignment / indent, row height and "allow row to break across pages", repeat as heading row, column width, cell vertical alignment), Draw Table, Eraser (merges across the clicked edge), Delete (cells…, columns, rows, table), Insert Above/Below/Left/Right (new rows and columns copy their neighbours' formatting; the table keeps its width), Merge Cells, Split Cells…, Split Table, AutoFit (contents, window, fixed), Height/Width spins, Distribute Rows/Columns, the 9-way alignment grid, Text Direction, Cell Margins, Sort (by column, as text / number / date, ascending or descending, with or without a heading row), Repeat Header Rows, Convert to Text, Formula (`=SUM(ABOVE)`, `AVERAGE(LEFT)`, `MIN`, `MAX`, `PRODUCT`, `COUNT`, cell references like `=A1+B2*2`, number formats).
- **Mouse and keyboard**: drag column borders and row bottoms to resize (guide line while dragging); column markers on the horizontal ruler (drag to resize; indent markers follow the cell); Tab / Shift+Tab move between cells and Tab in the last cell adds a row; cell selection by dragging.
- **Pages**: rows split across pages (existing), and **heading rows repeat** at the top of every continuation page: the paginator leaves room above the first row on the new page and a read-only copy of the heading rows is drawn there (`layout/repeat-rows.js`).
- Ribbon commands on tables are separate undo steps (no grouping of quick successive commands).
- Tests: 56 unit (incl. a new table-commands suite) + 109 e2e (7 new in `tests/e2e/tables.spec.js`). Round-trips must re-open with an identical model; **LibreOffice re-saves** our files and keeps merged cells, shading, borders, alignment, cell vertical alignment, heading rows and nested tables. Performance check unchanged (50 pages, under 16 ms per keystroke).
- Screenshots: `reference/compare/m6-*.png` (Table Design, Table Layout, Insert ▸ Table grid, repeated heading rows) in dark and light.

Decisions:
- Formulas are stored the way LibreOffice Writer stores them (`ooow:sum <B1:B3>`, with ABOVE/LEFT/… resolved to cell ranges) plus the computed `office:value`, so LibreOffice can recalculate them; they are evaluated by a small parser (the app's security policy forbids `eval`).
- Table styles are applied as direct formatting (as Word does on export), because LibreOffice's table-template support in ODT is limited; re-applying a style or changing the options re-formats the cells.
- New tables have no `table:name`; LibreOffice names them on open.

Known limitations:
- A single row taller than a page isn't split inside the row.
- Content in cells covered by a merge in a file from elsewhere (rare) isn't kept.
- Formulas don't recalculate automatically when the numbers change; run Formula again (LibreOffice recalculates on open).

## M7 — Insert tab: pictures, shapes, text boxes, links, symbols (approved)

Built:
- **Drawing-object model** (`core/objects.js`, schema `frame` node, `layout/object-view.js`): draw:frame (pictures, text boxes, embedded objects), draw:custom-shape, draw:line, draw:rect and draw:ellipse are one node with the element's attributes, its graphic automatic style resolved into `auto` (regenerated as `fr…`/`gr…` on save, like paragraph styles), its children kept as XML trees, and the text of text boxes and shapes as editable blocks. Unknown children (contours, image maps, replacement pictures) round-trip untouched.
- **Rendering and wrapping**: in line with text, Square, Tight, Through, Top and Bottom, Behind Text, In Front of Text, with x/y offsets, horizontal alignment, margins (distance from text), rotation (`draw:transform`) and flips; floats move to the next page with their paragraph. Pictures show crop (`fo:clip`), brightness/contrast, greyscale/black-and-white/washout/tints, transparency, borders and shadows. Shapes are drawn as SVG from 40 presets that LibreOffice also knows (lines and arrows, rectangles, basic shapes, block arrows, stars, callouts); other imported shapes from their enhanced path. Text boxes and shape text are edited in place by a nested editor (the Home tab formats it; typing with a text box selected types into it).
- **Handles**: eight resize handles (pictures keep their proportions on corners; Shift toggles), rotation handle (Shift: 15° steps), line end points, drag to move (re-anchors to the paragraph under it), arrow-key nudges (Ctrl: 1 px), crop mode with crop handles (Esc ends it).
- **Picture Format** contextual tab: Corrections (5×5 brightness/contrast gallery with live thumbnails), Colour (recolour gallery), Transparency, Change Picture, Reset Picture (& Size), Alt Text, Picture Styles gallery (10), Picture Border (colour, weight, none), Picture Effects (shadows), Arrange, Crop, Height/Width.
- **Shape Format** contextual tab: shapes gallery, Draw Text Box, Edit Text, Shape Styles gallery (28), Shape Fill, Shape Outline (colour, weight, dashes), Shape Effects (shadows), WordArt Text Fill / Text Outline, Align Text (top/middle/bottom), Alt Text, Arrange, Height/Width.
- **Arrange** (Layout tab and both Format tabs): Position gallery (in line + 9 positions), Wrap Text, Bring Forward/to Front/in Front of Text, Send Backward/to Back/Behind Text, Align (left/centre/right/top/middle/bottom), Rotate 90°/flip, More Layout Options (Position, Text Wrapping with distances, Size with rotation and aspect lock), **Selection Pane** (top-most first; select, rename, show/hide with `draw:display`, reorder, Show/Hide All).
- **Insert tab**: Cover Page (4 original designs in a `CoverPage` section, replace/remove), Blank Page, Pictures (file picker, drag-and-drop and pasting picture files), Shapes (click or drag to draw), Icons (220 Lucide icons in 16 categories, searchable, inserted as SVG pictures), Chart, Link (Ctrl+K: web/file, place in this document — headings and bookmarks —, e-mail; ScreenTip; Remove Link; Ctrl+click follows), Bookmark dialog (add/delete/go to, sort, hidden), Text Box (4 designs + Draw Text Box), Quick Parts (AutoText gallery saved in the app settings, Document Property fields, Field dialog with 12 fields), WordArt (8 styles, LibreOffice fontwork), Drop Cap (dropped / options, `style:drop-cap`), Signature Line, Date & Time, Object ▸ Text from File (.odt/.txt), Equation, Symbol (recent symbols + dialog with Unicode blocks, name/code search and special characters), Alt+X.
- **Equations**: MathLive (MIT) is built into a separate chunk embedded in the HTML file and loaded only when the equation editor opens (fonts inlined, no network). Equations are ODF formula objects (`Object N/content.xml`, MathML with the LaTeX as an annotation), drawn in the page with the browser's MathML. Built-in gallery of 7 equations; double-click to edit.
- **Charts**: Column, Bar, Line and Pie, built from a data grid with live preview; stored as real ODF chart objects (chart:chart with a local data table, `Object N/content.xml` + `styles.xml`), drawn as SVG in the page; LibreOffice's own charts are read back for editing. Double-click to edit.
- Embedded objects' XML files live in the document model, so undo, copy/paste and round-trips cover them; unused replacement pictures are dropped on save.
- Fixes found along the way: Ctrl+Home/End handled by the editor (the browser could leave the caret next to inline objects); `wide` dialogs now widen; a key clash between the Field and Font dialogs' strings (and a unit test that catches duplicate i18n keys).
- Tests: 57 unit + 116 e2e (7 new in `tests/e2e/objects.spec.js`). Each saves and re-opens (identical model); **LibreOffice re-saves** our files and keeps pictures with their crop/corrections/wrapping/alt text, shapes (preset types, text), lines with arrows, text boxes, WordArt, links, bookmarks, fields, the cover page, equations (MathML) and charts (types, data, titles). LibreOffice renders our shapes, fontwork, formulas and charts (checked visually via PDF). Performance: 50 pages ≈2.3 ms per keystroke, 0 of 40 keystrokes miss a frame.
- Screenshots: `reference/compare/m7-*.png` (Picture Format, shapes gallery with shapes/WordArt/text box, equation and chart, Symbol dialog, Icons dialog) in dark and light; `ribbon-insert-dark-compare.png` updated.

Decisions:
- Wrapping is done with CSS floats and absolute positioning on the anchor paragraph; floating objects are anchored to their paragraph ("move with text") and positioned from its top-left. Vertical alignment to the page (Position gallery, Align Top/Middle/Bottom) is turned into a paragraph anchor and offset.
- Text in text boxes and shapes is stored as blocks in the node and edited with a nested editor (ProseMirror doesn't support block content in inline nodes).
- WordArt is LibreOffice fontwork (`fontwork-plain-text` with its full geometry — LibreOffice draws nothing from the preset name alone).
- The Insert ▸ Pictures and Text Box buttons have menus (This Device…; text-box designs), so they show ▾ where the reference shows none.
- SmartArt is "Coming soon" (allowed by the milestone).

Known limitations:
- Text wraps on one side of a floating object (CSS floats), and floating objects in the same paragraph don't overlap (they stack). Objects anchored to the page itself (not a paragraph) in other files are kept but not drawn.
- Shapes from other files whose path uses formulas are drawn as their preset (or as a rectangle); WordArt is plain (no warped text effects).
- Coming soon: Remove Background, Artistic Effects, Compress Pictures, Picture Layout, Crop to Shape, Edit Shape, Edit Wrap Points, Group/Ungroup, Text Effects, Create Link (shapes), Stock Images, Online Pictures, New Drawing Canvas, SmartArt, Ink Equation, Object… (OLE), Drop Cap in Margin (ODF has no such option). Cross-reference arrived with M8, comments with M9.

## M8 — References (approved)

Built:
- **Index blocks** (schema `index` node): tables of contents, tables of figures/tables, alphabetical indexes, bibliographies (and LibreOffice's user/object indexes) are no longer opaque. Each keeps its ODF `*-source` element (the templates LibreOffice regenerates from) and an editable body.
- **Table of Contents**: gallery (Automatic Table 1 "Contents" / 2 "Table of Contents"), Custom Table of Contents dialog (title, page numbers, right align, tab leader, levels, hyperlinks, preview), Remove, Add Text (Do Not Show / Level 1–3), Update Table (page numbers only / entire table). Page numbers come from the layout engine; entries link to `#Heading|outline` like LibreOffice. Saved as `text:table-of-content`.
- **Footnotes and endnotes**: Insert Footnote (Ctrl+Alt+F) / Endnote (Ctrl+Alt+D) put the caret in the note's text, edited in place in the note area. The paginator reserves room for each page's footnotes (a note stays on the page of its reference; long notes push the text on), draws them at the page bottom under a separator, and puts endnotes after the last paragraph (on a new page if needed). Numbers follow document order automatically. Footnote and Endnote dialog: location (bottom of page / end of document), number format (1, a, A, i, I), custom mark, start at, numbering continuous / restart each chapter / restart each page, convert footnotes ↔ endnotes, Insert / Apply. Next/Previous Footnote/Endnote, Show Notes (to the note and back), double-click a reference or a note number to jump.
- **Citations & Bibliography**: citeproc-js with five CSL styles (APA 7, MLA 9, Chicago author-date, IEEE, Harvard — Cite Them Right) and en-GB/en-US locales, built as a lazily loaded chunk embedded in the HTML file. Source Manager (master list kept in this browser ↔ the document's list, search, copy, edit, new, delete — cited sources are protected — preview in the current style, **Import BibTeX, RIS and CSL-JSON**), Create Source dialog (11 source types), Add New Placeholder, Insert Citation menu listing the document's sources, Style (live, undoable — citations and bibliographies re-format), Bibliography gallery (Bibliography / References / Works Cited) + Insert Bibliography + Update. Citations are `text:bibliography-mark` fields carrying the source's fields (so LibreOffice knows them); the full sources and style are also kept in `Bibliography/sources.json` in the package.
- **Captions**: Insert Caption (Figure / Table / Equation / New Label…, above or below, exclude label, number format) — a caption paragraph with a `text:sequence` field, declared in `text:sequence-decls`, renumbered automatically in document order. Insert Table of Figures (by label, include label and number, page numbers, right align, leader, hyperlinks) as `text:illustration-index` / `text:table-index`; Update Table.
- **Cross-references**: to headings (adds LibreOffice's `__RefHeading__` bookmark pair), bookmarks, footnotes, endnotes and captions; formats text, page number, heading level, above/below, label and number, caption text. Page and above/below references follow the layout live; **F9** (Update Fields) updates all references, tables of contents and figures, and citations.
- **Index**: Mark Entry (Alt+Shift+X; main entry + subentry, Mark / Mark All) as `text:alphabetical-index-mark`; Insert Index (columns 1–4 in a section, right-aligned page numbers with leader, letter headings); Update Index. Marks show as {XE} with formatting marks on.
- **Zotero tab**: the live connector can't be reached (see decisions), so the tab works from Zotero's exports: Import Library (BibTeX/RIS/CSL-JSON), Add/Edit Citation (picker), Add/Edit Bibliography, Refresh, Document Preferences (citation style), Unlink Citations (to plain text). Add Note is Coming soon.
- Also: Enter at the end of a paragraph continues with its style's next style (default: the same style — Word/LibreOffice behaviour; captions and headings go back to Normal); the left indent of a hanging first line is a tab stop (IEEE lists line up); ribbon drop-down selects show the current value; nested dialogs keep their own keys; inserting an index at the end of the document keeps a paragraph after it.
- Tests: 57 unit + 123 e2e (7 new in `tests/e2e/references.spec.js`), all saving and re-opening with an identical model; **LibreOffice re-saves** the TOC, footnotes/endnotes with their numbering configuration, citations and bibliography, captions/cross-references/table of figures, and the index. Performance: 100 pages, 3 ms median per keystroke.
- Screenshots: `reference/compare/m8-*.png` (References tab with a TOC, footnotes at the page bottom, IEEE bibliography with the Style menu, Source Manager, Footnote/Cross-reference/Index dialogs, Zotero tab) in dark and light.

Decisions:
- **Zotero connector**: not possible from this app. It runs from a `file://` page whose Content-Security-Policy allows only `data:`/`blob:` connections (the app never touches the network), and a file:// page is an opaque origin that Zotero's local server (127.0.0.1:23119) doesn't answer with the CORS / Private Network Access headers a browser requires. The milestone said to leave the tab out in that case, but the reference screenshots show it, so it stays and works from Zotero's exports instead (and References ▸ Manage Sources ▸ Import does the same).
- Chicago is the author-date variant (in-text citations); notes-bibliography would need citations inside footnotes.
- Sources not yet cited live in `Bibliography/sources.json` (LibreOffice ignores the file, and keeps the cited ones as marks).
- A split paragraph's footnotes go to the page where the paragraph ends.

Known limitations:
- A footnote taller than the space left on its page isn't continued on the next page (it overlaps the margin); footnotes in multi-column sections are laid out at the page bottom across the full width.
- One source per citation (no multi-source clusters, page locators or suppressed author/year yet).
- Restart-each-chapter counts from each Heading 1; caption numbers don't include chapter numbers.
- Coming soon: Zotero ▸ Add Note; index cross-references ("See …") and page-range entries; editing a citation in place (delete and re-insert it).

## M9 — Review: comments, track changes, proofing (approved)

Built:
- **Track Changes** (Ctrl+Shift+E, or Editing ▾ Reviewing): typing is recorded as insertions, Backspace / Delete / typing over a selection keep the old text as deletions (your own new text is really removed), Enter and joining paragraphs are recorded as inserted / deleted paragraph breaks, character formatting as formatting changes that remember the old formatting. Author and time from your user name (Track Changes Options); a colour per author. Display for Review: Simple Markup (final text, red change bars), All Markup (underline / strike-through in the author's colour, grey bars, ¶ marks for breaks), No Markup, Original. Show Markup: Comments, Insertions and Deletions, Formatting, Reviewers (per author). Accept / Reject: this change (and move to next), all shown, all, all and stop tracking; Previous / Next. Lock Tracking. Reviewing Pane (vertical, docked left, or horizontal under the page) with a summary and every revision.
- **ODF**: changes are marks in the editor and `text:tracked-changes` regions in the file — insertions as change-start/end (spanning paragraphs when breaks were inserted), deletions as a `text:change` point with the deleted paragraphs in the region (paragraphs joined by a deleted break are merged in ODF and split again on import), format changes. LibreOffice's own tracked changes open as marks; `text:track-changes="true"` reopens with tracking on. Regions we can't express (deleted tables, changes in text boxes) stay as they are.
- **Comments**: New Comment (Ctrl+Alt+M) on the selection (a range, highlighted) or at the caret; balloons in the margin beside their line (no overlaps, a line to the active one's anchor), avatar with initials, time; replies (threads, saved as LibreOffice's `loext:parent-name`), Resolve / Reopen (`loext:resolved`), ⋯ Delete thread; Delete / Delete All Shown / Delete All; Previous / Next; Show Comments ▸ Contextual (balloons) or List (the Comments pane, also the top-right Comments button). The comment text is edited in place.
- **Proofing**: spelling as you type with nspell (MIT) and the en-GB and en-US Hunspell dictionaries, in a Web Worker built as an embedded chunk; red wavy underlines; right-click for suggestions (closest first), Ignore All, Add to Dictionary (kept in the settings). Grammar (blue double underline): repeated words, sentence starting in lower case, lower-case "i", extra spaces, space before punctuation. Editor pane (F7, Spelling & Grammar, Home ▸ Editor): counts, one problem at a time with its sentence, suggestions, Ignore Once / Ignore All / Add to Dictionary / Change All, previous / next. Language dialog: mark text as a language (only English is checked) or "Do not check spelling" (`fo:language="zxx"`). Word Count dialog (pages, words, characters with / without spaces, paragraphs, lines; optionally text boxes, footnotes and endnotes).
- **Read Aloud**: the browser's speech synthesis from the caret (or the selection), word highlighting, a floating player (previous / pause / next paragraph, speed, voice, stop).
- **Check Accessibility**: pane with errors (missing alt text, table without a header row), warnings (skipped heading level, empty heading, text contrast below 4.5:1, no document title) and tips (use headings); go to each, with fixes for alt text and header rows; re-checks as you edit.
- **Compare**: original (this document or a file) against a revised file → a new "Compare Result" document with the differences as tracked changes (paragraphs matched, changed ones compared word by word); accept all gives the revised text, reject all the original.
- **Restrict Editing** pane: read only / comments only / tracked changes only, enforced and saved in settings.xml (`ODTEditorRestrictEditing`, plus `LoadReadonly` so LibreOffice opens a read-only document read-only); re-applied on open. **Editing ▾** modes work: Editing, Reviewing (= Track Changes), Viewing (read-only).
- Fixes: keys pressed quickly after an arrow key used the old caret (selection now flushed on every keydown); the Footnote/comment nested editors' JSON normalised on import; `--panel-bg`/`--border` style tokens that never existed replaced (M8 dialogs looked off in the light theme).
- Tests: 70 unit (3 new files: tracked-changes ODF mapping, recording/accept/reject, compare) + 128 e2e (5 new in `tests/e2e/review.spec.js`), all saving and re-opening with an identical model; **LibreOffice re-saves** our tracked changes (regions, authors, deleted text), comments (replies with `loext:parent-name`, resolved state, ranges). Performance: 50 pages 3 ms median per keystroke with spelling on; 100 pages 4 ms.
- Screenshots: `reference/compare/m9-*.png` (All Markup with comment threads, Simple Markup with the Reviewing Pane, Editor pane, spelling menu, Accessibility pane, Comments pane) in dark and light.

Decisions:
- Changes are marks (not separate nodes), so editing, undo and copy/paste just work; export rebuilds ODF regions from contiguous runs.
- Spelling runs in a worker (the dictionaries are ~1 MB each); only en-GB and en-US are bundled.
- **Thesaurus: Coming soon** — the open English thesauri (LibreOffice's MyThes, WordNet-based) are 10+ MB, too big for the single file.
- Translate stays Coming soon (needs an online service). Combine Documents is Coming soon.
- The compare result opens as a new document (this app has one document per window until M12).

Known limitations:
- Not tracked: paragraph formatting / style changes, table structure changes, edits inside text boxes, notes and comments.
- A deletion across a table boundary can't be put back; it then simply happens.
- Comments in a header or footer aren't shown as balloons.
- Grammar checks are simple rules (no full grammar engine).
- Read Aloud depends on the voices the system provides (none in some Linux browsers).

## M10 — Draw tab (approved)

Built:
- **Ink layer**: with Pen, Pencil, Highlighter, Eraser or Lasso chosen, a layer over the pages takes the pointer (mouse, touch or pen; Esc goes back to Select). Each stroke becomes a real drawing object (`draw:path`) anchored to the paragraph beside it, floating in front of the text, so it moves with its paragraph, undoes, shows in the Selection Pane, and can be selected, resized and moved like any shape.
- **Pens**: Pen (smooth line; with a pressure-sensitive pen the stroke is a filled outline whose width follows the pressure), Pencil (grainy texture), Highlighter (50 % transparent, blends with the text). Colour (A ▾) and thickness (≡ ▾) apply to the current pen and are remembered per pen; **Add Pen** ▸ Pen / Pencil / Highlighter saves the current one, and saved pens are listed at the top of the menu (kept in the settings).
- **Eraser** removes whole strokes it touches (also strokes on a canvas). **Lasso** selects the strokes and shapes inside the loop; drag the selection to move it, Delete to delete, Esc to clear.
- **Ink to Shape**: a toggle — strokes drawn while it is on become a line, arrow, rectangle, ellipse or triangle (shapes in the pen's colour) when they look like one; with a lasso selection it converts the selected strokes. Ink to Math stays unavailable.
- **Drawing Canvas**: a 15.24 × 7.62 cm canvas (a `draw:g` group: a white rectangle plus the strokes and shapes drawn on it, which stay inside it and move with it).
- **Ink Replay**: redraws every stroke in the order it was drawn, with a progress bar and Stop.
- **ODF**: strokes are `draw:path` (svg:viewBox in 1/100 mm, svg:d) with a graphic style for colour, width, line caps and transparency; canvases are `draw:g` with each shape's own style. LibreOffice opens and re-saves them and draws them (checked: `reference/compare/m10-libreoffice-*.png`). Paths, polylines, polygons and simple groups from other documents are now drawn too instead of being kept as hidden XML.
- Tests: 72 unit (new: ink geometry, pressure outline, shape recognition) + 131 e2e (3 new in `tests/e2e/draw.spec.js`: pens / eraser / lasso / Ink to Shape; canvas / Add Pen / Replay; pressure), all re-opening identically, LibreOffice re-saving the paths and the group. Performance unchanged (50 pages 3 ms per keystroke).
- Screenshots: `reference/compare/m10-*.png` and `ribbon-draw-*-m10.png` (matches `ribbon-draw-dark.png`), dark and light.

Decisions:
- Ink is ordinary ODF drawing objects rather than a separate layer, so it saves, undoes and opens in LibreOffice without anything special. The tool is in the object's name ("Pen 3", "Pencil 1", "Highlighter 2").
- A pressure stroke is saved as its outline (ODF has no variable-width line); the outline keeps the same number of points down each side so its centre line can be recovered for Ink to Shape.

Known limitations:
- Clicking a stroke with Select selects the whole object; there is no point editing of strokes.
- Groups containing frames, text or other groups (from other documents) are kept but not drawn.
- The Pencil texture is drawn only in this editor; LibreOffice draws a plain line.

## M11 — Mailings and Developer (approved)

Built:
- **Recipients**: Select Recipients ▸ Use an Existing List reads CSV/TXT/TSV directly and XLSX/XLS/ODS with SheetJS (first sheet, first row = column names); ▸ Type a New List opens an editable grid (New Entry, Delete Entry, Add Column). **Edit Recipient List**: filter, sort by column, tick/untick recipients; a typed list stays editable. The list is saved inside the .odt (`MailMerge/recipients.json`), so a merge document re-opens ready to preview.
- **Fields**: Insert Merge Field ▾ (the list's columns), **Address Block** (name format, company, address lines, country; live preview with the first recipient; empty lines are dropped when merging), **Greeting Line** (salutation, name format, punctuation). Merge fields are ODF database fields (`text:database-display`, database/table/column), which LibreOffice keeps.
- **Rules**: If…Then…Else (`text:conditional-text` with an `ooow:[db.table.field] >= "v"` condition), Fill-in (`text:text-input`, asked once per merge), Next Record (`text:database-next`), Merge Record # (`text:database-row-number`), Skip Record If (kept with the merge settings).
- **Highlight Merge Fields**; **Preview Results** with first/previous/record number/next/last and Find Recipient, showing the record's values in place.
- **Finish & Merge ▸ Edit Individual Documents** (all/current/from–to): a new document with one copy per recipient, each on a new page (labels and directories are continuous).
- **Envelopes** (DL, C4, C5, C6, US #10, Monarch; delivery and return address, omit return) and **Labels** (Avery L7160, L7163, L7173, L7159, L7651, 5160, 5163; full page or a single label at row/column) create new documents with the right page size and a borderless table of exact-size cells. Start Mail Merge ▸ Envelopes/Labels lays out a merge document with the address block in every label (with Next Record between labels).
- **Developer ▸ Controls**: Rich Text, Plain Text, Picture, Check Box, Combo Box, Drop-Down List, Date Picker content controls. Placeholders select whole on click and are replaced by typing; the check box toggles on click; drop-down/combo box open their list; the date picker opens a calendar and writes the date in the control's format; the picture control asks for a picture. **Design Mode** outlines the controls and allows editing them freely. **Properties**: title, tag, locking (can't delete / can't edit), check-box symbols, date format, list items (add, remove, move up).
- **Restrict Editing ▸ Filling in forms**: only the content of controls can be changed (saved in settings.xml like the other restrictions).
- **ODF**: controls are LibreOffice's `loext:content-control` (with `loext:list-item`s), which is also what LibreOffice makes from Word content controls. Our XML for `tests/fixtures/lo-content-controls.odt` (made by LibreOffice) matches LibreOffice's byte for byte, and it round-trips identically.
- Tests: 77 unit (new: CSV parsing, conditions, address block/greeting, merging) + 133 e2e (3 new in `tests/e2e/mailings.spec.js`: letters from CSV with preview/merge and a LibreOffice re-save keeping the database fields; XLSX list, typed list, envelopes, labels; content controls with properties, design mode, forms restriction and a LibreOffice re-save). Performance unchanged (100 pages: 3.6 ms median per keystroke).
- Screenshots (dark and light): `reference/compare/m11-mailings-fields-*`, `m11-mailings-preview-*`, `m11-recipients-*`, `m11-labels-dialog-*`, `m11-labels-doc-*`, `m11-envelope-doc-*`, `m11-developer-*`, `m11-developer-design-*`, `m11-control-properties-*`, `m11-control-dropdown-*`. There is no reference screenshot of these tabs; they follow the ribbon conventions of the other tabs.

Decisions:
- SheetJS 0.20.3 from the official SheetJS CDN tarball (the npm package is out of date), bundled as a lazily loaded chunk.
- The recipient list is stored in the document package rather than linking to the original file (a browser can't re-open a file by path).
- Finish & Merge ▸ Print Documents and Send Email Messages stay "Coming soon": printing arrives in M13, and e-mail needs a mail service.
- Content controls are a mark on their content (not a node), so text inside them edits normally; typing straight after a control you're filling continues inside it, and typing after moving the caret there goes outside.

Known limitations:
- No Outlook/contacts sources or database connections; only the first sheet of a workbook is read.
- Envelope printing options (feed method) and custom label sizes aren't available.
- Repeating-section and building-block content controls and legacy form fields aren't offered (legacy fields from other files are kept).

## M12 — View tab and windows (awaiting approval)

Built:
- **Views**: Print Layout (pages); **Web Layout** (no pages, the text wraps to the window); **Draft** (no pages at the body width, page breaks shown as labelled dotted lines); **Outline** with the **Outlining** tab; **Read Mode** (a read-only copy of the document in screen-sized columns: ‹ › arrows, ← → / Page Up/Down / mouse wheel, Tools ▾ Find / Read Aloud, View ▾ Edit Document / Column Width / Page Colour, "Screen n of m", Esc to go back). The status bar's Read / Print / Web buttons switch views.
- **Outlining tab**: Outline Level (Level 1–9 / Body Text), Promote to Heading 1, Promote, Demote, Demote to Body Text (Alt+Shift+← / →), Move Up / Down (Alt+Shift+↑ / ↓; a paragraph moves with the content hidden under it), Expand / Collapse (Alt+Shift+= / −, or click a heading's ⊕), Show Level, Show Text Formatting, Show First Line Only, Close Outline View. Heading 5–9 styles are added when first used.
- **Focus** (document only, full screen, the ribbon slides in at the top edge, Esc to leave) and **Immersive Reader** (contextual tab): Column Width (very narrow → wide), Page Colour (none, sepia, inverse, mint, sky, rose), Line Focus (1, 3 or 5 lines), Text Spacing, Syllables (mid-dots from the en-GB hyphenation patterns, text unchanged), Read Aloud. The text stays editable.
- **Navigation pane**: drag a heading to move its whole section (drop above or below another heading); right-click ▸ Promote / Demote / Select Heading and Content / Delete; **Pages** shows real rendered page thumbnails (made only for thumbnails in view).
- **Dark Mode ▸ Switch Modes**: dark pages while the interface is dark (pictures keep their colours); remembered.
- **Window**:
  - **New Window** opens the same document in a second window; both stay in sync as you type (edits travel as ProseMirror steps over a BroadcastChannel, with prosemirror-collab rebasing concurrent edits; page setup and style changes and new pictures travel too). Titles show "Document1:1" / ":2". If the first window closes, another takes over.
  - **Split**: a second, independently scrolling pane of the same document below the first (drag the bar to resize, double-click it to remove); typing and commands work in either pane.
  - **View Side by Side** + **Synchronous Scrolling** between two windows of the app (New Window, or another document open in another tab); **Arrange All**; **Switch Windows** lists the app's windows; **Full Screen** (Esc to leave).
- **Templates**: View ▸ Templates opens File ▸ New with seven original templates (Blank, Studio handbook, Letter, Résumé, Report, Newsletter, Meeting notes), Save as Template (.ott, ODF template mimetype) and Open a Template (opens as a new untitled document).
- Also fixed: the Selection Pane's styles weren't included in the build.
- Tests: 79 unit (new: outline items, sections and moving them) + 139 e2e (6 new in `tests/e2e/view.spec.js`: views and Read Mode; Outline with a round trip; Focus, Immersive Reader, Switch Modes; Navigation pane drag and thumbnails; New Window sync both ways, Switch Windows, Side by Side with Synchronous Scrolling, Split; Full Screen and templates with the .ott mimetype). Performance unchanged (100 pages: about 3.7 ms median per keystroke).
- Screenshots: `reference/compare/ribbon-view-dark-compare.png` (matches `ribbon-view-dark.png`) and `m12-*-{dark,light}.png`: navigation pages, web layout, draft, outline, immersive, split, read mode, focus, switch modes, templates.

Decisions:
- Views without pages use the same editor with pagination switched off (no second renderer).
- New Window uses BroadcastChannel (works between tabs opened from the same file); the first window of a document is the authority that orders edits. Undo in each window undoes that window's own edits.
- Split's lower pane shows the document as one continuous page (not paginated).
- Read Mode shows a read-only copy (it refreshes when you go back and return).
- Browsers only let a page move or resize windows it opened itself, so Arrange All / Side by Side position windows made by New Window; a normal tab stays where it is (a message says so). Synchronous Scrolling works either way.

Known limitations:
- Settings outside the document text and styles (Restrict Editing, document properties) are not synced between windows.
- Macros stays "Coming soon".

