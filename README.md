# ODT Editor

A full word processor whose **default format is Word's `.docx`**, running
entirely in your browser from **one self-contained HTML file**:
`dist/odt-editor.html`. OpenDocument Text (`.odt`) is fully supported too.
No server, no uploads, no analytics — open the file (even from `file://`, even
offline) and everything happens locally.

> **Version 1.0.0.** A complete Word-style editor: every ribbon tab (Home,
> Insert, Draw, Design, Layout, References, Mailings, Review, View,
> Developer, Help) with real pages, rulers and zoom; it opens and saves Word
> documents, OpenDocument text, Word XML, web pages and plain text (and opens
> RTF and Markdown; exports Markdown, RTF and page pictures), autosaves, keeps
> a version history and encrypts documents with a password. The few controls
> that aren't built are dimmed with a "Coming soon" tooltip and listed under
> [Known limitations](#known-limitations-v10).

## Working with files

- **Formats** (File ▸ Save As ▸ Save as type, the same list as Word for
  Windows): Word Document (*.docx, the default), OpenDocument Text (*.odt),
  Word XML Document (*.xml, Flat OPC), Web Page (*.htm; *.html), Plain Text
  (*.txt), PDF (*.pdf) and XPS Document (*.xps). Options ▸ Save ▸ "Save
  files in this format" makes new documents save as `.odt` instead.
- **PDF and XPS** are written by the app itself from the laid-out pages (no
  print dialog): real, searchable text in embedded subset fonts, vector
  lines and shapes, the original pictures, links, bookmarks from the
  headings, document properties and, for PDF, tags for screen readers and
  an optional PDF/A-2b archive mode. Save As ▸ More options… chooses the
  pages (all, current, selection, from–to), "Document" or "Document
  showing markup" (comments as PDF notes), and for PDF bookmarks,
  properties, tags, PDF/A and Minimum size (pictures at 150 dpi). Saving as
  PDF or XPS writes a copy: the document stays attached to its .docx/.odt.
  Fonts that can't be embedded (a system font the browser may not read) are
  replaced by their metric-compatible bundled font, and a message says so
  ("Calibri was replaced by Carlito"); allow "local fonts" for the page in
  Chromium to embed your installed fonts instead.
- **Open**: Ctrl+O, drag a file onto the window, or File ▸ Open / Recent.
  `.docx`, `.odt`, Word XML / flat ODT `.xml`, web pages and text files open
  *as that file*: Save writes back to it in the same format (through the
  file itself in Chromium-based browsers). RTF and Markdown open as new
  documents. Templates (`.dotx`, `.ott`) start new documents.
  Password-protected Word (Agile and Standard encryption) and ODT files ask
  for their password.
- **Save**: Ctrl+S or Shift+F12. A new document goes to Save As. **Save As**:
  F12, Alt+F, A or File ▸ Save As — a file name, the "Save as type" list,
  More options… and Save; in Chromium the save picker opens, elsewhere the
  file is downloaded. Saving as Web Page or Plain Text first lists what will
  be lost (Keep current format / Save as Word Document / Cancel, Don't ask
  again). Plain Text asks for an encoding (UTF-8, UTF-8 with BOM, UTF-16
  LE/BE, Windows-1252, ISO-8859-1, US-ASCII), line endings and character
  substitution, with a preview that marks characters the encoding can't hold.
  A web page keeps the whole document inside it, so this app reopens it
  without loss (More options… can turn that off).
- **Word documents you didn't create keep everything**: parts the editor
  doesn't use (themes, fonts, custom XML, building blocks, embedded files,
  charts, comment extensions…), content it doesn't model (it is kept and
  written back in place) and the original XML of everything you didn't edit.
  File ▸ Info ▸ Check for Issues ▸ Check Compatibility lists what another
  format can't keep.
- **Never lose work**: the document is autosaved in this browser every 30
  seconds and whenever you switch away; File ▸ Recover brings back anything
  that wasn't saved. You are asked before unsaved changes are discarded.
- **Export**: File ▸ Export saves a copy in any of the formats above, as
  Markdown or RTF, or the current page as a PNG picture. Share offers the
  system share sheet where the browser has one, Download a copy, Export PDF
  and Copy as HTML.
- **Print**: Ctrl+P opens File ▸ Print with a preview and page ranges; the
  browser's print dialog does the rest. For a PDF, use Save As ▸ PDF.
- **Protect**: File ▸ Info ▸ Protect Document encrypts the file with a
  password: Word documents with AES-256 (as Word does, readable by Word and
  LibreOffice), ODT the way LibreOffice does it. Web pages, text and Word XML
  can't hold a password: you are offered DOCX or ODT.

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
- Bundled fonts: Carlito, Caladea, Liberation Sans/Serif/Mono, and Selawik
  (the interface font where Segoe UI isn't installed) — SIL Open Font
  License 1.1 (see `assets/fonts/LICENSE.md`).
- Libraries bundled into the HTML file: ProseMirror incl. prosemirror-tables and prosemirror-collab (MIT), fflate (MIT),
  mammoth (BSD-2-Clause; fallback DOCX import), marked (MIT; Markdown import),
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
- Insert ▸ SmartArt: a basic process, vertical list or cycle diagram made
  from the items you type (one per line), as a drawing group of rounded
  boxes with their text and arrows (LibreOffice shows and edits it).
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
- Import: DOCX is read directly and laid out by Word's rules (styles with
  docDefaults and toggle properties, fonts, page setup and sections with
  inherited / first-page / even headers and footers, per-section columns with
  separators, positional tabs and tab stops measured from the margin, natural
  line height, added paragraph spacing, border spacing and grouping, lists
  with their label formatting, tables with cell margins, vertical text and
  Word's border-conflict rule, floating pictures and text boxes, notes,
  comments, tracked changes, TOC fields). Still not matched: text wraps on one
  side of a floating picture (Word can wrap on both sides); a picture placed
  relative to the page vertically is placed relative to its paragraph;
  table-style banding and theme colours/effects aren't applied; equations,
  charts, SmartArt and Word shapes made in Word are kept and written back
  unchanged but shown as a placeholder, not edited. RTF pictures are PNG /
  JPEG only.
- DOCX export (see PROGRESS.md, M15): equations are written as Word
  equations (OMML); charts, shapes, WordArt, ink, drawing canvases and
  SmartArt are written as pictures Word shows, with the objects themselves
  kept in the file so this app reopens them editable; image watermarks aren't
  written for Word (text watermarks are). HTML and Markdown keep the content,
  not the page layout.
- PDF and XPS (see PROGRESS.md, M16): text is placed glyph by glyph where
  the browser drew it, but complex-script shaping (Arabic joining, Indic
  conjuncts, ligatures) isn't redone: such text uses the font's plain
  glyphs. Characters no bundled font has (CJK, colour emoji) are drawn as
  300 dpi pictures carrying their text. Blurred text shadows are drawn
  sharp. XPS can't stroke text, so outlined text becomes outline paths over
  invisible text.
- Printing uses the first page size for the browser's default and named page
  sizes for others.
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
