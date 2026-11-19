/**
 * Icons: line icons in the Lucide style, 24×24, stroke = currentColor.
 * Most come from the `lucide` package (ISC; tree-shaken by esbuild, so only
 * the icons imported here are bundled). Icons that need a second tone (the
 * accent blue, or a red/yellow colour bar like the reference screenshots) are
 * drawn here as original node lists.
 *
 * Node format: [tag, attrs, text?]. Classes inside icons:
 *   a  accent stroke     af accent fill     f  currentColor fill
 *   rf red fill          yf yellow fill     pf pink fill        gf green stroke
 */
import {
  CirclePlus, CircleMinus, Pin,
  AArrowDown, AArrowUp, Accessibility, AlignCenter, AlignHorizontalJustifyStart, AlignJustify, AlignLeft, AlignRight,
  ArrowDownAZ, ArrowLeft, ArrowRight, ArrowRightLeft, BadgeCheck, BookA, BookOpen, BookOpenText, Bookmark, Box,
  Braces, BringToFront, CalendarClock, CalendarDays, Captions, CaseSensitive, ChevronDown, ChevronFirst, ChevronLast,
  ChevronLeft, ChevronRight, ChevronUp, CirclePlay, CircleHelp, Clipboard, ClipboardCheck, ClipboardList,
  ClipboardType, Contact, Copy, Download, Eye, File, FileCheck, FileClock, FileDiff, FileOutput, FilePen, FilePlus,
  FileText, FileX, Files, FolderOpen, Gift, GitBranch, Globe, Group, House, ImagePlus, IndentDecrease,
  IndentIncrease, Info, Keyboard, Languages, LetterText, Library, Link, List, ListChecks, ListOrdered, ListTree,
  LockKeyhole, Mail, MailCheck, Mails, MessageSquareHeart, MessageSquareText, MessageSquareX, MessagesSquare, Mic,
  Minus, Monitor, Moon, Network, Omega, PaintBucket, Palette, PanelRight, Pilcrow, Plus, Printer, Quote, RefreshCw,
  RotateCw, Ruler, Save, ScanEye, Search, SendToBack, Settings, Settings2, Share, Signature, Smile, Sparkles, Speech,
  SpellCheck, SquareCheck, SquareChevronDown, SquareDashed, StickyNote, Sun, SwatchBook, TableOfContents, Tags, Type,
  Undo2, Redo2, Unlink, UserPen, UserSearch, Users, Volume2, WrapText, X, ZoomIn, ZoomOut, Scissors, Lasso, Radical,
  Puzzle, DraftingCompass,
  ImageOff, SunDim, Paintbrush, WandSparkles, Blend, Shrink, ImageUp, RotateCcw, Frame, Layers, Crop, MoveVertical,
  MoveHorizontal, PenTool, PenLine, AlignVerticalJustifyCenter, ImageMinus, Image, Shapes, Pause, Play, TriangleAlert, CircleX,
} from 'lucide';
import { LOGO_SVG } from './logo.js';

// ------------------------------------------------------------- node helpers
const P = (d, cls) => ['path', cls ? { d, class: cls } : { d }];
const R = (x, y, width, height, rx = 0, cls) => ['rect', { x, y, width, height, ...(rx ? { rx } : {}), ...(cls ? { class: cls } : {}) }];
const C = (cx, cy, r, cls) => ['circle', { cx, cy, r, ...(cls ? { class: cls } : {}) }];
const L = (x1, y1, x2, y2, cls) => ['line', { x1, y1, x2, y2, ...(cls ? { class: cls } : {}) }];
const T = (x, y, text, size = 10, cls = 'f', extra = {}) => ['text', { x, y, 'font-size': size, class: `${cls} it`, 'text-anchor': 'middle', ...extra }, text];
const PAGE = P('M6 2h9l4 4v16H6z'); // portrait page outline with folded corner
const FOLD = P('M15 2v4h4');
const lines = (x1, x2, ys, cls) => ys.map((y) => L(x1, y, x2, y, cls));
const colourBar = (cls) => R(3, 19.5, 18, 3.5, 0.5, cls);

const TXT = (text, extra = {}, cls = 'f') => T(12, 18.5, text, 18, cls, extra);
const CUSTOM = {
  bold: [TXT('B', { 'font-weight': 700 })],
  italic: [TXT('I', { 'font-style': 'italic', 'font-family': 'Georgia, serif' })],
  underline: [T(12, 17, 'U', 17, 'f'), L(5.5, 21, 18.5, 21)],
  strikethrough: [T(12, 17, 'ab', 14.5, 'f'), L(3, 12.5, 21, 12.5)],
  subscript: [T(9.5, 16, 'x', 17, 'f'), T(18.5, 21.5, '2', 9, 'af')],
  superscript: [T(9.5, 19, 'x', 17, 'f'), T(18.5, 10, '2', 9, 'af')],
  paste: [R(4, 4, 14, 18, 2), R(8, 2, 6, 4, 1, 'f'), P('M10 9h10v13H10z', 'pagefill'), ...[12.5, 15.5, 18.5].map((y) => L(12.5, y, 17.5, y, 'a'))],
  replace: [T(7.5, 9, 'ab', 7.5, 'f'), P('M14 5h3v4m-1.5-1.5L17 9l1.5-1.5', 'a'), T(16, 20, 'ac', 7.5, 'af')],
  'paragraph-tools': [T(12, 19, '¶', 19, 'f', { 'font-weight': 700 })],
  // --- Clipboard / font
  'format-painter': [R(4, 3, 14, 6, 1.5, 'yf'), P('M18 6h2v5h-8v3'), R(10.5, 14, 3, 8, 1, 'f')],
  'clear-formatting': [P('M4 17 9 4l5 13M6 12.5h6'), P('m13.5 15 4-4 4 4-4 4z', 'pf')],
  'phonetic-guide': [T(12, 8, 'abc', 7.5, 'af'), P('M7 21 12 10l5 11M8.8 17.5h6.4')],
  'char-border': [R(3.5, 3.5, 17, 17, 1.5), P('M8 17 12 7l4 10M9.5 13.5h5')],
  'enclosed-char': [C(12, 12, 9), P('M9 16.5 12 8l3 8.5M10 13.8h4')],
  'text-effects': [P('M5 20 12 3l7 17M7.8 14h8.4', 'a')],
  highlight: [P('m9 11-6 6v2h5l6-6'), P('m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'), colourBar('yf')],
  'font-colour': [P('M6 16 12 2l6 14M8.3 11h7.4'), colourBar('rf')],
  'shape-fill': [P('m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z'), P('M5 2l5 5'), P('M2 13h15'), colourBar('af')],
  'shape-outline': [P('M13 3.5 19.5 10 9 20.5H2.5V14z'), P('m11 5.5 6.5 6.5'), colourBar('af')],
  'shape-effects': [R(3, 3, 13, 13, 2), P('M8 21h11a2 2 0 0 0 2-2V8', 'a')],
  'text-fill': [P('M6 16 12 2l6 14M8.3 11h7.4'), colourBar('af')],
  'text-outline': [P('M5 18 11 3h2l6 15h-3l-1.6-4H9.6L8 18z', 'a'), P('M10.4 11h3.2L12 7z', 'a')],
  'alt-text': [R(2.5, 5, 19, 14, 2), T(12, 15.5, 'Alt', 8, 'f', { 'font-weight': 700 })],
  'line-spacing': [...lines(11, 21, [5, 10, 15, 20]), P('m3 7 3-3 3 3M6 4v16M3 17l3 3 3-3')],
  shading: [P('m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z'), P('M5 2l5 5'), P('M2 13h15'), colourBar('yf')],
  borders: [R(3, 3, 18, 18, 0, 'dots'), L(3, 12, 21, 12, 'dots'), L(12, 3, 12, 21, 'dots')],
  'border-bottom': [R(3, 3, 18, 18, 0, 'dots'), L(3, 21, 21, 21)],
  'border-top': [R(3, 3, 18, 18, 0, 'dots'), L(3, 3, 21, 3)],
  'border-left': [R(3, 3, 18, 18, 0, 'dots'), L(3, 3, 3, 21)],
  'border-right': [R(3, 3, 18, 18, 0, 'dots'), L(21, 3, 21, 21)],
  'border-none': [R(3, 3, 18, 18, 0, 'dots')],
  'border-outside': [R(3, 3, 18, 18), L(3, 12, 21, 12, 'dots'), L(12, 3, 12, 21, 'dots')],
  ltr: [...lines(3, 15, [5, 10, 15]), P('M3 20h16m-3-3 3 3-3 3', 'a')],
  rtl: [...lines(9, 21, [5, 10, 15]), P('M21 20H5m3-3-3 3 3 3', 'a')],
  editor: [T(12, 10, 'abc', 9, 'f', { 'font-weight': 700 }), P('m6 16 4 4 8-8', 'gf')],
  dictate: [R(9, 2, 6, 12, 3), P('M19 10v1a7 7 0 0 1-14 0v-1M12 18v4')],
  // --- Insert
  'cover-page': [PAGE, FOLD, R(8, 8, 9, 5, 0, 'af'), ...lines(8, 16, [16, 19])],
  'blank-page': [PAGE, FOLD],
  'page-break': [P('M6 2h12v7H6zM6 15h12v7H6z'), L(3, 12, 21, 12, 'a dash')],
  table: [R(3, 3, 18, 18, 1.5), L(3, 9, 21, 9), L(3, 15, 21, 15), L(9, 3, 9, 21), L(15, 3, 15, 21), R(3, 3, 18, 6, 1.5, 'af')],
  'draw-table': [R(3, 3, 14, 14, 1), L(3, 10, 17, 10), L(10, 3, 10, 17), P('m15 21 6-6-2-2-6 6v2z', 'a')],
  pictures: [R(3, 3, 18, 18, 2), C(9, 9, 2, 'a'), P('m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21', 'a')],
  shapes: [R(3, 3, 11, 11, 1), C(16, 16, 5.5, 'af')],
  chart: [L(3, 21, 21, 21), R(5, 12, 3, 9, 0, 'af'), R(10.5, 6, 3, 15, 0, 'rf'), R(16, 9, 3, 12, 0, 'yf')],
  'cross-reference': [P('M4 4h8v8H4z'), P('M12 12h8v8h-8z'), P('M8 12v4h4M16 12V8h-4', 'a')],
  comment: [P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), P('M12 7v6M9 10h6', 'a')],
  header: [PAGE, FOLD, R(8, 5, 6, 3, 0, 'af'), ...lines(8, 16, [12, 15, 18])],
  footer: [PAGE, FOLD, ...lines(8, 16, [7, 10, 13]), R(8, 16.5, 8, 3, 0, 'af')],
  'page-number': [PAGE, FOLD, T(12.5, 18, '#', 10, 'af', { 'font-weight': 700 })],
  'text-box': [R(3, 3, 18, 18, 1.5), P('M8 17 12 7l4 10M9.5 13.5h5', 'a')],
  'quick-parts': [R(3, 4, 8, 7, 1), R(13, 4, 8, 7, 1, 'a'), R(3, 13, 18, 7, 1)],
  wordart: [P('M4 20 10 4h1l6 16M6.5 14h8', 'a'), P('M17 4l3 3-3 3')],
  'drop-cap': [T(7, 12, 'A', 11, 'f', { 'font-weight': 700 }), ...lines(13, 21, [4, 8, 12]), ...lines(3, 21, [16, 20])],
  'date-time': [R(3, 4, 18, 17, 2), L(3, 9, 21, 9), L(8, 2, 8, 6), L(16, 2, 16, 6), R(6.5, 12, 3, 3, 0, 'af')],
  object: [R(3, 3, 18, 18, 1.5), R(7, 7, 10, 10, 0, 'af')],
  equation: [P('M5 6h14M9 6v13M15 6v10c0 2 1 3 3 3', 'a')],
  // --- Draw
  'draw-select': [P('M4 3l7.5 18 2.5-7.5L21.5 11z', 'f')],
  eraser: [P('m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'pf'), P('M22 21H7M5 11l9 9')],
  pen: [P('M12 21 4 13l3-3 8 8z'), P('m15 6 3 3', 'a'), P('M7 10 17 2l5 5-8 8')],
  pencil: [P('M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z'), P('m15 5 4 4', 'a')],
  'highlighter-pen': [P('m9 11-6 6v3h9l3-3'), P('m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'), colourBar('yf')],
  'add-pen': [P('M12 21 4 13l3-3 8 8z'), P('M7 10l8-6 4 4-4 5'), P('M19 2v6M16 5h6', 'a')],
  'pen-colour': [P('M7 15 12 3l5 12M9 11h6'), colourBar('f')],
  'pen-thickness': [L(3, 5, 21, 5), ['line', { x1: 3, y1: 11, x2: 21, y2: 11, 'stroke-width': 2.5 }], ['line', { x1: 3, y1: 18, x2: 21, y2: 18, 'stroke-width': 4, class: 'a' }]],
  'ink-to-shape': [P('M3 12c3-6 6 2 9-3', 'a'), R(13, 11, 8, 8, 1)],
  'ink-to-math': [P('M3 9l2 2 2-4M10 13l3 6 4-14h4')],
  'drawing-canvas': [R(3, 4, 18, 15, 1.5), P('m6 15 4-5 3 3 5-6', 'a')],
  'ink-replay': [C(12, 12, 9, 'a'), P('m10 8 6 4-6 4z', 'af')],
  // --- Design
  themes: [R(3, 3, 18, 18, 2), R(6, 6, 5, 5, 0, 'af'), R(13, 6, 5, 5, 0, 'rf'), R(6, 13, 5, 5, 0, 'yf'), R(13, 13, 5, 5, 0, 'f')],
  fonts: [P('M3 19 8 5l5 14M4.8 14h6.4'), P('M14 19l3.5-9 3.5 9M15.2 16h4.6', 'a')],
  'paragraph-spacing': [...lines(9, 21, [6, 10, 14, 18]), P('m3 6 2.5-3L8 6M5.5 3v18M3 18l2.5 3L8 18', 'a')],
  effects: [C(9, 14, 6), C(15, 10, 6, 'a')],
  'set-default': [P('M20 6 9 17l-5-5', 'gf')],
  watermark: [PAGE, FOLD, P('M8 18 17 8', 'a')],
  'page-colour': [PAGE, FOLD, R(8, 9, 8, 9, 0, 'af')],
  'page-borders': [R(4, 2, 16, 20, 1), R(7, 5, 10, 14, 0, 'a dash')],
  // --- Layout
  'text-direction': [P('M3 17 7 5l4 12M4.3 13h5.4'), P('M17 4v16m-3-3 3 3 3-3', 'a')],
  margins: [PAGE, FOLD, R(8.5, 6, 7.5, 12.5, 0, 'a dash')],
  orientation: [R(3, 2, 10, 14, 1), R(8, 12, 13, 10, 1, 'a')],
  'page-size': [R(6, 2, 12, 20, 1), R(9, 8, 9, 14, 0, 'a')],
  columns: [...lines(3, 10, [5, 9, 13, 17, 21]), ...lines(14, 21, [5, 9, 13, 17, 21])],
  breaks: [P('M5 3v5h14V3M5 21v-5h14v5'), L(3, 12, 21, 12, 'a dash')],
  'line-numbers': [T(4.5, 8, '1', 7, 'af'), T(4.5, 15, '2', 7, 'af'), T(4.5, 22, '3', 7, 'af'), ...lines(9, 21, [5, 12, 19])],
  hyphenation: [T(8, 10, 'ab-', 8, 'f'), T(12, 21, 'cd', 8, 'af')],
  position: [R(3, 3, 18, 18, 1), ...lines(6, 18, [6, 9, 18]), R(8, 11, 8, 5, 0, 'af')],
  'selection-pane': [R(3, 3, 18, 18, 1.5), L(14, 3, 14, 21), ...lines(16, 19, [7, 11, 15]), R(6, 7, 5, 5, 0, 'af')],
  'align-objects': [L(4, 2, 4, 22), R(7, 5, 10, 5, 1), R(7, 14, 14, 5, 1, 'a')],
  rotate: [P('M21 12a9 9 0 1 1-3-6.7L21 8'), P('M21 3v5h-5', 'a')],
  // --- References
  'add-text': [...lines(3, 14, [6, 11, 16]), P('M18 9v8M14 13h8', 'a')],
  footnote: [...lines(3, 21, [4, 8, 12]), L(3, 16, 9, 16, 'a'), T(16, 22, 'ab¹', 7, 'af')],
  endnote: [PAGE, FOLD, ...lines(8, 16, [7, 10]), L(8, 15, 12, 15, 'a'), L(8, 18, 16, 18, 'a')],
  'next-footnote': [...lines(3, 15, [6, 11]), T(8, 21, 'ab¹', 7, 'af'), P('m17 15 3 3-3 3', 'a')],
  'show-notes': [PAGE, FOLD, L(8, 15, 16, 15, 'a'), ...lines(8, 16, [18])],
  'citation-style': [R(3, 4, 18, 16, 2), T(12, 15.5, 'APA', 7.5, 'f')],
  'table-of-figures': [R(3, 3, 8, 8, 1, 'a'), ...lines(14, 21, [5, 9]), R(3, 13, 8, 8, 1, 'a'), ...lines(14, 21, [15, 19])],
  'mark-entry': [...lines(3, 21, [5, 10]), L(3, 15, 11, 15), R(13, 13, 8, 8, 1, 'a')],
  'insert-index': [T(5, 9, 'A', 7, 'af'), ...lines(9, 21, [6, 10]), T(5, 20, 'B', 7, 'af'), ...lines(9, 21, [17, 21])],
  'update-table': [...lines(3, 12, [5, 10, 15]), P('M21 13a5 5 0 1 1-1.5-3.6L21 11', 'a'), P('M21 7v4h-4', 'a')],
  // --- Mailings / Review
  'highlight-fields': [R(3, 7, 18, 10, 1.5, 'yf'), T(12, 15, '«»', 9, 'f')],
  'greeting-line': [...lines(3, 21, [12, 17]), T(9, 8, 'Dear', 7, 'af')],
  rules: [P('M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9', 'a')],
  'word-count': [T(12, 10, 'ABC', 7.5, 'f'), T(12, 20, '123', 7.5, 'af')],
  'display-review': [PAGE, FOLD, L(8, 9, 16, 9, 'a'), ...lines(8, 16, [13, 17])],
  'show-markup': [...lines(3, 15, [6, 12, 18]), C(19, 9, 2.5, 'a'), C(19, 17, 2.5, 'a')],
  'track-changes': [PAGE, FOLD, ...lines(8, 16, [10, 14]), P('M8 18h5', 'a'), P('m14 21 6-6', 'a')],
  previous: [P('M15 6l-6 6 6 6', 'a')],
  next: [P('M9 6l6 6-6 6', 'a')],
  // --- View
  'read-mode': [P('M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2z'), P('M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z', 'a')],
  'print-layout': [PAGE, FOLD, ...lines(9, 16, [10, 13, 16])],
  'web-layout': [C(12, 12, 9), P('M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18', 'a')],
  outline: [L(3, 5, 5, 5), L(8, 5, 21, 5), L(6, 10, 8, 10), L(11, 10, 21, 10), L(6, 15, 8, 15), L(11, 15, 21, 15), L(3, 20, 5, 20), L(8, 20, 21, 20)],
  draft: [...lines(3, 21, [4, 8, 12, 16, 20])],
  focus: [P('M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3'), ...lines(8, 16, [9, 12, 15])],
  'immersive-reader': [P('M5 2h11l4 4v16H5z'), P('M8 9h3M8 13h8M8 17h8', 'a'), P('M14 5l2 2', 'a')],
  vertical: [PAGE, FOLD, ...lines(9, 16, [10, 13, 16]), P('m22 9-1.5-2L19 9M20.5 7v10M19 15l1.5 2 1.5-2', 'a')],
  'side-to-side': [R(2, 4, 9, 16, 1), R(13, 4, 9, 16, 1, 'a')],
  zoom: [C(10, 10, 7), P('m21 21-6-6')],
  'zoom-100': [T(12, 16, '100', 10.5, 'af', { 'font-weight': 700 })],
  'one-page': [PAGE, FOLD],
  'multiple-pages': [R(2, 5, 9, 14, 1), R(13, 5, 9, 14, 1)],
  'page-width': [R(5, 3, 14, 18, 1), P('M2 12h20M5 9l-3 3 3 3M19 9l3 3-3 3', 'a')],
  'switch-modes': [C(12, 12, 9, 'f')],
  'interface-theme': [R(3, 3, 18, 18, 1.5), R(3, 3, 18, 5, 1.5, 'f'), R(6, 11, 8, 7, 0, 'f')],
  'new-window': [R(7, 3, 14, 12, 1.5), R(3, 8, 14, 12, 1.5, 'a')],
  'arrange-all': [R(3, 3, 18, 8, 1.5), R(3, 13, 18, 8, 1.5)],
  split: [R(3, 3, 18, 18, 1.5), L(3, 12, 21, 12, 'a')],
  'side-by-side': [R(3, 4, 8, 16, 1), R(13, 4, 8, 16, 1)],
  'sync-scroll': [R(3, 4, 8, 16, 1), R(13, 4, 8, 16, 1), P('M7 9v6M17 9v6M5 11l2-2 2 2M15 11l2-2 2 2')],
  'switch-windows': [R(7, 3, 14, 12, 1.5, 'a'), R(3, 8, 14, 12, 1.5)],
  'full-screen': [R(3, 3, 18, 18, 1.5), P('M8 8l3 3M8 8v3M8 8h3M16 16l-3-3M16 16v-3M16 16h-3', 'a')],
  macros: [R(3, 3, 18, 18, 2), P('m10 8 6 4-6 4z', 'f')],
  templates: [PAGE, FOLD, P('M9.5 17l2.5-7 2.5 7M10.4 15h3.2', 'a')],
  // --- Developer
  'cc-combo': [R(3, 7, 18, 10, 1.5), L(15, 7, 15, 17), P('m17 11 1.5 1.5L20 11', 'a')],
  'design-mode': [P('M12 3v3M5 21l7-15 7 15M7.5 16h9', 'a')],
  // --- Tables (M6)
  'table-select': [R(3, 3, 18, 18, 1.5), L(3, 9, 21, 9), L(9, 3, 9, 21), P('M13 13l7 3-3 1-1 3z', 'af')],
  'view-gridlines': [R(3, 3, 18, 18, 1.5, 'a'), L(3, 9, 21, 9, 'a'), L(3, 15, 21, 15, 'a'), L(9, 3, 9, 21, 'a'), L(15, 3, 15, 21, 'a')],
  'table-properties': [R(3, 3, 18, 18, 1.5), L(3, 9, 21, 9), L(9, 3, 9, 21), C(16, 16, 3, 'a')],
  'delete-table': [R(3, 3, 14, 14, 1.5), L(3, 8, 17, 8), L(8, 3, 8, 17), P('m15 15 6 6m0-6-6 6', 'rs')],
  'insert-above': [R(3, 11, 18, 10, 1.5), L(3, 16, 21, 16), L(9, 11, 9, 21), L(15, 11, 15, 21), P('M12 2v7M8.5 5.5h7', 'a')],
  'insert-below': [R(3, 3, 18, 10, 1.5), L(3, 8, 21, 8), L(9, 3, 9, 13), L(15, 3, 15, 13), P('M12 15v7M8.5 18.5h7', 'a')],
  'insert-left': [R(11, 3, 10, 18, 1.5), L(16, 3, 16, 21), L(11, 9, 21, 9), L(11, 15, 21, 15), P('M2 12h7M5.5 8.5v7', 'a')],
  'insert-right': [R(3, 3, 10, 18, 1.5), L(8, 3, 8, 21), L(3, 9, 13, 9), L(3, 15, 13, 15), P('M15 12h7M18.5 8.5v7', 'a')],
  'merge-cells': [R(3, 5, 18, 14, 1.5), P('M7 12h10M14 9l3 3-3 3M10 9l-3 3 3 3', 'a')],
  'split-cells': [R(3, 5, 18, 14, 1.5), L(12, 5, 12, 19, 'a'), P('M5 12h4M15 12h4', 'a')],
  'split-table': [R(3, 3, 18, 7, 1.5), R(3, 14, 18, 7, 1.5), L(1, 12, 23, 12, 'a')],
  autofit: [R(3, 5, 18, 14, 1.5), L(12, 5, 12, 19), P('M5 12h4M7 10l-2 2 2 2M19 12h-4M17 10l2 2-2 2', 'a')],
  'distribute-rows': [R(3, 3, 18, 18, 1.5), L(3, 9, 21, 9), L(3, 15, 21, 15), P('M12 5v14', 'a')],
  'distribute-cols': [R(3, 3, 18, 18, 1.5), L(9, 3, 9, 21), L(15, 3, 15, 21), P('M5 12h14', 'a')],
  'cell-margins': [R(3, 3, 18, 18, 1.5), R(7, 7, 10, 10, 0.5, 'a')],
  'repeat-header': [R(3, 3, 18, 18, 1.5), R(3, 3, 18, 5, 1.5, 'af'), L(3, 13, 21, 13), P('M17 16a3 3 0 1 1-1-2', 'a')],
  'convert-text': [R(3, 3, 8, 8, 1), L(3, 7, 11, 7), ...lines(14, 21, [14, 17, 20]), P('M15 6h5m-2-2 2 2-2 2', 'a')],
  formula: [T(12, 17, 'fx', 13, 'f', { 'font-style': 'italic', 'font-weight': 600 })],
  'border-painter': [P('M18 2l4 4-9 9-4 0 0-4z'), P('M3 21h18', 'a')],
  'line-style': [L(3, 6, 21, 6), L(3, 12, 21, 12, 'dash'), L(3, 18, 21, 18, 'dots')],
  'line-weight': [L(3, 5, 21, 5), P('M3 11h18', 'thick'), R(3, 16, 18, 4, 0, 'f')],
  'border-styles': [R(3, 3, 18, 18, 1.5, 'a'), L(3, 12, 21, 12), L(12, 3, 12, 21)],
  'border-inside': [R(3, 3, 18, 18, 1.5, 'dots'), L(3, 12, 21, 12, 'a'), L(12, 3, 12, 21, 'a')],
  'border-inside-h': [R(3, 3, 18, 18, 1.5, 'dots'), L(3, 12, 21, 12, 'a')],
  'border-inside-v': [R(3, 3, 18, 18, 1.5, 'dots'), L(12, 3, 12, 21, 'a')],
  'quick-tables': [R(3, 3, 18, 18, 1.5), R(3, 3, 18, 6, 1.5, 'af'), L(3, 15, 21, 15), L(12, 9, 12, 21)],
  'align-top-left': [R(3, 3, 18, 18, 1.5, 'dots'), L(5, 5.5, 13, 5.5, 'a'), L(5, 8.5, 10, 8.5, 'a')],
  'align-top-centre': [R(3, 3, 18, 18, 1.5, 'dots'), L(8, 5.5, 16, 5.5, 'a'), L(8, 8.5, 13, 8.5, 'a')],
  'align-top-right': [R(3, 3, 18, 18, 1.5, 'dots'), L(11, 5.5, 19, 5.5, 'a'), L(11, 8.5, 16, 8.5, 'a')],
  'align-middle-left': [R(3, 3, 18, 18, 1.5, 'dots'), L(5, 10.5, 13, 10.5, 'a'), L(5, 13.5, 10, 13.5, 'a')],
  'align-middle-centre': [R(3, 3, 18, 18, 1.5, 'dots'), L(8, 10.5, 16, 10.5, 'a'), L(8, 13.5, 13, 13.5, 'a')],
  'align-middle-right': [R(3, 3, 18, 18, 1.5, 'dots'), L(11, 10.5, 19, 10.5, 'a'), L(11, 13.5, 16, 13.5, 'a')],
  'align-bottom-left': [R(3, 3, 18, 18, 1.5, 'dots'), L(5, 15.5, 13, 15.5, 'a'), L(5, 18.5, 10, 18.5, 'a')],
  'align-bottom-centre': [R(3, 3, 18, 18, 1.5, 'dots'), L(8, 15.5, 16, 15.5, 'a'), L(8, 18.5, 13, 18.5, 'a')],
  'align-bottom-right': [R(3, 3, 18, 18, 1.5, 'dots'), L(11, 15.5, 19, 15.5, 'a'), L(11, 18.5, 16, 18.5, 'a')],
  // --- Backstage
  'save-as': [P('M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V12'), P('M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10'), P('M7 3v4h7'), P('M15 18h6m-3-3 3 3-3 3', 'a')],
  recover: [P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h4'), P('M14 2v6h6'), C(16, 16, 5), P('M16 13.5V16l1.5 1.5', 'a')],
  share: [P('M12 3v12M8 7l4-4 4 4'), P('M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7')],
  'editing-mode': [P('M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z'), P('M16.5 4l3.5 3.5', 'or')],
  launcher: [P('M5 5h14v14'), P('M19 19 9 9'), P('M15 19h4v-4')],
  'warning-triangle': [P('M12 2.5 22.5 21h-21z', 'of'), P('M12 9v5.5', 'ink'), C(12, 17.6, 0.6, 'ink')],
  more: [C(5, 12, 1.3, 'f'), C(12, 12, 1.3, 'f'), C(19, 12, 1.3, 'f')],
  'tab-left': [P('M9 5v12h8')],
  'tab-centre': [P('M12 5v12M6 17h12')],
  'tab-right': [P('M15 5v12H7')],
  'tab-decimal': [P('M12 5v12M6 17h12'), C(16, 12, 1.2, 'f')],
  'tab-bar': [P('M12 4v16')],
  'tab-first-line': [P('M7 6h10l-5 6z')],
  'tab-hanging': [P('M7 18h10l-5-6z')],
};

const LUCIDE = {
  'paste-keep': ClipboardCheck, 'paste-merge': ClipboardList, 'paste-text': ClipboardType,
  cut: Scissors, copy: Copy, clipboard: Clipboard, type: Type, 'grow-font': AArrowUp, 'shrink-font': AArrowDown,
  'change-case': CaseSensitive, bullets: List, numbering: ListOrdered, multilevel: ListTree,
  'indent-decrease': IndentDecrease, 'indent-increase': IndentIncrease, sort: ArrowDownAZ, pilcrow: Pilcrow,
  'align-left': AlignLeft, 'align-centre': AlignCenter, 'align-right': AlignRight, justify: AlignJustify,
  'styles-pane': LetterText, find: Search, search: Search, select: MousePointerSmall(),
  icons: Smile, smartart: Network, link: Link, bookmark: Bookmark, 'signature-line': Signature, symbol: Omega,
  lasso: Lasso, colours: Palette, 'wrap-text': WrapText, 'bring-forward': BringToFront, 'send-backward': SendToBack,
  group: Group, toc: TableOfContents, citation: Quote, 'manage-sources': Library, bibliography: BookOpenText,
  caption: Captions, envelope: Mail, labels: Tags, 'start-merge': Mails, recipients: Users, 'edit-recipients': UserPen,
  'address-block': Contact, 'merge-field': Braces, 'preview-results': ScanEye, 'first-record': ChevronFirst,
  'previous-record': ChevronLeft, 'next-record': ChevronRight, 'last-record': ChevronLast, 'find-recipient': UserSearch,
  'finish-merge': MailCheck, spelling: SpellCheck, thesaurus: BookA, 'read-aloud': Speech, accessibility: Accessibility,
  translate: Languages, language: Globe, 'delete-comment': MessageSquareX, 'show-comments': MessagesSquare,
  'reviewing-pane': PanelRight, accept: FileCheck, reject: FileX, compare: FileDiff, restrict: LockKeyhole,
  pin: Pin, ruler: Ruler, 'circle-plus': CirclePlus, 'circle-minus': CircleMinus, 'zoom-in': ZoomIn, 'zoom-out': ZoomOut, 'cc-rich-text': LetterText, 'cc-plain-text': Type,
  'cc-picture': ImagePlus, 'cc-checkbox': SquareCheck, 'cc-dropdown': SquareChevronDown, 'cc-date': CalendarDays,
  properties: Settings2, 'zotero-note': StickyNote, refresh: RefreshCw, preferences: Settings, unlink: Unlink,
  help: CircleHelp, feedback: MessageSquareHeart, 'whats-new': Gift, about: Info, file: File, back: ChevronLeft,
  home: House, new: FilePlus, open: FolderOpen, info: Info, save: Save, print: Printer, export: FileOutput, close: X,
  options: Settings, download: Download, undo: Undo2, redo: Redo2, 'chevron-up': ChevronUp, 'chevron-down': ChevronDown,
  pause: Pause, play: Play, 'alert-triangle': TriangleAlert, 'circle-x': CircleX,
  'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, keyboard: Keyboard, comments: MessageSquareText,
  eye: Eye, monitor: Monitor, moon: Moon, sun: Sun, minus: Minus, plus: Plus, 'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft, 'file-text': FileText, files: Files, 'file-clock': FileClock, 'file-pen': FilePen,
  sparkles: Sparkles, 'badge-check': BadgeCheck, 'paint-bucket': PaintBucket, 'swatch-book': SwatchBook,
  'calendar-clock': CalendarClock, box: Box, 'arrow-right-left': ArrowRightLeft, 'book-open': BookOpen,
  'list-checks': ListChecks, 'square-dashed': SquareDashed, 'git-branch': GitBranch, 'circle-play': CirclePlay,
  'circle-help': CircleHelp, mic: Mic, radical: Radical, puzzle: Puzzle, 'drafting-compass': DraftingCompass,
  'remove-background': ImageOff, corrections: SunDim, 'colour-picture': Paintbrush, 'artistic-effects': WandSparkles,
  transparency: Blend, compress: Shrink, 'change-picture': ImageUp, 'reset-picture': RotateCcw, 'picture-border': Frame,
  'picture-effects': Layers, crop: Crop, height: MoveVertical, width: MoveHorizontal, 'edit-shape': PenTool, 'shape-outline-pen': PenLine,
  'align-text': AlignVerticalJustifyCenter, 'image-minus': ImageMinus, image: Image, 'shapes-lucide': Shapes,
  'volume-2': Volume2, 'rotate-cw': RotateCw, 'align-start': AlignHorizontalJustifyStart, share2: Share,
};

/** A filled arrow pointer like the reference "Select" icon (small variant). */
function MousePointerSmall() { return [P('M5 3l6 15 2-6 6-2z')]; }

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function renderNodes(nodes) {
  return nodes.map(([tag, attrs, text]) => {
    const a = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    return text != null ? `<${tag} ${a}>${esc(text)}</${tag}>` : `<${tag} ${a}/>`;
  }).join('');
}

const cache = new Map();

/** Returns an inline SVG string for an icon name ('' if unknown). */
export function iconSvg(name, { size = 16, strokeWidth = 1.5, className = '' } = {}) {
  if (name === 'logo') return LOGO_SVG;
  const key = `${name}|${size}|${strokeWidth}|${className}`;
  if (cache.has(key)) return cache.get(key);
  const node = CUSTOM[name] || LUCIDE[name];
  if (!node) return '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" class="icon i-${esc(name)} ${esc(className)}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${renderNodes(node)}</svg>`;
  cache.set(key, svg);
  return svg;
}

export function registerIcon(name, node) { CUSTOM[name] = node; cache.clear(); }
export const hasIcon = (name) => name === 'logo' || name in CUSTOM || name in LUCIDE;
export const iconNames = () => [...new Set([...Object.keys(CUSTOM), ...Object.keys(LUCIDE)])];
