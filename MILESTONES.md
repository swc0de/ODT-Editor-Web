# ODT Editor — milestones

How to use this:
1. Make an empty project folder. Put `CLAUDE.md` and `MILESTONES.md` in it, and your screenshots in a `reference/` subfolder (descriptive names help, e.g. `ribbon-home.png`, `backstage-home.png`).
2. Start Claude Code in that folder and say: **"Start the project."**
3. After each milestone it stops and asks for approval. Open `dist/odt-editor.html` and try it. Reply **approved**, or say what to change and attach more screenshots. New screenshots get saved into `reference/` and followed from then on.
4. Optional: while it's waiting for approval, run `/clear` and then say **approved** to start the next milestone with a fresh context. It picks up from `PROGRESS.md`.

Claude Code follows the prompts below by itself; you don't need to paste them.

---

## M0 — Scaffold, build, test harness

```
Set up the project only.
- npm project with esbuild, ProseMirror packages, fflate and Playwright. `npm run build` produces ONE offline file, dist/odt-editor.html, with everything inlined (JS, CSS, bundled fonts as base64 woff2, icons). Verify it opens from file:// with zero network requests.
- Create the src/ structure from CLAUDE.md, theme tokens as CSS custom properties (dark + light), the command registry, i18n setup and config.js (with the app name).
- tests/make-fixtures.mjs generates the ODT fixtures listed in CLAUDE.md. Detect whether soffice is installed and record the result in PROGRESS.md.
- Smoke test: the page loads, no console errors, no network requests, the title is the app name.
- Write a README.
Definition of done: as in CLAUDE.md.
```

## M1 — App shell and complete ribbon UI (visual match)

```
Build the full window chrome to match the reference screenshots pixel-closely. No document editing yet: show one blank white A4 page.
- The tab bar with all 12 tabs, the right-side Comments / Editing ▾ / Share buttons, and the accent underline on the active tab.
- The ribbon framework: groups, group labels, dividers, dialog launchers, all control types (large/small/split/toggle/combo/spin/checkbox/gallery), dropdown menus, disabled state, hover/pressed states, collapse (Ctrl+F1, double-click a tab), responsive group collapsing, Alt KeyTips.
- EVERY tab populated with EVERY control listed in CLAUDE.md, in the screenshot order, each bound to a command id. Unbuilt commands are disabled with a "Coming soon" tooltip.
- Rulers (static for now), the dark canvas, the white page with shadow, and the status bar with all items (static values).
- The Backstage: indigo navigation column with all items and the back arrow; the Home page with greeting, template thumbnails, More templates and Recent empty state. Other pages are placeholders. Esc or ‹ returns to the document.
- Alt+Q command search box (lists every command).
- Dark/light theme switching.
Compare Playwright screenshots against every reference image at the same viewport size, save them to reference/compare/, and iterate until they closely match.
Definition of done: as in CLAUDE.md. In your summary, list any differences from the screenshots you couldn't resolve.
```

## M2 — Document model and ODT open/save

```
- The ProseMirror schema covering the ODT model in CLAUDE.md, including opaque preservation nodes for unknown content.
- ODT import: content.xml/styles.xml/meta.xml → the model, including the style hierarchy (paragraph/character/list/table/page styles), automatic styles and images.
- ODT export: the model → a valid ODF 1.3 package (mimetype first and stored, manifest, de-duplicated automatic styles, meta stats, thumbnail).
- Basic editing works in a temporary continuous (non-paginated) view: typing, selection, IME, clipboard (rich paste from HTML, Word and LibreOffice; plain paste), undo/redo with history grouping.
- Open (Ctrl+O, drag-drop, Backstage), Save (File System Access API write-back where available, otherwise download), Save As (F12), New, Close; the dirty indicator in the title; Recent files in IndexedDB.
- Autosave + Backstage → Recover + unsaved-change guards.
- Round-trip tests on every fixture (and a LibreOffice headless conversion if available).
Definition of done: as in CLAUDE.md.
```

## M3 — Print Layout: pagination, rulers, status bar, zoom

```
- Real paginated Print Layout: page size/margins from the page style, page gaps, paragraphs and tables split across pages, widow/orphan control, keep-with-next, and page breaks.
- Incremental re-layout. Benchmark: a 100-page fixture types without lag, and scrolling stays smooth.
- Live rulers: margins shaded, draggable indent markers and margins, tab stops with the tab selector, vertical ruler.
- Status bar live: Page X of Y, word count, language; the view buttons; the zoom slider.
- View tab zoom group: Zoom dialog, 100%, In/Out, One Page, Multiple Pages, Page Width, Ctrl+wheel. Page Movement: Vertical / Side to Side. Show: Ruler, Gridlines, Hide White Space.
Definition of done: as in CLAUDE.md.
```

## M4 — Home tab: character and paragraph formatting, styles, lists, find

```
Wire up the whole Home tab.
- Clipboard, including Format Painter (single click / double-click to lock) and Paste options (Keep Source / Merge / Text Only).
- All Font controls, plus the Font dialog (launcher): character spacing, small caps, all caps, hidden, underline styles/colours.
- All Paragraph controls, plus the Paragraph dialog: indents, spacing, line spacing, alignment, keep options, tabs dialog with leaders, borders & shading dialog. Show ¶ formatting marks.
- Styles: live gallery, Styles pane (launcher), apply/modify/create/update-to-match, and style inheritance saved to ODT styles.
- Lists: bullets, numbering, multilevel gallery, define new list, restart/continue/set value, Tab/Shift+Tab level changes, autoformat as you type.
- Editing: Find (Navigation pane results), Replace dialog (match case, whole words, wildcards/regex, formatting), Go To, Select ▾ (Select All, Select Objects, Select Text with Similar Formatting).
- All AutoCorrect behaviours and every shortcut listed in CLAUDE.md for these features. Mini-toolbar and context menu.
- Dictate (Web Speech API) where supported.
Definition of done: as in CLAUDE.md, including ODT round-trip tests for every formatting type.
```

## M5 — Layout and Design tabs, headers/footers, sections

```
- Layout ▸ Page Setup: Margins (presets + custom), Orientation, Size, Columns (presets + dialog), Breaks (page, column, text wrapping, section next page/continuous/even/odd), Line Numbers, Hyphenation (automatic via a bundled hyphenation pattern library), Text Direction. Page Setup dialog via the launcher.
- Sections with their own page style, columns and orientation, saved as ODT sections and master pages.
- Layout ▸ Paragraph spin boxes, live.
- Headers and footers: double-click to edit; Header/Footer tools contextual tab (different first page, different odd & even, link to previous, page number fields, date, close); Page Number gallery and format dialog.
- Design: Themes, Style Sets, Colours, Fonts, Paragraph Spacing, Set as Default, Watermark (text/picture), Page Colour, Page Borders.
Definition of done: as in CLAUDE.md.
```

## M6 — Tables

```
- Insert ▸ Table: grid picker, Insert Table dialog, Draw Table, Quick Tables, Convert Text ↔ Table.
- Contextual tabs "Table Design" (table styles gallery with banded rows/columns and header/total row options, shading, borders, border painter) and "Table Layout" (select, gridlines, delete, insert rows/columns, merge/split cells, split table, AutoFit, cell size spins, distribute, alignment grid, text direction, cell margins, repeat header rows, sort, convert to text, formula).
- Mouse resizing of columns/rows, column markers on the ruler, rows splitting across pages, nested tables, Tab to move/add a row.
- Faithful ODT table import/export (merged cells, styles, widths).
Definition of done: as in CLAUDE.md.
```

## M7 — Insert tab: pictures, shapes, text boxes, links, symbols

```
- Pages: Cover Page gallery (3–4 original designs), Blank Page, Page Break.
- Pictures (file, drag-drop, paste): resize handles, rotate, crop, Picture Format contextual tab (corrections, recolour, transparency, picture styles, alt text, size).
- Shapes gallery (lines, rectangles, basic shapes, arrows, callouts) with Shape Format tab (fill, outline, effects, add text); Icons (bundled open icon set); Text Box; WordArt; Drop Cap.
- Wrapping and position: inline, square, tight, top & bottom, behind/in front of text; anchoring; Layout ▸ Arrange group fully working; Selection Pane. Saved as ODT draw:frame / draw:custom-shape.
- Links (Ctrl+K dialog: URL, place in document, email), Bookmarks dialog, Quick Parts (AutoText, fields: date, author, page, NumPages, file name), Date & Time, Signature Line.
- Symbol (recent symbols + full dialog with Unicode search), Alt+X.
- Equation: an equation editor (bundle MathLive), stored as MathML objects in ODT.
- Chart: a basic chart builder (bar, line, pie with a data grid), stored as an ODF chart object if feasible, otherwise as an image plus preserved data. Document what you chose. SmartArt: a few original layouts built from shapes, or Coming soon if it can't be done well.
Definition of done: as in CLAUDE.md.
```

## M8 — References

```
- Table of Contents (gallery of 2 automatic styles + custom dialog), Add Text, Update Table; it updates page numbers from the layout engine and saves as text:table-of-content.
- Footnotes and endnotes with numbering options, laid out at the page bottom / document end; Next Footnote, Show Notes.
- Citations & Bibliography: Manage Sources (add/edit/delete, import BibTeX, RIS and CSL-JSON — Zotero can export these), Insert Citation, styles APA / MLA / Chicago / IEEE / Harvard (bundle citeproc-js + those CSL styles), Bibliography gallery.
- Captions (figure/table/equation numbering), Table of Figures, Cross-references (to headings, bookmarks, notes, captions; updates on F9).
- Index: Mark Entry, Insert Index, Update Index.
- Optional: try a "Zotero" ribbon tab that talks to the local Zotero app's connector/local API at 127.0.0.1:23119. If the browser blocks this from file://, leave the tab out and explain why in PROGRESS.md.
Definition of done: as in CLAUDE.md.
```

## M9 — Review: comments, track changes, proofing

```
- Comments: margin balloons connected to their anchors, replies (threads), resolve, delete, Previous/Next, the Comments pane, and the top-right Comments button. Author name and initials from Options. Saved as office:annotation.
- Track Changes: insertions, deletions and formatting changes recorded with author/time and colour-coded per author; Display for Review modes; Show Markup filters; Reviewing Pane; Accept/Reject (this one / all / all shown); the Editing ▾ "Reviewing" mode. Saved and loaded as ODT text:tracked-changes.
- Proofing: spelling with red squiggles and suggestions (bundle nspell or Hunspell-WASM with an en-GB dictionary, plus en-US), Add to dictionary, Ignore, the Editor pane, F7; basic grammar checks (repeated words, capitalisation, spacing); Language dialog per selection; Word Count dialog; Thesaurus if an open thesaurus can be bundled, otherwise Coming soon.
- Read Aloud (speechSynthesis), Check Accessibility (headings, alt text, table headers, contrast), Compare documents (side-by-side diff into tracked changes), Restrict Editing (read-only / comments only, saved in settings).
Definition of done: as in CLAUDE.md.
```

## M10 — Draw tab

```
- An ink layer over pages: Pen, Pencil (textured), Highlighter, Eraser (stroke eraser), Lasso select/move/delete, Select; Add Pen with colour and thickness presets that are remembered. Pointer-pressure support.
- Drawing Canvas object (an inline/floating frame containing ink and shapes).
- Ink to Shape (recognise lines, rectangles, ellipses, triangles, arrows from strokes); Ink to Math stays disabled.
- Ink Replay (animate the strokes in order).
- Saved to ODT as draw:path/draw:polyline inside frames, so LibreOffice shows them.
Definition of done: as in CLAUDE.md.
```

## M11 — Mailings and Developer

```
- Mailings: Select Recipients from CSV/XLSX (bundle SheetJS) or Type a New List; Edit Recipient List (filter/sort/checkboxes); Insert Merge Field; Address Block; Greeting Line; Rules (If…Then…Else, Fill-in, Skip Record); Highlight Merge Fields; Preview Results with record navigation; Finish & Merge → new document / print. Envelopes and Labels dialogs (common label sizes) generating documents. Merge fields saved as ODT database fields.
- Developer: content controls (Rich Text, Plain Text, Check Box, Combo Box, Drop-Down, Date Picker, Picture), Design Mode, Properties dialog, mapped to ODT form controls/fields; Restrict Editing (fill-in forms only).
Definition of done: as in CLAUDE.md.
```

## M12 — View tab and windows

```
- Views: Read Mode (column-paged reading view with arrows), Web Layout (no page breaks), Outline (Outlining contextual tab: promote/demote, move up/down, show level, collapse), Draft.
- Focus mode, Immersive Reader (line focus, text spacing, column width, page colour, syllables, read aloud).
- Navigation Pane (Headings with drag-to-reorder sections / Pages thumbnails / Results).
- Dark Mode: Switch Modes (dark page rendering) and Interface Theme.
- Window: New Window (opens the same document in a second browser tab, kept in sync via BroadcastChannel), Split (two scrollable panes of one document), View Side by Side + Synchronous Scrolling (between two open docs), Arrange All, Switch Windows, Full Screen.
- Templates: a templates gallery (original Letter, Résumé, Report, Studio handbook sample, Newsletter, Meeting notes) and Save as Template (.ott).
Definition of done: as in CLAUDE.md.
```

## M13 — Import/export, Options, polish and final audit

```
- Import: DOCX (via mammoth, plus your own handling for styles/tables where possible), HTML, Markdown, RTF, TXT, OTT. Export: DOCX (bundle the `docx` library), PDF (print pipeline with headings → bookmarks where the browser supports it), HTML, Markdown, RTF, TXT, PNG of the current page.
- Backstage completed: Info (properties, inspect document, version history from autosaves), Print preview with settings, Export page, the complete Options dialog (all sections from CLAUDE.md), Customise Ribbon, Quick Access Toolbar.
- Help tab: the shortcuts sheet, What's New, About (with licenses).
- Audit: keyboard-only walkthrough of every tab; ARIA; contrast in both themes; i18n has no hard-coded strings; performance on 100- and 300-page documents (memory, typing latency, open/save time).
- A final visual pass against every image in reference/, with updated comparisons.
- README: features, keyboard shortcuts, known limitations, licenses.
Definition of done: as in CLAUDE.md, plus a v1.0.0 tag and a final report (what works, gaps, suggested next steps).
```

## M14 — Word DOCX fidelity and exact interface match

```
Goal: a .docx opened in ODT Editor looks the same as in Microsoft Word on Windows (page size, margins, headers/footers, columns, line and paragraph spacing, tabs, list indents, table geometry, borders, object positions, page breaks), and exporting back to .docx gives a file Word renders the same way. The app's interface (tab bar, ribbon, backstage, status bar) matches the reference screenshots exactly.
Reference: reference/docx/DOCX-Fidelity-Reference.docx (defects D1–D14 with Word's exact values, layout rules L1–L15, export checklist in section 5, interface measurements in section 6, Appendix A). Test document: tests/fixtures/word-fidelity/docx-editor-test.docx (8 pages in Word).
- Part A: fix import and rendering D1–D14 at the root cause (even/odd and inherited headers/footers, per-section columns with separator, anchored pictures with wrap, docDefaults spacing, heading bold / Calibri Light, ptab and Word tab origin, paragraph border spacing and grouping, cell margins, cell text direction, double/thick borders and Word's border-conflict rule, list label properties and suffix, auto colour on dark shading, screen-only field shading, TOC generation). Follow the L1–L15 rules.
- Part B: replace the docx-library export with a direct OOXML writer that mirrors docx-reader.js feature for feature (styles.xml with docDefaults, one sectPr per page-style change, headers/footers per section, full paragraph/run/list/table/picture properties incl. anchored pictures, notes, comments, tracked changes, bookmarks, internal links, complex fields with cached results, core properties).
- Part C: model tests from the fixture's own XML, Playwright layout tests (tests/e2e/docx-fidelity.spec.js), LibreOffice side-by-side comparisons (reference/compare/m14-docx-p*.png), round trips (fixture and existing .docx fixtures), all existing tests and typing latency.
- Part D: UI font (Segoe UI first, bundled Selawik fallback), group widths within ±2 px of table 6.1, control fixes from table 6.3, icon metaphors within the original-icon rule, divider/label position test, ribbon pixel-diff check with heat-maps.
Constraints: keep the ODT model; no runtime network; never weaken tests; D-ids in commit messages and test names; decisions and unavoidable differences recorded in PROGRESS.md.
Definition of done: as in CLAUDE.md.
```
