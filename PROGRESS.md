# Progress

The memory between sessions. Statuses: `todo`, `in progress`, `awaiting approval`, `approved`.

| Milestone | Status |
|---|---|
| M0 — Scaffold, build, test harness | awaiting approval |
| M1 — App shell and complete ribbon UI (visual match) | todo |
| M2 — Document model and ODT open/save | todo |
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
- **Reference screenshots: none supplied yet** (`reference/` is empty). M1 needs them for the pixel-close visual match.

## M0 — Scaffold, build, test harness (awaiting approval)

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
