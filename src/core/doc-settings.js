/**
 * Items in settings.xml (ooo:configuration-settings), kept as the file's
 * text. Used by Restrict Editing: LoadReadonly (LibreOffice opens the file
 * read-only) and ODTEditorRestrictEditing (read only / comments / tracked
 * changes, for this editor).
 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const itemRe = (name) => new RegExp(`<config:config-item config:name="${name}" config:type="[^"]*">([^<]*)</config:config-item>`);

export function getConfigItem(xml, name) {
  const m = itemRe(name).exec(xml || '');
  return m ? m[1].replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
}

/** Sets (value null: removes) a configuration item; returns the new text. */
export function setConfigItem(xml, name, type, value) {
  const re = itemRe(name);
  if (value == null) return xml.replace(re, '');
  const item = `<config:config-item config:name="${name}" config:type="${type}">${esc(value)}</config:config-item>`;
  if (re.test(xml)) return xml.replace(re, item);
  const set = /<config:config-item-set config:name="ooo:configuration-settings">/;
  if (set.test(xml)) return xml.replace(set, (m) => `${m}${item}`);
  return xml.replace('</office:settings>', `<config:config-item-set config:name="ooo:configuration-settings">${item}</config:config-item-set></office:settings>`);
}
