/** English (United Kingdom) — the default catalogue, merged from en-GB/*. */
import app from './en-GB/app.js';
import commands from './en-GB/commands.js';
import ribbon from './en-GB/ribbon.js';
import ui from './en-GB/ui.js';
import file from './en-GB/file.js';
import home from './en-GB/home.js';
import layout from './en-GB/layout.js';
import tables from './en-GB/tables.js';
import objects from './en-GB/objects.js';
import references from './en-GB/references.js';
import review from './en-GB/review.js';
import view from './en-GB/view.js';
import final from './en-GB/final.js';

export default { ...app, ...commands, ...ribbon, ...ui, ...file, ...home, ...layout, ...tables, ...objects, ...references, ...review, ...view, ...final };
