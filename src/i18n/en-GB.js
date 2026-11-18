/** English (United Kingdom) — the default catalogue, merged from en-GB/*. */
import app from './en-GB/app.js';
import commands from './en-GB/commands.js';
import ribbon from './en-GB/ribbon.js';
import ui from './en-GB/ui.js';

export default { ...app, ...commands, ...ribbon, ...ui };
