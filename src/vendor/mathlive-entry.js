/**
 * The equation editor's engine (MathLive, MIT). Built as a separate chunk and
 * embedded in the HTML file; it is loaded only when an equation is edited.
 * Its fonts are inlined as data URIs (no network access).
 */
import { MathfieldElement, convertLatexToMathMl } from 'mathlive';

/* global __MATHLIVE_FONTS_CSS__ */
const style = document.createElement('style');
style.textContent = __MATHLIVE_FONTS_CSS__;
document.head.append(style);
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;
MathfieldElement.keypressSound = null;
MathfieldElement.plonkSound = null;

export { MathfieldElement, convertLatexToMathMl };
