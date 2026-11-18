/**
 * Helpers for feature modules. Each ribbon tab module exports:
 *   commands: command definitions (registered with the command registry)
 *   ribbon:   the tab's ribbon layout (rendered by ui/ribbon)
 * Command labels default to the i18n key `cmd.<id>`.
 */

/** Builds command definitions: defineCommands('home', { bold: { icon, shortcut, run } }) */
export function defineCommands(prefix, defs) {
  return Object.entries(defs).map(([name, spec]) => ({ id: `${prefix}.${name}`, label: `cmd.${prefix}.${name}`, ...spec }));
}

/** Resolves a control's command reference: "paste" → "home.paste"; "view.zoom" stays. */
export const resolveId = (tab, ref) => (ref.includes('.') ? ref : `${tab}.${ref}`);
