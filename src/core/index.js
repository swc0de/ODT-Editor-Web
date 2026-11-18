/**
 * core/: document model and everything that isn't UI.
 *   command-registry.js  every action as a command (ribbon, shortcuts, Alt+Q, tests)
 *   settings.js          persisted user options
 * Coming in M2: schema.js (ProseMirror schema mapping ODT 1:1, opaque nodes for
 * unknown content), odt/ (import/export via fflate), styles model, document
 * state, autosave (IndexedDB).
 */
export { CommandRegistry } from './command-registry.js';
