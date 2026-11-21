# ODT Editor

A full word processor for **OpenDocument Text (.odt)** that runs entirely in your
browser from **one self-contained HTML file**: `dist/odt-editor.html`.
No server, no uploads, no analytics — open the file (even from `file://`, even
offline) and everything happens locally.

> **Version 1.0.0.** A complete Word-style editor: every ribbon tab (Home,
> Insert, Draw, Design, Layout, References, Mailings, Review, View,
> Developer, Help) with real pages, rulers and zoom; it opens and saves ODT
> (and opens DOCX, HTML, Markdown, RTF and text; exports DOCX, PDF, HTML,
> Markdown, RTF, text and page pictures), autosaves, keeps a version history
> and can encrypt documents with a password. The few controls that aren't
> built are dimmed with a "Coming soon" tooltip and listed under
> [Known limitations](#known-limitations-v10).

## Working with files

- **Open**: Ctrl+O, drag a file onto the window, or File ▸ Open / Recent.
  Opening a template (`.ott`) starts a new document from it. Word (`.docx`),
  web pages, Markdown, RTF and text files open as new documents (saving them
  writes ODT). Password-protected ODT files ask for their password.
- **Save**: Ctrl+S. In Chromium-based browsers (Chrome, Edge) the file you
  opened is updated in place; elsewhere the document is downloaded.
  Save As: F12 or File ▸ Save As.
- **Never lose work**: the document is autosaved in this browser every 30
  seconds and whenever you switch away; File ▸ Recover brings back anything
  that wasn't saved. You are asked before unsaved changes are discarded.
- **Export**: File ▸ Export saves a copy as ODT, PDF (through the print
  dialog), Word, web page, Markdown, RTF or text, or the current page as a
  PNG picture. Share offers the system share sheet where the browser has one,
  Download, Export PDF and Copy as HTML.
- **Print**: Ctrl+P opens File ▸ Print with a preview and page ranges; the
  browser's print dialog does the rest (choose "Save as PDF" for a PDF).
- **Protect**: File ▸ Info ▸ Protect Document encrypts the file with a
  password (AES-256, the way LibreOffice does it).
- **Fidelity**: anything the editor doesn't understand is kept and written
  back unchanged.

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
- Libraries bundled into the HTML file: ProseMirror incl. prosemirror-tables and prosemirror-collab (MIT), fflate (MIT),
  mammoth (BSD-2-Clause; fallback DOCX import), docx (MIT; DOCX export), marked (MIT; Markdown import),
  MathLive (MIT; the equation editor, with the KaTeX maths fonts, MIT),
  nspell (MIT) with the en-GB and en-US Hunspell dictionaries from
  wooorm/dictionaries (MIT AND BSD, from SCOWL),
  citeproc-js (CPAL-1.0 / AGPL-1.0; the citation engine) with Citation Style
  Language styles and locales (CC BY-SA 3.0: APA, MLA, Chicago author-date,
  IEEE, Cite Them Right Harvard),
  Lucide icons (ISC), hyphen (ISC) with British English hyphenation patterns
  from CTAN (hyph-en-gb), SheetJS Community Edition (Apache-2.0; reading
  spreadsheet recipient lists).

- Development only (not in the HTML file): esbuild, Playwright, axe-core (MPL-2.0; accessibility tests).

UI inspired by the open-source WordCraft project (MIT/Apache-2.0).

## Keyboard

Word-compatible (⌘ instead of Ctrl on macOS). Help ▸ Help (F1) lists every
shortcut, searchable.

- File: Ctrl+N new, Ctrl+O open, Ctrl+S save, F12 save as, Ctrl+P print, Ctrl+W close.
- Editing: Ctrl+Z / Ctrl+Y undo / redo, F4 repeat, Ctrl+A select all, F8 extend selection, Shift+F5 go back.
- Characters: Ctrl+B / I / U, Ctrl+= subscript, Ctrl+Shift+= superscript, Ctrl+] / [ grow / shrink, Shift+F3 change case, Ctrl+Space clear formatting, Ctrl+D font.
- Paragraphs: Ctrl+L / E / R / J align, Ctrl+1 / 2 / 5 line spacing, Ctrl+M / Ctrl+Shift+M indent, Ctrl+Q clear, Ctrl+Alt+1 / 2 / 3 headings, Ctrl+Shift+N Normal.
- Breaks: Ctrl+Enter page break, Shift+Enter line break.
- Find: Ctrl+F (Navigation pane), Ctrl+H replace, Ctrl+G go to.
- Insert: Ctrl+K link, Ctrl+Alt+M comment, Ctrl+Alt+F footnote, Alt+X Unicode.
- Review: Ctrl+Shift+E track changes, F7 spelling, Ctrl+* show ¶.
- Outline view: Alt+Shift+← / → promote / demote, Alt+Shift+↑ / ↓ move, Alt+Shift+= / − expand / collapse.
- AutoCorrect: smart quotes, dashes, (c) → ©, "1. " and "* " lists, capitalised sentences (File ▸ Options ▸ Proofing).


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

## Layout, headers and footers, Design

- Layout ▸ Margins / Orientation / Size / Columns apply to the current section
  (or the whole document when there is only one); the Page Setup dialog
  (launcher) offers both. Breaks ▸ Next Page / Even / Odd start a new section
  with its own page style; Continuous starts a column section.
- Double-click a header or footer to edit it (Esc to finish). Insert ▸ Page
  Number puts numbers at the top or bottom; Format Page Numbers sets the
  style and start value.
- Design ▸ Themes, Style Sets, Colours, Fonts and Paragraph Spacing restyle the
  document through its styles; Set as Default makes them the styles of new
  documents.
- Everything here is undoable with Ctrl+Z.

## Tables

- Insert ▸ Table: pick a size on the grid, or use Insert Table…, Draw Table,
  Convert Text to Table or Quick Tables. With the caret in a table the
  **Table Design** and **Layout** tabs appear.
- Tab moves to the next cell (and adds a row at the end), Shift+Tab goes back.
  Drag column borders or row bottoms to resize, or drag the column markers on
  the ruler. Drag across cells to select them, then Merge Cells.
- Table Design: styles gallery and style options, shading, borders, line
  style / weight / pen colour and the Border Painter (click cell edges; Esc
  stops). Table Layout: insert/delete, merge/split, split table, AutoFit, cell
  sizes, distribute, alignment, text direction, cell margins, sort, repeat
  header rows (they repeat on every page the table continues on), convert to
  text and formulas such as `=SUM(ABOVE)`.

## Pictures, shapes and other objects

- Insert ▸ Pictures (or drag a picture file onto the page, or paste one): it
  goes in line with text and the **Picture Format** tab opens. Drag the
  handles to resize (corners keep the proportions) or rotate; Wrap Text and
  Position make it float, then drag it or nudge it with the arrow keys.
  Crop shows crop handles (Esc to finish).
- Insert ▸ Shapes: pick a shape, then drag on the page (or click for a
  2.54 cm shape). Double-click a shape to type in it; **Shape Format** sets
  fill, outline, shadow and style. Text Box and WordArt work the same way.
- Layout ▸ Selection Pane lists every object: click to select, double-click
  to rename, the eye hides it.
- Ctrl+K inserts a link (web page, a heading or bookmark in this document,
  or an e-mail address); Ctrl+click follows it.
- Insert ▸ Equation opens the equation editor (type LaTeX-like maths or start
  from a built-in equation); Insert ▸ Chart builds a column, bar, line or pie
  chart from a small data grid. Both are saved as real ODF objects that
  LibreOffice can open and edit. Double-click either one to edit it again.
- Insert ▸ Symbol ▸ More Symbols searches characters by name or code; Alt+X
  turns a hex code before the caret into its character (and back).

## References

- References ▸ Table of Contents inserts a contents list built from the
  headings, with page numbers from the layout; Update Table refreshes it.
  Add Text sets a paragraph's level.
- Insert Footnote (Ctrl+Alt+F) / Insert Endnote (Ctrl+Alt+D): type the note
  at the bottom of the page (or the end of the document). The dialog
  launcher sets numbering (1, a, i…, restart per page or chapter, custom
  mark) and converts between footnotes and endnotes. Double-click a number to
  jump between the note and its reference.
- Manage Sources keeps your sources (import BibTeX, RIS or CSL JSON from
  Zotero, Mendeley, JabRef…). Insert Citation cites one; Style switches
  between APA, MLA, Chicago, IEEE and Harvard; Bibliography inserts the list.
  The Zotero tab does the same from a Zotero library export (the live Zotero
  connection isn't reachable from a page opened from disk).
- Insert Caption numbers figures, tables and equations; Insert Table of
  Figures lists them; Cross-reference points at headings, bookmarks, notes
  and captions. F9 updates fields.
- Mark Entry (Alt+Shift+X) marks index entries; Insert Index builds the index.

## Review

- Track Changes (Ctrl+Shift+E, or Editing ▾ Reviewing) records insertions,
  deletions, paragraph breaks and character formatting under your name (set
  it in Review ▸ Tracking ▸ launcher). Display for Review switches between
  Simple Markup, All Markup, No Markup and Original; Accept / Reject work on
  one change or all of them. Changes are saved as ODF tracked changes that
  LibreOffice shows too.
- New Comment (Ctrl+Alt+M) adds a balloon beside the text; reply, resolve or
  delete it there, or list all comments with the Comments button.
- Spelling and simple grammar are checked as you type (English, UK and US):
  right-click a red word for suggestions, or press F7 for the Editor pane.
  Language marks text as another language or as not to be checked.
- Read Aloud, Check Accessibility, Compare (into a new document with the
  differences as tracked changes) and Restrict Editing are on the Review tab.

## Draw

- Pick Pen, Pencil or Highlighter and draw on the page (mouse, touch or a
  pen — with a pen the line follows the pressure). Colour and thickness are
  remembered per pen; Add Pen saves your favourites. Esc puts the pen down.
- Eraser removes strokes; Lasso selects strokes to move (drag) or delete.
- Ink to Shape turns rough lines, arrows, rectangles, ellipses and triangles
  into neat shapes. Drawing Canvas inserts an area to sketch in; Ink Replay
  plays your strokes back.
- Drawings are saved as ordinary ODF drawing objects, so LibreOffice shows
  them.

## Mailings

- Select Recipients from a CSV, XLSX, XLS or ODS file, or type a new list;
  Edit Recipient List to filter, sort and choose recipients. The list is
  saved inside the document.
- Insert merge fields, an Address Block and a Greeting Line; Rules add
  If…Then…Else, Fill-in, Next Record, Merge Record # and Skip Record If.
- Preview Results steps through the recipients; Finish & Merge ▸ Edit
  Individual Documents makes one document with a copy per recipient.
- Envelopes and Labels make ready-to-print documents in common sizes.
- Merge fields are ODF database fields, so LibreOffice keeps them.

## Developer

- Content controls: rich text, plain text, picture, check box, combo box,
  drop-down list and date picker, with Properties (title, tag, locking,
  items, date format) and Design Mode. Restrict Editing ▸ Filling in forms
  allows changes only inside the controls. Controls are saved the way
  LibreOffice saves them.

## View

- Views: Read Mode (screen-sized columns, paged with the arrows), Print
  Layout, Web Layout, Outline (promote, demote, move, collapse, show level)
  and Draft. Focus shows just the document; Immersive Reader adds column
  width, page colour, line focus, text spacing, syllables and read aloud.
- The Navigation pane moves whole sections when you drag a heading, and
  shows thumbnails of the pages.
- Switch Modes gives dark pages in the dark theme.
- New Window opens the document again in another window, kept in sync as
  you type; Split shows two panes of one document; View Side by Side and
  Synchronous Scrolling compare two windows; Switch Windows, Arrange All and
  Full Screen.
- View ▸ Templates: seven templates, Save as Template (.ott).

## File ▸ Info, Options and Help

- **Info**: title, subject, author, keywords and comments (saved in the
  document); statistics; Inspect Document (comments, tracked changes, names
  of people, mail-merge data — with Remove); Version History (earlier states
  saved in this browser); Protect Document (password).
- **Options**: General (your name, initials, theme), Display, Proofing
  (spelling, AutoCorrect, your dictionary), Save (autosave interval, version
  history, writing straight to files), Language, Advanced (measurement units
  cm / mm / in / pt for rulers, spin boxes and dialogs; paste defaults),
  Customise Ribbon (show / hide tabs), Quick Access Toolbar (off by default).
- **Help**: keyboard shortcuts (F1), a feedback note kept in this browser,
  What's New and About (version and licences).

## Known limitations (v1.0)

Coming soon (dimmed controls with a "Coming soon" tooltip):
- Home: Clipboard pane, Phonetic Guide, Enclose Characters, Glow.
- Insert: Stock Images, Online Pictures (need an online service), New Drawing
  Canvas from the Shapes menu (use Draw ▸ Drawing Canvas), SmartArt, Page
  Number ▸ Page Margins, Drop Cap ▸ In Margin, Object (OLE), Ink Equation.
- Design: Effects. Layout: Edit Wrap Points, Group / Ungroup objects.
- Picture Format: Remove Background, Artistic Effects, Compress Pictures,
  Picture Layout, Crop to Shape. Shape Format: Edit Shape, Text Effects,
  Create Link.
- Mailings: Send Email Messages (needs a mail service).
- Review: Thesaurus (open thesauri are too big to bundle), Translate (needs an
  online service), Track Changes ▸ Just Mine, Show Markup ▸ Ink / Balloons,
  Compare ▸ Combine. View: Macros. Zotero: Add Note.

Other limitations:
- Layout: text wraps on one side of a floating object; objects anchored to the
  page in other files are kept but not drawn; a row taller than a page isn't
  split inside the row; a paragraph taller than a column isn't split inside a
  column region; a footnote too long for its page isn't continued.
- Review: paragraph formatting, table structure and edits inside text boxes,
  notes and comments aren't tracked; grammar checks are simple rules; only
  English is spell-checked.
- Draw: strokes can't be edited point by point; Ink to Math is unavailable.
- Mailings: only the first sheet of a workbook is read; no database or
  contacts sources; no custom label sizes.
- Import: DOCX is read directly (styles, fonts, page setup, sections,
  headers/footers, lists, tables, pictures, notes, comments, tracked changes),
  but floating pictures and text boxes are placed in line with the text,
  table-style banding and theme colours/effects aren't applied, fields other
  than page number / page count / hyperlink keep only their shown text, and
  charts, SmartArt and embedded objects are left out; if a file can't be read
  this way, a simpler import (text, styles, lists, tables, pictures) is used.
  RTF pictures are PNG / JPEG only. Export: DOCX headers and footers are plain
  text; HTML and Markdown keep the content, not the page layout.
- Printing uses the first page size for the browser's default and named page
  sizes for others; PDF bookmarks depend on the browser.
- Windows: Arrange All and Side by Side can only move windows the app opened
  (New Window); settings such as Restrict Editing aren't shared between
  windows.
- Password-protected documents are decrypted in the browser; their autosaves
  in this browser are not encrypted, and they keep no version history.
- The interface is in English (UK); other languages can be added in
  `src/i18n/`.

## Performance

Measured in headless Chromium (software rendering) by `tests/e2e/perf.spec.js`:
typing in a 100-page document takes about 3–4 ms per keystroke, in a 300-page
document about 10 ms; a 300-page document opens and lays out in under half a
second and saves in about 0.2 s.
