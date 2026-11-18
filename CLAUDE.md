# ODT Editor — project brief

A full word processor for **OpenDocument Text (.odt)**, delivered as ONE self-contained static HTML file (`dist/odt-editor.html`) that works offline by opening it in a browser. No server, no uploads, no analytics. Everything happens locally.

**Product name:** "ODT Editor". It is defined once in `src/config.js`, so it can be changed in one place.

**Inspiration:** the look, ribbon and workflow of Microsoft Word, and the open-source WordCraft project (github.com/storytold/wordcraft, MIT/Apache-2.0), which is itself a Word-style editor. Copy the layout, controls, behaviour and feel as closely as possible, but use none of the branding:
- No WordCraft or ArtCraft names or logos, and no "Discord community" link.
- No Microsoft/Word/Office names, logos or icons. Use original Lucide-style SVG icons.
- The logo is a simple inline SVG: a page with a folded corner and a stylised "¶".

Work proceeds milestone by milestone (see MILESTONES.md). Only build what the current milestone asks for, but keep the architecture ready for the later ones.

## Milestone workflow (follow this exactly)

Progress is tracked in `PROGRESS.md` (create it if it's missing). It lists every milestone in MILESTONES.md, each with a status of `todo`, `in progress`, `awaiting approval` or `approved`, plus short notes: key decisions, known issues, and anything the user asked to change.

1. **At the start of every session**, read `PROGRESS.md` and `MILESTONES.md`, and look at every image in `reference/`.
   - If a milestone is `awaiting approval`, don't start new work. Remind the user what's waiting for review and how to test it.
   - Otherwise, take the first milestone that isn't `approved`.
2. **Do that milestone.** Use the prompt text in the matching code block in `MILESTONES.md` as your instructions, and plan before coding. Set it to `in progress`.
3. **When its Definition of done is met**, set it to `awaiting approval`, write its notes in `PROGRESS.md`, and commit. Then STOP and tell the user:
   - what was built
   - how to try it (open `dist/odt-editor.html`, and what to click)
   - known limitations
   - "Reply **approved** to continue to the next milestone (<name>), or tell me what to change."
4. **If the user asks for changes or attaches new screenshots**, save any new screenshots into `reference/` with descriptive names, make the changes, re-run the Definition of done, and ask for approval again.
5. **When the user replies "approved"** (or "continue", "next", "go", "looks good"), set the milestone to `approved`, commit, and start the next milestone immediately, from step 2.
6. Never start more than one milestone without approval. Never mark a milestone `approved` yourself.
7. Keep `PROGRESS.md` up to date, because it's the memory between sessions.
8. After the last milestone is approved, give a final report and stop.

## Reference screenshots = visual source of truth

`reference/` contains screenshots of how the UI must look. The user may add more at any time, in the chat or in the folder.
- Before building or changing ANY UI, open the relevant screenshots and match them: layout, grouping, control order, icon placement, label wording, spacing, sizes and colours.
- After building UI, take Playwright screenshots of it at the same viewport size and compare them side by side with the reference. Fix the differences before asking for approval. Save the comparisons to `reference/compare/` so the user can see them.
- If a screenshot shows a feature that this document doesn't mention, build it anyway. If it conflicts with this document, the screenshot wins.

---

## Architecture

- **Source** lives in `src/` as ES modules and CSS. **Build** uses `esbuild` (dev dependency): `npm run build` bundles everything, inlines all JS, CSS, fonts and icons, and writes ONE file, `dist/odt-editor.html`. The file must work offline from `file://`. No runtime CDN requests. Vendor every library into the bundle.
- **Editing core:** ProseMirror (prosemirror-model/state/view/transform/history/keymap/inputrules/commands/tables). Use a custom schema that maps 1:1 to the ODT concepts used: paragraphs and headings with paragraph styles, spans with character styles and direct formatting, lists, tables (merged cells, nested), frames (images, text boxes, shapes), notes, bookmarks, fields (page number, date, cross-refs, merge fields), annotations (comments), tracked changes, section/page breaks and sections.
- **Unknown ODT content** that the editor doesn't understand is preserved as opaque nodes and written back unchanged, so round-trips don't lose data.
- **ODT I/O:** read and write the zip with fflate.
  - Writing rules: `mimetype` must be the first entry and stored uncompressed; write `content.xml`, `styles.xml`, `meta.xml`, `settings.xml`, `META-INF/manifest.xml`, `Pictures/*` and a `Thumbnails/thumbnail.png`.
  - Follow ODF 1.3.
  - Automatic styles are generated from direct formatting and de-duplicated.
- **Layout engine:** "Print Layout" shows real pages. Use a single ProseMirror flow and paginate it with a layout layer that measures blocks and inserts page gaps (widgets/decorations), splitting long paragraphs and tables across pages. Each page shows its own header and footer, margins, page number, footnotes, columns and page borders. Pagination must be incremental: re-measure only from the edited block onward, so typing stays fast on 100+ page documents.
- **Folders:**
  - `core/`: schema, commands, ODT import/export, styles model, document state, autosave
  - `layout/`: pagination, rulers, measurement
  - `ui/`: ribbon framework, backstage, dialogs, panes, status bar, context menus
  - `features/`: one folder per ribbon tab
  - `i18n/`: all user-facing strings, English (UK) default
- **Command registry:** every action is a command with an id, label, icon, shortcut, enabled/checked state and `run()`. The ribbon, menus, shortcuts, the "Search" command box (Alt+Q) and tests all call commands. Commands that aren't built yet show disabled, with a "Coming soon" tooltip.
- **Fonts:** list the system fonts via the Local Font Access API when it's permitted, otherwise use a curated list. Bundle the open metric-compatible fonts (Carlito, Caladea, Liberation Sans/Serif/Mono) so documents lay out consistently. Default body font: Aptos if installed, otherwise Carlito, at 12 pt.
- **Units:** cm by default (an Options setting allows in/pt/mm), as in the screenshots.

## Testing

- `tests/fixtures/` contains ODT files generated by a script: the formatting zoo, styles, lists, tables (merged cells), images, headers/footers, footnotes, a TOC, comments, tracked changes, sections/columns, plus at least one real-world file exported from LibreOffice (the user may provide some).
- Round-trip tests: open → save → re-open must give an identical document model. If `soffice` (LibreOffice) is installed, also convert the output with it headlessly, to prove that real software opens the file.
- Playwright (Chromium) e2e tests run against `dist/odt-editor.html`.
- Definition of done for every milestone:
  - `npm run build` succeeds
  - all tests pass
  - no console errors
  - screenshots compared against `reference/`, in dark and light themes
  - performance check: typing latency under 16ms on a 50-page document
  - git commit
- Fix the code, not the tests (unless a test is wrong).

## Visual spec (from the reference screenshots; dark theme shown, light theme required too)

**Overall:** dark UI.
- App/ribbon background: about #1f1f1f, with ribbon panels about #252525.
- The canvas around pages is near-black (about #141414). Pages are white with a subtle shadow.
- Text: about #e8e8e8. Muted group labels: about #a0a0a0.
- **Accent: periwinkle blue (about #7c8cf8).** It's used for the active-tab underline and the "100" zoom glyph. The Share button is filled with a slightly deeper blue (about #5b6ee1).
- Font: Segoe UI-like system stack, 13px.

The light theme mirrors this with a white/#f3f3f3 ribbon and a #e9e9e9 canvas.

**Top row (tab bar):** File, Home, Insert, Draw, Design, Layout, References, Mailings, Review, View, Developer, Help.
- The active tab has accent text and a 2–3px accent underline.
- File opens the backstage instead of a ribbon.
- Right side: a "Comments" button (with icon), an "Editing ▾" mode dropdown (Editing / Reviewing = track changes on / Viewing = read-only), and a filled accent "Share" button (Web Share API with the .odt file, otherwise a menu of Download .odt / Export PDF / Copy as HTML).

**Ribbon:**
- A single row of **groups**, each with its label centred underneath (Clipboard, Font, Paragraph…). Groups are separated by thin vertical dividers.
- Groups with a dialog have a small **dialog launcher ↘** in the bottom-right corner.
- Control types:
  - large buttons (32px icon above a 1–2 line label, optional ▾)
  - small buttons with icon + label stacked 3 high
  - icon-only toggle buttons
  - split buttons (action + ▾ menu)
  - combo boxes (font name, size)
  - spin inputs (cm/pt)
  - checkboxes
  - galleries (Styles), with scroll ▲▼ and a "more" ⋯ to expand
- Disabled controls are dimmed (about 40%).
- Hover: subtle lighter background. Pressed/checked: an accent-tinted background with an accent border, like the "Select" button on the Draw tab.
- The ribbon collapses (Ctrl+F1), and double-clicking a tab toggles it. With a narrow window, groups collapse to a single dropdown button, right-most first, like Word.
- KeyTips: pressing Alt shows letters over tabs and controls.

**Ribbon tabs and controls (build all of them as UI in M1, wire them up in later milestones):**

- **Home**
  - Clipboard: Paste (large split), Cut, Copy, Format (Painter)
  - Font: font combo (with a ⚠ badge when the font is missing), size combo, Grow/Shrink, Change Case ▾, Clear Formatting, a Text Effects icon; B, I, U ▾, abc strikethrough, x₂, x², a character-border/box icon, an enclosed-character icon, Text Effects A ▾, Highlight ▾, Font Colour ▾
  - Paragraph: Bullets ▾, Numbering ▾, Multilevel ▾, Decrease/Increase Indent, Sort, Show ¶; Align Left/Centre/Right/Justify, LTR/RTL, Line & Paragraph Spacing ▾, Shading ▾, Borders ▾
  - Paragraph Tools (large ▾)
  - Styles: a live gallery of Normal, No Spacing, Heading 1, Title, Heading 2, Subtitle… each rendered in its own style, with a launcher for the Styles pane
  - Editing: Find ▾, Replace, Select ▾
  - Voice: Dictate (Web Speech API; disabled if unsupported)
  - Editor: Editor (spelling & grammar panel)
- **Insert**
  - Pages: Cover Page ▾, Blank Page, Page Break
  - Tables: Table ▾ (grid picker + Insert Table… / Draw Table / Convert Text to Table / Quick Tables)
  - Illustrations: Pictures ▾, Shapes ▾, Icons, SmartArt, Chart
  - Links: Link, Bookmark, Cross-reference
  - Comments: Comment
  - Header & Footer: Header ▾, Footer ▾, Page Number ▾
  - Text: Text Box, Quick Parts ▾, WordArt ▾, Drop Cap ▾, plus small Signature Line / Date & Time / Object icons
  - Symbols: Equation ▾ (π), Symbol ▾ (Ω)
- **Draw**
  - Drawing Tools: Select, Lasso, Eraser, Pen, Pencil, Highlighter, Add Pen ▾, plus the pen colour (A) and thickness controls
  - Convert: Ink to Shape, Ink to Math (disabled)
  - Insert: Drawing Canvas
  - Replay: Ink Replay
- **Design:** Themes, Style Sets gallery, Colours, Fonts, Paragraph Spacing ▾, Effects, Set as Default; Page Background: Watermark ▾, Page Colour ▾, Page Borders
- **Layout**
  - Page Setup: Text Direction ▾, Margins ▾, Orientation ▾, Size ▾, Columns ▾, Breaks ▾, Line Numbers ▾, Hyphenation ▾
  - Paragraph: Indent Left/Right (cm spin), Spacing Before/After (pt spin)
  - Arrange (disabled until an object is selected): Position ▾, Wrap Text ▾, Bring Forward ▾, Send Backward ▾, Selection Pane, Align ▾, Group ▾, Rotate ▾
- **References:** Table of Contents ▾ / Add Text ▾ / Update Table; Insert Footnote, Insert Endnote, Next Footnote ▾, Show Notes; Insert Citation ▾, Manage Sources, Style ▾ (APA/MLA/Chicago/IEEE/Harvard), Bibliography ▾; Insert Caption, Insert Table of Figures, Update Table, Cross-reference; Mark Entry, Insert Index, Update Index
- **Mailings:** Envelopes, Labels; Start Mail Merge ▾, Select Recipients ▾ (CSV/XLSX/type a new list), Edit Recipient List; Highlight Merge Fields, Address Block, Greeting Line, Insert Merge Field ▾, Rules ▾; Preview Results with ◀ record ▶, Find Recipient; Finish & Merge ▾
- **Review:** Spelling & Grammar, Thesaurus, Word Count; Read Aloud; Check Accessibility; Translate (Coming soon); Language ▾; New Comment, Delete ▾, Previous, Next, Show Comments ▾; Track Changes ▾, Display for Review ▾ (Simple/All Markup/No Markup/Original), Show Markup ▾, Reviewing Pane ▾; Accept ▾, Reject ▾, Previous, Next; Compare ▾; Restrict Editing
- **View:** exactly as in the screenshot.
  - Views: Read Mode, Print Layout, Web Layout, Outline, Draft
  - Immersive: Focus, Immersive Reader
  - Page Movement: Vertical, Side to Side
  - Show: Ruler, Gridlines, Navigation Pane, Hide White Space (checkboxes)
  - Zoom: Zoom, 100%, Zoom In, Zoom Out, One Page, Multiple Pages, Page Width
  - Dark Mode: Switch Modes (light/dark page while the UI stays dark), Interface Theme ▾ (Dark/Light/System)
  - Window: New Window, Arrange All, Split, View Side by Side, Synchronous Scrolling, Switch Windows ▾, Full Screen
  - Macros: Macros (Coming soon)
  - Templates: Templates
- **Developer:** Content controls (Rich Text, Plain Text, Check Box, Combo Box, Drop-Down List, Date Picker, Picture), Design Mode, Properties; Restrict Editing
- **Help:** Help (keyboard shortcuts sheet), Feedback (opens a local note), What's New, About

**Rulers:** a horizontal ruler above the page, with cm ticks and numbers, the margin areas shaded, draggable first-line/hanging/left indent markers and a right indent marker, tab stops (click to add, drag off to remove), and table column markers. A vertical ruler runs down the left side. A tab selector sits in the top-left corner (L ⊥ ⅃ decimal bar, first-line, hanging).

**Status bar (bottom):**
- Left: "Page X of Y", "N words" (clicking it opens Word Count), the language ("English (United Kingdom)"; clicking it opens the Language dialog).
- Right: Focus, then the Read / Print / Web layout view buttons, a zoom slider with − and +, and the zoom %.
- It can be customised by right-clicking, like Word.

**Backstage (File):** full-window.
- A left navigation column in **indigo/navy (about #283070)** with a ‹ back arrow and: Home, New, Open, Info, Recover, Save, Save As, Print, Export, Close, Options. Each has a line icon, and the active item gets a lighter highlight. "About" sits at the bottom. There is NO Discord link.
- The **Home** page shows a time-based greeting ("Good morning/afternoon/evening") and a row of template thumbnails (Blank document, Studio handbook (sample — write original sample content), Letter, Résumé) as real rendered page previews with captions, then "More templates →", "Recent" (from IndexedDB, with pin/remove) and the empty-state text "Documents you open will show up here."
- **Info:** document properties (title, subject, author, keywords, comments, stats), Inspect Document, Protect (password-protected ODT if feasible, otherwise Coming soon), Version history (autosaves).
- **Recover:** autosaved/unsaved documents.
- **Print:** a print preview with settings.
- **Export:** ODT, PDF (via print with tagged headings/links where the browser allows), DOCX, HTML, Markdown, RTF, TXT; also "Export page as PNG".
- **Options:** General (name/initials, theme), Display, Proofing (AutoCorrect options), Save (autosave interval), Language, Advanced (units), Customise Ribbon (show/hide tabs), Quick Access Toolbar.

**Other UI:**
- A Quick Access Toolbar (optional, off by default) for Save, Undo, Redo.
- Floating mini-toolbar on text selection, and right-click context menus that match Word's.
- Panes dock on the right or left and are resizable: Navigation (Headings / Pages / Results), Styles, Comments, Reviewing, Selection, Editor (spelling), Immersive Reader.

## Keyboard shortcuts (Word-compatible; ⌘ on macOS)

- File: Ctrl+N new, Ctrl+O open, Ctrl+S save, F12 save as, Ctrl+P print, Ctrl+W close
- Editing: Ctrl+Z/Y undo/redo, F4 repeat
- Character formatting: Ctrl+B/I/U, Ctrl+= subscript, Ctrl+Shift+= superscript, Ctrl+]/[ grow/shrink font, Shift+F3 change case, Ctrl+Space clear character formatting
- Paragraph: Ctrl+L/E/R/J align, Ctrl+1/2/5 line spacing, Ctrl+M / Ctrl+Shift+M indent, Ctrl+Q clear paragraph formatting, Ctrl+Alt+1/2/3 headings, Ctrl+Shift+N Normal
- Breaks: Ctrl+Enter page break, Shift+Enter line break
- Find: Ctrl+F (Navigation pane search), Ctrl+H replace, Ctrl+G go to
- Insert: Ctrl+K link, Ctrl+Alt+M comment, Ctrl+Alt+F footnote
- Review and display: Ctrl+Shift+E track changes, F7 spelling, Ctrl+* show ¶
- Navigation: Alt+Q command search, Alt KeyTips, Shift+F5 go back, Alt+X Unicode toggle, F8 extend selection
- AutoCorrect: smart quotes, dashes, "1. " auto-numbering, "* " auto-bullets, (c) → ©, and capitalise the first letter of sentences

## Non-negotiables

- **ODT fidelity first:** files saved by this app open correctly in LibreOffice Writer and keep everything the user made. Unknown content survives round-trips.
- **No fake features:** if something can't be done properly, its control is disabled with a "Coming soon" tooltip, and the gap is listed in the README.
- **Never lose work:** autosave to IndexedDB (every 30s plus on blur), crash recovery via Backstage → Recover, unsaved-change prompts, and a beforeunload guard.
- **Accessibility:** fully keyboard operable (KeyTips, F6 cycles regions), ARIA roles for the ribbon/tabs/menus/dialogs, visible focus, and WCAG AA contrast in both themes.
- **Help → About:** the app name, version, the licenses of the bundled libraries and fonts, and the line "UI inspired by the open-source WordCraft project (MIT/Apache-2.0)."
