/**
 * Undoable changes to the parts of the document that live outside the
 * ProseMirror body: page styles (office:master-styles and the page layouts
 * in styles.xml automatic styles), named styles, list styles, font faces and
 * the line-numbering configuration.
 *
 * A StateStep leaves the ProseMirror document unchanged but records the
 * before/after value of one DocumentState field, so the history plugin can
 * undo and redo it together with ordinary edits. Values are treated as
 * immutable: a change always replaces the field with a new object.
 */
import { Step, StepResult, StepMap } from 'prosemirror-transform';

export class StateStep extends Step {
  constructor(key, before, after) {
    super();
    this.key = key;
    this.before = before;
    this.after = after;
  }

  apply(doc) { return StepResult.ok(doc); }

  invert() { return new StateStep(this.key, this.after, this.before); }

  map() { return this; }

  getMap() { return StepMap.empty; }

  merge() { return null; }

  toJSON() { return { stepType: 'odtState', key: this.key }; }

  static fromJSON(_schema, json) { return new StateStep(json.key, null, null); }
}
Step.jsonID('odtState', StateStep);

/** The StateSteps of a transaction. */
export const stateSteps = (tr) => tr.steps.filter((s) => s instanceof StateStep);

/**
 * Runs `fn(docState)`, which changes some of `keys` by replacing them, then
 * records the changes as one undoable transaction (optionally together with
 * document steps added by `withTr(tr)`). Returns fn's result.
 */
export function editState(view, docState, keys, fn, withTr = null) {
  const before = Object.fromEntries(keys.map((k) => [k, docState[k]]));
  const result = fn(docState);
  const tr = view.state.tr;
  for (const k of keys) if (docState[k] !== before[k]) tr.step(new StateStep(k, before[k], docState[k]));
  withTr?.(tr);
  if (tr.steps.length) view.dispatch(tr.setMeta('stateEdit', true));
  return result;
}
