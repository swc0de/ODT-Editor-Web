#!/usr/bin/env node
/**
 * Generates the ODT test fixtures in tests/fixtures/.
 *
 *   node tests/make-fixtures.mjs            write fixtures (+ LibreOffice exports if soffice exists)
 *   node tests/make-fixtures.mjs --check    also verify every fixture opens in LibreOffice
 *
 * If LibreOffice (`soffice`) is installed, a few fixtures are additionally
 * round-tripped through it to produce genuine LibreOffice-written files
 * (lo-*.odt). Those are committed, so tests don't require LibreOffice.
 */
import { writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOdt, makePng, esc, A4_PAGE_LAYOUT } from './lib/odf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'fixtures');
mkdirSync(OUT, { recursive: true });

const fixtures = {};
const add = (name, def) => { fixtures[name] = def; };

const P = (style, inner) => `<text:p text:style-name="${style}">${inner}</text:p>`;
const H = (level, inner, style = `Heading_20_${level}`) => `<text:h text:style-name="${style}" text:outline-level="${level}">${inner}</text:h>`;
const span = (style, inner) => `<text:span text:style-name="${style}">${inner}</text:span>`;

const LOREM = [
  'The studio opens at nine, and the first hour belongs to whoever arrives with the kettle already filled.',
  'Every project begins with a single page that states the problem in plain words, before any sketch is made.',
  'Drafts are shared early and often; a rough idea seen by three people is worth more than a polished one seen by none.',
  'When a decision is made, it is written down with the date and the reason, so that later we can tell why.',
  'Feedback is specific, kind and about the work, never about the person who made it.',
  'Each Friday the team tidies the shared drive, archives finished work and leaves a short note for Monday.',
];

// ------------------------------------------------------------------ formatting zoo
add('formatting-zoo', {
  title: 'Formatting zoo',
  contentAutoStyles: `
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>
  <style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
  <style:style style:name="T3" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>
  <style:style style:name="T4" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-type="double" style:text-underline-width="auto" style:text-underline-color="#c00000"/></style:style>
  <style:style style:name="T5" style:family="text"><style:text-properties style:text-underline-style="wave" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>
  <style:style style:name="T6" style:family="text"><style:text-properties style:text-underline-style="dotted" style:text-underline-width="bold" style:text-underline-color="font-color"/></style:style>
  <style:style style:name="T7" style:family="text"><style:text-properties style:text-line-through-style="solid" style:text-line-through-type="single"/></style:style>
  <style:style style:name="T8" style:family="text"><style:text-properties style:text-line-through-style="solid" style:text-line-through-type="double"/></style:style>
  <style:style style:name="T9" style:family="text"><style:text-properties style:text-position="sub 58%"/></style:style>
  <style:style style:name="T10" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
  <style:style style:name="T11" style:family="text"><style:text-properties fo:color="#c00000"/></style:style>
  <style:style style:name="T12" style:family="text"><style:text-properties fo:background-color="#ffff00"/></style:style>
  <style:style style:name="T13" style:family="text"><style:text-properties style:font-name="Liberation Serif" fo:font-family="'Liberation Serif'" fo:font-size="16pt"/></style:style>
  <style:style style:name="T14" style:family="text"><style:text-properties style:font-name="Liberation Mono" fo:font-family="'Liberation Mono'" fo:font-size="10pt"/></style:style>
  <style:style style:name="T15" style:family="text"><style:text-properties fo:font-variant="small-caps"/></style:style>
  <style:style style:name="T16" style:family="text"><style:text-properties fo:text-transform="uppercase"/></style:style>
  <style:style style:name="T17" style:family="text"><style:text-properties fo:letter-spacing="0.106cm"/></style:style>
  <style:style style:name="T18" style:family="text"><style:text-properties fo:letter-spacing="-0.035cm"/></style:style>
  <style:style style:name="T19" style:family="text"><style:text-properties text:display="none"/></style:style>
  <style:style style:name="T20" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color" fo:color="#2e75b6" fo:font-size="14pt"/></style:style>
  <style:style style:name="T21" style:family="text"><style:text-properties style:text-outline="true"/></style:style>
  <style:style style:name="T22" style:family="text"><style:text-properties fo:text-shadow="1pt 1pt"/></style:style>
  <style:style style:name="T23" style:family="text"><style:text-properties fo:border="0.5pt solid #000000" fo:padding="0.049cm"/></style:style>
  <style:style style:name="T24" style:family="text"><style:text-properties style:font-name="Caladea" fo:font-family="Caladea" fo:font-size="8pt"/></style:style>
  <style:style style:name="T25" style:family="text"><style:text-properties style:text-scale="150%"/></style:style>
  <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/></style:style>
  <style:style style:name="P2" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end"/></style:style>
  <style:style style:name="P3" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="justify"/></style:style>
  <style:style style:name="P4" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="1.27cm" fo:margin-right="1.27cm" fo:text-indent="0.635cm"/></style:style>
  <style:style style:name="P5" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="1.27cm" fo:text-indent="-1.27cm"/></style:style>
  <style:style style:name="P6" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.423cm" fo:line-height="200%"/></style:style>
  <style:style style:name="P7" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties style:line-height-at-least="0.706cm"/></style:style>
  <style:style style:name="P8" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:line-height="0.6cm"/></style:style>
  <style:style style:name="P9" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:background-color="#deeaf6" fo:border="0.06pt solid #2e75b6" fo:padding="0.1cm"/></style:style>
  <style:style style:name="P10" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border-top="none" fo:border-left="none" fo:border-right="none" fo:border-bottom="1.5pt double #000000" fo:padding-bottom="0.05cm"/></style:style>
  <style:style style:name="P11" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties>
    <style:tab-stops>
      <style:tab-stop style:position="4cm"/>
      <style:tab-stop style:position="8cm" style:type="center" style:leader-style="dotted" style:leader-text="."/>
      <style:tab-stop style:position="15.92cm" style:type="right" style:leader-style="solid" style:leader-text="_"/>
    </style:tab-stops></style:paragraph-properties></style:style>
  <style:style style:name="P12" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties><style:tab-stops><style:tab-stop style:position="6cm" style:type="char" style:char="."/></style:tab-stops></style:paragraph-properties></style:style>
  <style:style style:name="P13" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:keep-with-next="always" fo:keep-together="always" fo:widows="3" fo:orphans="3"/></style:style>
  <style:style style:name="P14" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end" style:writing-mode="rl-tb"/></style:style>
  <style:style style:name="P15" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>`,
  body: `
${P('Title', 'Formatting zoo')}
${P('Standard', `Plain, ${span('T1', 'bold')}, ${span('T2', 'italic')}, ${span('T3', 'underline')}, ${span('T4', 'double red underline')}, ${span('T5', 'wavy underline')}, ${span('T6', 'thick dotted underline')}, ${span('T7', 'strikethrough')}, ${span('T8', 'double strikethrough')}.`)}
${P('Standard', `H${span('T9', '2')}O and E = mc${span('T10', '2')}; ${span('T11', 'red text')}, ${span('T12', 'highlighted')}, ${span('T13', 'Liberation Serif 16 pt')}, ${span('T14', 'Liberation Mono 10 pt')}, ${span('T24', 'Caladea 8 pt')}.`)}
${P('Standard', `${span('T15', 'Small Caps')}, ${span('T16', 'all caps')}, ${span('T17', 'expanded')}, ${span('T18', 'condensed')}, hidden:[${span('T19', 'secret')}], ${span('T20', 'combined')}, ${span('T21', 'outline')}, ${span('T22', 'shadow')}, ${span('T23', 'boxed')}, ${span('T25', 'scaled 150%')}.`)}
${P('Standard', `Named character styles: ${span('Emphasis', 'Emphasis')} and ${span('Strong_20_Emphasis', 'Strong Emphasis')}.`)}
${P('Standard', `Specials: line<text:line-break/>break, tab<text:tab/>stop, three<text:s text:c="3"/>spaces, soft hy&#xAD;phen, non&#xA0;breaking, en–dash, em—dash, “smart quotes”, ©, €, ä ö ü ß, Ελληνικά, Кириллица.`)}
${P('P1', 'Centred paragraph.')}
${P('P2', 'Right-aligned paragraph.')}
${P('P3', LOREM.join(' '))}
${P('P4', `Indented left and right 1.27 cm with a 0.635 cm first-line indent. ${LOREM[1]}`)}
${P('P5', `Hanging indent of 1.27 cm. ${LOREM[2]}`)}
${P('P6', `Double line spacing with 12 pt before and after. ${LOREM[3]}`)}
${P('P7', `At-least line spacing. ${LOREM[4]}`)}
${P('P8', `Exact line spacing. ${LOREM[5]}`)}
${P('P9', 'Shaded paragraph with a box border.')}
${P('P10', 'Paragraph with a double bottom border.')}
${P('P11', 'Left<text:tab/>Centre dotted<text:tab/>Right underscored')}
${P('P12', 'Decimal tab<text:tab/>123.45')}
${P('P13', 'Keep with next, keep together, widows 3, orphans 3.')}
${P('P14', 'Right-to-left paragraph direction.')}
<foo:custom-thing xmlns:foo="urn:example:unknown" foo:attr="keep me"><foo:child>Unknown content to preserve</foo:child></foo:custom-thing>
${P('P15', 'This paragraph starts on a new page (break-before).')}
${P('Standard', `Hyperlink: <text:a xlink:type="simple" xlink:href="https://example.org/" text:style-name="Internet_20_link">example.org</text:a>.`)}`,
});

// ------------------------------------------------------------------ styles
add('styles', {
  title: 'Styles hierarchy',
  extraStyles: `
  <style:style style:name="Base_20_Body" style:display-name="Base Body" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Base_20_Body">
    <style:paragraph-properties fo:margin-bottom="0.3cm" fo:line-height="120%"/>
    <style:text-properties style:font-name="Liberation Serif" fo:font-size="11pt"/>
  </style:style>
  <style:style style:name="Quote_20_Block" style:display-name="Quote Block" style:family="paragraph" style:parent-style-name="Base_20_Body">
    <style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm" fo:border-left="2.25pt solid #7c8cf8" fo:padding-left="0.3cm"/>
    <style:text-properties fo:font-style="italic" fo:color="#404040"/>
  </style:style>
  <style:style style:name="Quote_20_Block_20_Small" style:display-name="Quote Block Small" style:family="paragraph" style:parent-style-name="Quote_20_Block">
    <style:text-properties fo:font-size="9pt"/>
  </style:style>
  <style:style style:name="No_20_Spacing" style:display-name="No Spacing" style:family="paragraph" style:parent-style-name="Standard">
    <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:line-height="100%"/>
  </style:style>
  <style:style style:name="Code" style:family="paragraph" style:parent-style-name="No_20_Spacing">
    <style:paragraph-properties fo:background-color="#f2f2f2"/>
    <style:text-properties style:font-name="Liberation Mono" fo:font-size="9pt"/>
  </style:style>
  <style:style style:name="Key_20_Term" style:display-name="Key Term" style:family="text">
    <style:text-properties fo:font-weight="bold" fo:color="#5b6ee1"/>
  </style:style>
  <style:style style:name="Key_20_Term_20_Muted" style:display-name="Key Term Muted" style:family="text" style:parent-style-name="Key_20_Term">
    <style:text-properties fo:color="#808080"/>
  </style:style>`,
  contentAutoStyles: `
  <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Base_20_Body"><style:paragraph-properties fo:text-align="center"/></style:style>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>`,
  body: `
${P('Title', 'Styles hierarchy')}
${P('Subtitle', 'Inheritance, automatic styles and outline levels')}
${H(1, 'Heading 1')}
${P('Base_20_Body', `Base Body inherits Standard. ${LOREM[0]} It contains a ${span('Key_20_Term', 'Key Term')} and a ${span('Key_20_Term_20_Muted', 'muted key term')}.`)}
${H(2, 'Heading 2')}
${P('Quote_20_Block', `Quote Block inherits Base Body. ${LOREM[1]}`)}
${P('Quote_20_Block_20_Small', `Quote Block Small inherits Quote Block. ${LOREM[2]}`)}
${H(3, 'Heading 3')}
${P('P1', `Automatic style P1 (parent Base Body) centres this paragraph and ${span('T1', 'T1 italicises this')}.`)}
${P('No_20_Spacing', 'No Spacing line one.')}
${P('No_20_Spacing', 'No Spacing line two.')}
${P('Code', 'const answer = 42; // Code inherits No Spacing')}
<text:h text:style-name="Heading_20_1" text:outline-level="1" text:is-list-header="true">Unnumbered heading</text:h>
${P('Text_20_body', 'Text body paragraph.')}`,
});

// ------------------------------------------------------------------ lists
const listStyleBullets = `
  <text:list-style style:name="L1">
    ${['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪', '•'].map((ch, i) => `<text:list-level-style-bullet text:level="${i + 1}" text:style-name="Bullet_20_Symbols" text:bullet-char="${ch}">
      <style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(0.635 * (i + 1) + 0.635).toFixed(3)}cm" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * (i + 1) + 0.635).toFixed(3)}cm"/></style:list-level-properties>
    </text:list-level-style-bullet>`).join('\n    ')}
  </text:list-style>`;
const numFormats = ['1', 'a', 'i', '1', 'a', 'i', '1', 'a', 'i', '1'];
const listStyleNumbers = (name, display = 1) => `
  <text:list-style style:name="${name}">
    ${numFormats.map((f, i) => `<text:list-level-style-number text:level="${i + 1}" text:style-name="Numbering_20_Symbols" style:num-suffix="." style:num-format="${f}"${display > 1 && i > 0 ? ` text:display-levels="${Math.min(i + 1, display)}"` : ''}>
      <style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(0.635 * (i + 1) + 0.635).toFixed(3)}cm" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * (i + 1) + 0.635).toFixed(3)}cm"/></style:list-level-properties>
    </text:list-level-style-number>`).join('\n    ')}
  </text:list-style>`;
const LI = (inner, style = 'Standard') => `<text:list-item><text:p text:style-name="${style}">${inner}</text:p></text:list-item>`;
add('lists', {
  title: 'Lists',
  extraStyles: `
  <style:style style:name="Bullet_20_Symbols" style:display-name="Bullet Symbols" style:family="text"><style:text-properties style:font-name="Liberation Sans"/></style:style>
  <style:style style:name="Numbering_20_Symbols" style:display-name="Numbering Symbols" style:family="text"/>
  <style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.1cm"/></style:style>`,
  contentAutoStyles: `${listStyleBullets}${listStyleNumbers('L2')}${listStyleNumbers('L3', 3)}`,
  body: `
${H(1, 'Lists')}
${P('Standard', 'Bulleted list with nesting:')}
<text:list xml:id="list100" text:style-name="L1">
  ${LI('First bullet')}
  <text:list-item><text:p text:style-name="Standard">Second bullet</text:p>
    <text:list>
      ${LI('Nested level 2')}
      <text:list-item><text:p text:style-name="Standard">Nested level 2 again</text:p>
        <text:list>${LI('Level 3')}</text:list>
      </text:list-item>
    </text:list>
  </text:list-item>
  ${LI('Third bullet')}
</text:list>
${P('Standard', 'Numbered list:')}
<text:list xml:id="list200" text:style-name="L2">
  ${LI('One', 'List_20_Paragraph')}
  ${LI('Two', 'List_20_Paragraph')}
  ${LI('Three', 'List_20_Paragraph')}
</text:list>
${P('Standard', 'An interrupting paragraph; the next list continues numbering (4, 5):')}
<text:list xml:id="list201" text:continue-list="list200" text:style-name="L2">
  ${LI('Four', 'List_20_Paragraph')}
  ${LI('Five', 'List_20_Paragraph')}
</text:list>
${P('Standard', 'Restarted list starting at 10:')}
<text:list xml:id="list300" text:style-name="L2">
  <text:list-item text:start-value="10"><text:p text:style-name="List_20_Paragraph">Ten</text:p></text:list-item>
  ${LI('Eleven', 'List_20_Paragraph')}
</text:list>
${P('Standard', 'Multilevel list (1. / 1.1. / 1.1.1.):')}
<text:list xml:id="list400" text:style-name="L3">
  <text:list-item><text:p text:style-name="Standard">Chapter</text:p>
    <text:list>
      <text:list-item><text:p text:style-name="Standard">Section</text:p>
        <text:list>${LI('Subsection')}${LI('Subsection two')}</text:list>
      </text:list-item>
      ${LI('Second section')}
    </text:list>
  </text:list-item>
  ${LI('Second chapter')}
</text:list>
${P('Standard', 'List header (unnumbered item) inside a numbered list:')}
<text:list xml:id="list500" text:style-name="L2">
  ${LI('Numbered')}
  <text:list-header><text:p text:style-name="Standard">Unnumbered continuation paragraph</text:p></text:list-header>
  ${LI('Numbered again')}
</text:list>`,
});

// ------------------------------------------------------------------ tables
const cell = (style, inner, attrs = '') => `<table:table-cell table:style-name="${style}" office:value-type="string"${attrs}>${inner}</table:table-cell>`;
const cp = (s) => `<text:p text:style-name="Table_20_Contents">${s}</text:p>`;
add('tables', {
  title: 'Tables',
  contentAutoStyles: `
  <style:style style:name="Table1" style:family="table"><style:table-properties style:width="16cm" table:align="margins" fo:margin-top="0cm" fo:margin-bottom="0.3cm"/></style:style>
  <style:style style:name="Table1.A" style:family="table-column"><style:table-column-properties style:column-width="4cm"/></style:style>
  <style:style style:name="Table1.B" style:family="table-column"><style:table-column-properties style:column-width="6cm"/></style:style>
  <style:style style:name="Table1.HR" style:family="table-row"><style:table-row-properties style:min-row-height="0.8cm" fo:keep-together="always"/></style:style>
  <style:style style:name="Table1.R" style:family="table-row"><style:table-row-properties fo:keep-together="auto"/></style:style>
  <style:style style:name="Table1.H" style:family="table-cell"><style:table-cell-properties fo:background-color="#283070" fo:padding="0.1cm" fo:border="0.5pt solid #000000" style:vertical-align="middle"/></style:style>
  <style:style style:name="Table1.C" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000"/></style:style>
  <style:style style:name="Table1.Y" style:family="table-cell"><style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000" fo:background-color="#fff2cc" style:vertical-align="bottom"/></style:style>
  <style:style style:name="Table2" style:family="table"><style:table-properties style:width="5cm" table:align="left"/></style:style>
  <style:style style:name="Table2.A" style:family="table-column"><style:table-column-properties style:column-width="2.5cm"/></style:style>
  <style:style style:name="Table2.C" style:family="table-cell"><style:table-cell-properties fo:padding="0.05cm" fo:border="0.5pt dashed #7c8cf8"/></style:style>
  <style:style style:name="Table3" style:family="table"><style:table-properties style:width="8cm" table:align="center"/></style:style>
  <style:style style:name="Table3.A" style:family="table-column"><style:table-column-properties style:column-width="4cm"/></style:style>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#ffffff"/></style:style>`,
  body: `
${H(1, 'Tables')}
${P('Standard', 'A table with a repeated header row, merged cells and cell shading:')}
<table:table table:name="Table1" table:style-name="Table1">
  <table:table-column table:style-name="Table1.A"/>
  <table:table-column table:style-name="Table1.B" table:number-columns-repeated="2"/>
  <table:table-header-rows>
    <table:table-row table:style-name="Table1.HR">
      ${cell('Table1.H', cp(span('T1', 'Name')))}${cell('Table1.H', cp(span('T1', 'Role')))}${cell('Table1.H', cp(span('T1', 'Notes')))}
    </table:table-row>
  </table:table-header-rows>
  <table:table-row table:style-name="Table1.R">
    ${cell('Table1.C', cp('Merged across two columns'), ' table:number-columns-spanned="2"')}<table:covered-table-cell/>${cell('Table1.C', cp('C2'))}
  </table:table-row>
  <table:table-row table:style-name="Table1.R">
    ${cell('Table1.Y', cp('Merged down two rows'), ' table:number-rows-spanned="2"')}${cell('Table1.C', cp('B3'))}${cell('Table1.C', cp('C3'))}
  </table:table-row>
  <table:table-row table:style-name="Table1.R">
    <table:covered-table-cell/>${cell('Table1.C', cp('B4'))}${cell('Table1.C', cp('C4'))}
  </table:table-row>
  <table:table-row table:style-name="Table1.R">
    ${cell('Table1.C', cp('2×2 block'), ' table:number-columns-spanned="2" table:number-rows-spanned="2"')}<table:covered-table-cell/>${cell('Table1.C', cp('C5'))}
  </table:table-row>
  <table:table-row table:style-name="Table1.R">
    <table:covered-table-cell table:number-columns-repeated="2"/>${cell('Table1.C', cp('C6') + cp('Second paragraph in a cell'))}
  </table:table-row>
  <table:table-row table:style-name="Table1.R">
    ${cell('Table1.C', cp('Nested table:'))}
    ${cell('Table1.C', `${cp('Outer cell with a table inside')}
      <table:table table:name="Table2" table:style-name="Table2">
        <table:table-column table:style-name="Table2.A" table:number-columns-repeated="2"/>
        <table:table-row>${cell('Table2.C', cp('n1'))}${cell('Table2.C', cp('n2'))}</table:table-row>
        <table:table-row>${cell('Table2.C', cp('n3'))}${cell('Table2.C', cp('n4'))}</table:table-row>
      </table:table>`)}
    ${cell('Table1.C', cp('Number: ') )}
  </table:table-row>
</table:table>
${P('Standard', 'A simple centred table:')}
<table:table table:name="Table3" table:style-name="Table3">
  <table:table-column table:style-name="Table3.A" table:number-columns-repeated="2"/>
  <table:table-row><table:table-cell office:value-type="float" office:value="3.5">${cp('3.5')}</table:table-cell><table:table-cell office:value-type="string">${cp('float value')}</table:table-cell></table:table-row>
  <table:table-row><table:table-cell office:value-type="string">${cp('')}</table:table-cell><table:table-cell office:value-type="string">${cp('empty cell on the left')}</table:table-cell></table:table-row>
</table:table>
${P('Standard', 'After the tables.')}`,
});

// ------------------------------------------------------------------ images
const png1 = makePng(160, 100, (x, y) => [124 + (x % 40 < 20 ? 0 : 40), 140, 248 - Math.floor(y * 1.2), 255]);
const png2 = makePng(64, 64, (x, y) => ((x - 32) ** 2 + (y - 32) ** 2 < 28 ** 2 ? [91, 110, 225, 255] : [0, 0, 0, 0]));
const svg1 = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" rx="12" fill="#283070"/><text x="100" y="60" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#fff">SVG</text></svg>`;
add('images', {
  title: 'Images',
  pictures: { 'gradient.png': png1, 'circle.png': png2, 'badge.svg': new TextEncoder().encode(svg1) },
  contentAutoStyles: `
  <style:style style:name="fr1" style:family="graphic" style:parent-style-name="Graphics"><style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline" style:mirror="none" fo:clip="rect(0cm, 0cm, 0cm, 0cm)" draw:luminance="0%" draw:contrast="0%" draw:red="0%" draw:green="0%" draw:blue="0%" draw:gamma="100%" draw:color-inversion="false" draw:image-opacity="100%" draw:color-mode="standard"/></style:style>
  <style:style style:name="fr2" style:family="graphic" style:parent-style-name="Graphics"><style:graphic-properties style:wrap="parallel" style:number-wrapped-paragraphs="no-limit" style:wrap-contour="false" fo:margin-left="0.3cm" fo:margin-right="0.3cm" style:vertical-pos="top" style:vertical-rel="paragraph" style:horizontal-pos="right" style:horizontal-rel="paragraph"/></style:style>
  <style:style style:name="fr3" style:family="graphic" style:parent-style-name="Graphics"><style:graphic-properties style:wrap="none" style:vertical-pos="top" style:vertical-rel="paragraph" style:horizontal-pos="center" style:horizontal-rel="paragraph" draw:image-opacity="60%"/></style:style>`,
  extraStyles: `
  <style:style style:name="Graphics" style:family="graphic"><style:graphic-properties text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" style:wrap="dynamic" style:number-wrapped-paragraphs="no-limit" style:wrap-contour="false" style:vertical-pos="top" style:vertical-rel="paragraph" style:horizontal-pos="center" style:horizontal-rel="paragraph"/></style:style>`,
  body: `
${H(1, 'Images')}
${P('Standard', `Inline (as-character) image: <draw:frame draw:style-name="fr1" draw:name="Image1" text:anchor-type="as-char" svg:width="2cm" svg:height="1.25cm" draw:z-index="0"><draw:image xlink:href="Pictures/gradient.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="image/png"/><svg:title>Gradient</svg:title><svg:desc>A blue striped gradient used as a test image.</svg:desc></draw:frame> inside a line of text.`)}
${P('Standard', `<draw:frame draw:style-name="fr2" draw:name="Image2" text:anchor-type="paragraph" svg:width="2.5cm" svg:height="2.5cm" draw:z-index="1"><draw:image xlink:href="Pictures/circle.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="image/png"/><svg:desc>A transparent PNG circle.</svg:desc></draw:frame>A paragraph-anchored image floats to the right with parallel wrapping. ${LOREM.slice(0, 4).join(' ')}`)}
${P('Standard', `<draw:frame draw:style-name="fr3" draw:name="Image3" text:anchor-type="paragraph" svg:width="5cm" svg:height="2.5cm" draw:z-index="2"><draw:image xlink:href="Pictures/badge.svg" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="image/svg+xml"/></draw:frame>An SVG image centred with no wrap and 60% opacity.`)}
${P('Standard', `A frame with a caption:`)}
<text:p text:style-name="Standard"><draw:frame draw:style-name="fr3" draw:name="Frame1" text:anchor-type="paragraph" svg:width="6cm" draw:z-index="3"><draw:text-box fo:min-height="3cm"><text:p text:style-name="Standard"><draw:frame draw:style-name="fr1" draw:name="Image4" text:anchor-type="as-char" svg:width="5.6cm" svg:height="3.5cm" draw:z-index="4"><draw:image xlink:href="Pictures/gradient.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:mime-type="image/png"/></draw:frame><text:line-break/>Figure <text:sequence text:ref-name="refFigure0" text:name="Figure" text:formula="ooow:Figure+1" style:num-format="1">1</text:sequence>: A captioned image</text:p></draw:text-box></draw:frame></text:p>
${P('Standard', 'After the images.')}`,
});

// ------------------------------------------------------------------ headers / footers
add('headers-footers', {
  title: 'Headers and footers',
  stylesAutoStyles: `
  ${A4_PAGE_LAYOUT('pm1', '', '<style:header-style><style:header-footer-properties fo:min-height="0cm" fo:margin-bottom="0.5cm"/></style:header-style><style:footer-style><style:header-footer-properties fo:min-height="0cm" fo:margin-top="0.5cm"/></style:footer-style>')}
  <style:style style:name="MP1" style:family="paragraph" style:parent-style-name="Footer"><style:paragraph-properties fo:text-align="center"/></style:style>
  <style:style style:name="MP2" style:family="paragraph" style:parent-style-name="Header"><style:paragraph-properties fo:text-align="end"/></style:style>`,
  masterStyles: `
  <style:master-page style:name="Standard" style:page-layout-name="pm1">
    <style:header><text:p text:style-name="MP2">Studio handbook — <text:title>Headers and footers</text:title></text:p></style:header>
    <style:header-left><text:p text:style-name="Header">Left-page header</text:p></style:header-left>
    <style:header-first><text:p text:style-name="Header">First-page header</text:p></style:header-first>
    <style:footer><text:p text:style-name="MP1">Page <text:page-number text:select-page="current">1</text:page-number> of <text:page-count>3</text:page-count></text:p></style:footer>
    <style:footer-first><text:p text:style-name="MP1">First page footer · <text:date style:data-style-name="N37" text:date-value="2026-01-15">15/01/2026</text:date></text:p></style:footer-first>
  </style:master-page>`,
  extraStyles: `
  <number:date-style style:name="N37" number:automatic-order="true"><number:day number:style="long"/><number:text>/</number:text><number:month number:style="long"/><number:text>/</number:text><number:year number:style="long"/></number:date-style>`,
  contentAutoStyles: `
  <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>`,
  body: `
${H(1, 'Headers and footers')}
${P('Standard', 'Page one has a different first-page header and footer. Pages two and three use the default (right) and left headers. Footers show “Page X of Y”.')}
${LOREM.map((l) => P('Text_20_body', l)).join('\n')}
${P('P1', 'Page two.')}
${LOREM.map((l) => P('Text_20_body', l)).join('\n')}
${P('P1', 'Page three.')}
${P('Standard', `Fields: author <text:author-name>Fixture Generator</text:author-name>, file <text:file-name text:display="name-and-extension">headers-footers.odt</text:file-name>, words <text:word-count>120</text:word-count>.`)}`,
});

// ------------------------------------------------------------------ footnotes
const note = (id, cls, n, body) => `<text:note text:id="${id}" text:note-class="${cls}"><text:note-citation>${n}</text:note-citation><text:note-body><text:p text:style-name="${cls === 'footnote' ? 'Footnote' : 'Endnote'}">${body}</text:p></text:note-body></text:note>`;
add('footnotes', {
  title: 'Footnotes and endnotes',
  body: `
${H(1, 'Footnotes and endnotes')}
${P('Standard', `A sentence with a footnote.${note('ftn1', 'footnote', '1', 'The first footnote.')} Another one follows here.${note('ftn2', 'footnote', '2', 'The second footnote, which is a little longer so that it wraps across more than one line at the bottom of the page in most layouts.')}`)}
${P('Standard', `An endnote appears at the end of the document.${note('ftn3', 'endnote', 'i', 'The first endnote.')}`)}
${P('Standard', `A footnote with a custom mark.<text:note text:id="ftn4" text:note-class="footnote"><text:note-citation text:label="*">*</text:note-citation><text:note-body><text:p text:style-name="Footnote">Custom-labelled footnote.</text:p><text:p text:style-name="Footnote">Second paragraph of the note.</text:p></text:note-body></text:note>`)}
${P('Standard', `Cross-reference to footnote <text:note-ref text:note-class="footnote" text:reference-format="text" text:ref-name="ftn1">1</text:note-ref>.`)}`,
});

// ------------------------------------------------------------------ table of contents
const tocEntryTemplate = (level) => `<text:table-of-content-entry-template text:outline-level="${level}" text:style-name="Contents_20_${level}"><text:index-entry-link-start text:style-name="Index_20_Link"/><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/><text:index-entry-link-end/></text:table-of-content-entry-template>`;
const tocLine = (level, text, page, ref) => `<text:p text:style-name="Contents_20_${level}"><text:a xlink:type="simple" xlink:href="#${ref}|outline" text:style-name="Index_20_Link" text:visited-style-name="Index_20_Link">${text}<text:tab/>${page}</text:a></text:p>`;
add('toc', {
  title: 'Table of contents',
  extraStyles: `
  <style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Heading" style:class="index"><style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>
  ${[1, 2, 3].map((l) => `<style:style style:name="Contents_20_${l}" style:display-name="Contents ${l}" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-left="${(l - 1) * 0.5}cm"><style:tab-stops><style:tab-stop style:position="15.92cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style>`).join('\n  ')}
  <style:style style:name="Index_20_Link" style:display-name="Index Link" style:family="text"/>`,
  contentAutoStyles: `
  <style:style style:name="Sect1" style:family="section"><style:section-properties style:editable="false"><style:columns fo:column-count="1" fo:column-gap="0cm"/></style:section-properties></style:style>
  <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Heading_20_1"><style:paragraph-properties fo:break-before="page"/></style:style>`,
  body: `
<text:table-of-content text:style-name="Sect1" text:protected="true" text:name="Table of Contents1">
  <text:table-of-content-source text:outline-level="3">
    <text:index-title-template text:style-name="Contents_20_Heading">Contents</text:index-title-template>
    ${[1, 2, 3].map(tocEntryTemplate).join('\n    ')}
  </text:table-of-content-source>
  <text:index-body>
    <text:index-title text:style-name="Sect1" text:name="Table of Contents1_Head"><text:p text:style-name="Contents_20_Heading">Contents</text:p></text:index-title>
    ${tocLine(1, 'Introduction', 2, '1.Introduction')}
    ${tocLine(2, 'Background', 2, '1.1.Background')}
    ${tocLine(1, 'Method', 3, '2.Method')}
    ${tocLine(2, 'Materials', 3, '2.1.Materials')}
    ${tocLine(3, 'Paper and ink', 3, '2.1.1.Paper and ink')}
    ${tocLine(1, 'Results', 4, '3.Results')}
  </text:index-body>
</text:table-of-content>
<text:h text:style-name="P1" text:outline-level="1">Introduction</text:h>
${P('Text_20_body', LOREM[0])}
${H(2, 'Background')}
${P('Text_20_body', LOREM[1])}
<text:h text:style-name="P1" text:outline-level="1">Method</text:h>
${H(2, 'Materials')}
${H(3, 'Paper and ink')}
${P('Text_20_body', LOREM[2])}
<text:h text:style-name="P1" text:outline-level="1">Results</text:h>
${P('Text_20_body', LOREM[3])}`,
});

// ------------------------------------------------------------------ comments
const annotation = (name, author, initials, date, paras) => `<office:annotation office:name="${name}"><dc:creator>${esc(author)}</dc:creator><dc:date>${date}</dc:date><meta:creator-initials>${initials}</meta:creator-initials>${paras.map((p) => `<text:p>${esc(p)}</text:p>`).join('')}</office:annotation>`;
add('comments', {
  title: 'Comments',
  body: `
${H(1, 'Comments')}
${P('Standard', `${annotation('__Annotation__1', 'Ada Reviewer', 'AR', '2026-01-15T09:12:00', ['Could we say this more simply?'])}This sentence has a comment over a range of text<office:annotation-end office:name="__Annotation__1"/> and then continues.`)}
${P('Standard', `A point comment here.${annotation('__Annotation__2', 'Ben Author', 'BA', '2026-01-15T09:30:00', ['A comment with two paragraphs.', 'This is the second paragraph.'])}`)}
${P('Standard', `${annotation('__Annotation__3', 'Ada Reviewer', 'AR', '2026-01-15T10:00:00', ['Range that spans', 'two paragraphs.'])}Start of a range that`)}
${P('Standard', `spans paragraphs<office:annotation-end office:name="__Annotation__3"/>.`)}
${P('Standard', `${annotation('__Annotation__4', 'Café Ünïcode', 'CÜ', '2026-01-15T11:00:00', ['Unicode author & <special> characters.'])}Unicode author comment<office:annotation-end office:name="__Annotation__4"/>.`)}`,
});

// ------------------------------------------------------------------ tracked changes
const changeInfo = (author, date) => `<office:change-info><dc:creator>${esc(author)}</dc:creator><dc:date>${date}</dc:date></office:change-info>`;
add('tracked-changes', {
  title: 'Tracked changes',
  contentAutoStyles: `
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>`,
  textPrefix: `<text:tracked-changes text:track-changes="true">
  <text:changed-region xml:id="ct1" text:id="ct1"><text:insertion>${changeInfo('Ada Reviewer', '2026-01-15T09:00:00')}</text:insertion></text:changed-region>
  <text:changed-region xml:id="ct2" text:id="ct2"><text:deletion>${changeInfo('Ben Author', '2026-01-15T09:05:00')}<text:p text:style-name="Standard">removed words </text:p></text:deletion></text:changed-region>
  <text:changed-region xml:id="ct3" text:id="ct3"><text:format-change>${changeInfo('Ada Reviewer', '2026-01-15T09:10:00')}</text:format-change></text:changed-region>
  <text:changed-region xml:id="ct4" text:id="ct4"><text:insertion>${changeInfo('Ben Author', '2026-01-15T09:15:00')}</text:insertion></text:changed-region>
</text:tracked-changes>
`,
  body: `
${H(1, 'Tracked changes')}
${P('Standard', `This paragraph has <text:change-start text:change-id="ct1"/>inserted text <text:change-end text:change-id="ct1"/>and a deletion here: <text:change text:change-id="ct2"/>then it continues.`)}
${P('Standard', `A <text:change-start text:change-id="ct3"/>${span('T1', 'formatting change')}<text:change-end text:change-id="ct3"/> was made to these words.`)}
${P('Standard', `<text:change-start text:change-id="ct4"/>A whole inserted paragraph by another author.`)}
${P('Standard', `Its insertion ends here.<text:change-end text:change-id="ct4"/>`)}`,
});

// ------------------------------------------------------------------ sections and columns
add('sections-columns', {
  title: 'Sections and columns',
  stylesAutoStyles: `
  ${A4_PAGE_LAYOUT('pm1')}
  <style:page-layout style:name="pm2">
    <style:page-layout-properties fo:page-width="29.7cm" fo:page-height="21cm" style:print-orientation="landscape" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm" style:writing-mode="lr-tb"/>
  </style:page-layout>
  <style:page-layout style:name="pm3">
    <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm" style:writing-mode="lr-tb">
      <style:columns fo:column-count="2" fo:column-gap="1.25cm"><style:column-sep style:width="0.02cm" style:color="#000000" style:height="100%" style:vertical-align="top"/></style:columns>
    </style:page-layout-properties>
  </style:page-layout>`,
  masterStyles: `
  <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
  <style:master-page style:name="Landscape" style:page-layout-name="pm2"/>
  <style:master-page style:name="TwoColumnPage" style:page-layout-name="pm3"/>`,
  contentAutoStyles: `
  <style:style style:name="Sect1" style:family="section"><style:section-properties text:dont-balance-text-columns="false" style:editable="false"><style:columns fo:column-count="2" fo:column-gap="0.6cm"><style:column style:rel-width="32767*" fo:start-indent="0cm" fo:end-indent="0.3cm"/><style:column style:rel-width="32768*" fo:start-indent="0.3cm" fo:end-indent="0cm"/></style:columns></style:section-properties></style:style>
  <style:style style:name="Sect2" style:family="section"><style:section-properties fo:background-color="#eef0ff" style:editable="false"><style:columns fo:column-count="3" fo:column-gap="0.5cm"/></style:section-properties></style:style>
  <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard" style:master-page-name="Landscape"><style:paragraph-properties style:page-number="auto"/></style:style>
  <style:style style:name="P2" style:family="paragraph" style:parent-style-name="Standard" style:master-page-name="Standard"><style:paragraph-properties style:page-number="5"/></style:style>
  <style:style style:name="P3" style:family="paragraph" style:parent-style-name="Standard" style:master-page-name="TwoColumnPage"/>
  <style:style style:name="P4" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="column"/></style:style>`,
  body: `
${H(1, 'Sections and columns')}
${P('Standard', 'Single-column text before a two-column section.')}
<text:section text:style-name="Sect1" text:name="TwoColumns">
${LOREM.map((l) => P('Text_20_body', l)).join('\n')}
${P('P4', 'This paragraph starts in the next column (column break).')}
</text:section>
<text:section text:style-name="Sect2" text:name="ThreeColumnsShaded">
${LOREM.slice(0, 3).map((l) => P('Text_20_body', l)).join('\n')}
<text:section text:name="NestedSection">${P('Standard', 'A section nested inside another section.')}</text:section>
</text:section>
<text:section text:name="ProtectedSection" text:protected="true">${P('Standard', 'A protected section.')}</text:section>
${P('P1', 'This paragraph switches to a landscape master page (new page).')}
${P('Standard', 'Landscape page content.')}
${P('P2', 'Back to portrait with page numbering restarted at 5.')}
${P('P3', 'A master page with two page columns and a separator line.')}
${LOREM.map((l) => P('Text_20_body', l)).join('\n')}`,
});

// ------------------------------------------------------------------ bookmarks and fields
add('bookmarks-fields', {
  title: 'Bookmarks and fields',
  extraStyles: `
  <number:date-style style:name="N1"><number:day number:style="long"/><number:text> </number:text><number:month number:textual="true"/><number:text> </number:text><number:year number:style="long"/></number:date-style>
  <number:time-style style:name="N2"><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/></number:time-style>`,
  textPrefix: `<text:variable-decls><text:variable-decl office:value-type="float" text:name="Counter"/></text:variable-decls>
<text:user-field-decls><text:user-field-decl office:value-type="string" office:string-value="Studio North" text:name="Company"/></text:user-field-decls>
`,
  body: `
${H(1, '<text:bookmark text:name="_Toc_intro"/>Bookmarks and fields')}
${P('Standard', `A <text:bookmark-start text:name="range_bookmark"/>range bookmark<text:bookmark-end text:name="range_bookmark"/> and a point bookmark<text:bookmark text:name="point_bookmark"/>.`)}
${P('Standard', `Reference to heading: <text:bookmark-ref text:reference-format="text" text:ref-name="_Toc_intro">Bookmarks and fields</text:bookmark-ref>; to page: <text:bookmark-ref text:reference-format="page" text:ref-name="range_bookmark">1</text:bookmark-ref>.`)}
${P('Standard', `Date <text:date style:data-style-name="N1" text:date-value="2026-01-15T10:30:00" text:fixed="true">15 January 2026</text:date>, time <text:time style:data-style-name="N2" text:time-value="2026-01-15T10:30:00" text:fixed="true">10:30</text:time>, page <text:page-number text:select-page="current">1</text:page-number> of <text:page-count>1</text:page-count>.`)}
${P('Standard', `Author <text:initial-creator>Fixture Generator</text:initial-creator>, title <text:title>Bookmarks and fields</text:title>, subject <text:subject/>, file name <text:file-name text:display="name">bookmarks-fields</text:file-name>.`)}
${P('Standard', `Variable <text:variable-set text:name="Counter" office:value-type="float" office:value="7" text:display="value">7</text:variable-set>, user field <text:user-field-get text:name="Company">Studio North</text:user-field-get>.`)}
${P('Standard', `Merge field: <text:database-display text:table-name="Recipients" text:table-type="table" text:column-name="FirstName" text:database-name="Contacts">&lt;FirstName&gt;</text:database-display>.`)}
${P('Standard', `Hidden text field: <text:hidden-text text:condition="ooow:1==1" text:string-value="hidden when true" text:is-hidden="true"/>; placeholder <text:placeholder text:placeholder-type="text" text:description="Type here">&lt;Type here&gt;</text:placeholder>.`)}
${P('Standard', `Links: <text:a xlink:type="simple" xlink:href="#range_bookmark">internal link</text:a>, <text:a xlink:type="simple" xlink:href="mailto:someone@example.org">email link</text:a>, <text:a xlink:type="simple" xlink:href="https://example.org/path?q=1&amp;r=2" office:target-frame-name="_blank" xlink:show="new">external link</text:a>.`)}
${P('Standard', `Ruby: <text:ruby><text:ruby-base>漢字</text:ruby-base><text:ruby-text>かんじ</text:ruby-text></text:ruby>; soft page break follows.<text:soft-page-break/>`)}`,
});

// ------------------------------------------------------------------ long documents (performance)
function longDoc(pages) {
  const paras = [];
  const perPage = 9; // ~ nine 3-line paragraphs + a heading ≈ one A4 page
  for (let p = 1; p <= pages; p++) {
    paras.push(H(p % 5 === 1 ? 1 : 2, `Section ${p}`));
    for (let i = 0; i < perPage; i++) paras.push(P('Text_20_body', `${p}.${i + 1} ${LOREM[(p + i) % LOREM.length]} ${LOREM[(p + i + 2) % LOREM.length]} ${LOREM[(p + i + 4) % LOREM.length]}`));
  }
  return paras.join('\n');
}
add('long-50-pages', { title: 'Long document (≈50 pages)', body: longDoc(50) });
add('long-100-pages', { title: 'Long document (≈100 pages)', body: longDoc(100) });

// ------------------------------------------------------------------ template (.ott)
add('template', {
  title: 'Template',
  ext: 'ott',
  mime: 'application/vnd.oasis.opendocument.text-template',
  body: `${P('Title', 'Template title')}\n${P('Text_20_body', '<text:placeholder text:placeholder-type="text" text:description="Body">&lt;Write here&gt;</text:placeholder>')}`,
});

// ------------------------------------------------------------------ write
for (const name of readdirSync(OUT)) if (/\.(odt|ott)$/.test(name) && !name.startsWith('lo-')) rmSync(path.join(OUT, name));
const written = [];
for (const [name, def] of Object.entries(fixtures)) {
  const file = path.join(OUT, `${name}.${def.ext || 'odt'}`);
  writeFileSync(file, buildOdt(def));
  written.push(file);
}
console.log(`wrote ${written.length} fixtures to ${path.relative(process.cwd(), OUT)}/`);

// ------------------------------------------------------------------ LibreOffice
function findSoffice() {
  for (const bin of ['soffice', 'libreoffice']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60_000 });
    if (r.status === 0) return { bin, version: r.stdout.trim() };
  }
  return null;
}

const soffice = findSoffice();
if (!soffice) {
  console.log('soffice: NOT installed — skipping LibreOffice exports and checks (committed lo-*.odt files are used).');
} else {
  console.log(`soffice: ${soffice.version}`);
  const work = mkdtempSync(path.join(tmpdir(), 'odt-fixtures-'));
  const profile = `file://${path.join(work, 'profile')}`;
  const run = (args) => execFileSync(soffice.bin, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', ...args], { stdio: 'pipe', timeout: 180_000 });

  // Genuine LibreOffice-written files: round-trip a few fixtures through Writer.
  const LO_SOURCES = ['formatting-zoo', 'styles', 'lists', 'tables', 'images', 'headers-footers', 'footnotes', 'comments', 'tracked-changes', 'sections-columns'];
  const inDir = path.join(work, 'in');
  const outDir = path.join(work, 'out');
  mkdirSync(inDir);
  for (const n of LO_SOURCES) copyFileSync(path.join(OUT, `${n}.odt`), path.join(inDir, `${n}.odt`));
  // Converting .odt → .odt with a filter makes Writer load and re-save it.
  run(['--convert-to', 'odt:writer8', '--outdir', outDir, ...LO_SOURCES.map((n) => path.join(inDir, `${n}.odt`))]);
  for (const n of LO_SOURCES) {
    const src = path.join(outDir, `${n}.odt`);
    if (!existsSync(src)) throw new Error(`LibreOffice did not produce ${n}.odt`);
    copyFileSync(src, path.join(OUT, `lo-${n}.odt`));
  }
  console.log(`wrote ${LO_SOURCES.length} LibreOffice-exported fixtures (lo-*.odt)`);

  if (process.argv.includes('--check')) {
    const txtDir = path.join(work, 'txt');
    const all = readdirSync(OUT).filter((f) => /\.(odt|ott)$/.test(f)).map((f) => path.join(OUT, f));
    run(['--convert-to', 'txt:Text (encoded):UTF8', '--outdir', txtDir, ...all]);
    let failed = 0;
    for (const f of all) {
      const txt = path.join(txtDir, path.basename(f).replace(/\.(odt|ott)$/, '.txt'));
      if (!existsSync(txt) || readFileSync(txt, 'utf8').trim().length === 0) { console.error(`  FAIL: LibreOffice could not read ${path.basename(f)}`); failed++; }
    }
    console.log(failed ? `${failed} fixture(s) failed the LibreOffice check` : `LibreOffice opened all ${all.length} fixtures`);
    if (failed) process.exitCode = 1;
  }
  rmSync(work, { recursive: true, force: true });
}
