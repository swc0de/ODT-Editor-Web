/**
 * styles.xml of a new document: Word-like defaults (Aptos 12 pt with Carlito
 * as the bundled stand-in, en-GB, A4 with 2.54 cm margins) and the styles the
 * Home ▸ Styles gallery shows. Names follow LibreOffice conventions so files
 * look native there ("Standard" is shown as "Normal" here).
 */
import { nsDeclarations } from './xml.js';
import { ROOT_PREFIXES } from './namespaces.js';

const H = (n, size, extra = '') => `
  <style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:default-outline-level="${n}" style:class="text">
   <style:paragraph-properties fo:margin-top="${n === 1 ? '0.635cm' : '0.282cm'}" fo:margin-bottom="${n === 1 ? '0.141cm' : '0.141cm'}"/>
   <style:text-properties fo:font-size="${size}" fo:color="#0f4761"${extra}/>
  </style:style>`;

const bulletLevels = ['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪', '•'];
const numberFormats = ['1', 'a', 'i', '1', 'a', 'i', '1', 'a', 'i', '1'];
const indent = (i) => (0.635 * (i + 1)).toFixed(3);

export const DEFAULT_STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles${nsDeclarations(ROOT_PREFIXES)} office:version="1.3">
 <office:font-face-decls>
  <style:font-face style:name="Aptos" svg:font-family="Aptos" style:font-family-generic="swiss" style:font-pitch="variable"/>
  <style:font-face style:name="Aptos Display" svg:font-family="'Aptos Display'" style:font-family-generic="swiss" style:font-pitch="variable"/>
  <style:font-face style:name="Carlito" svg:font-family="Carlito" style:font-family-generic="swiss" style:font-pitch="variable"/>
  <style:font-face style:name="Caladea" svg:font-family="Caladea" style:font-family-generic="roman" style:font-pitch="variable"/>
  <style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss" style:font-pitch="variable"/>
  <style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman" style:font-pitch="variable"/>
  <style:font-face style:name="Liberation Mono" svg:font-family="'Liberation Mono'" style:font-family-generic="modern" style:font-pitch="fixed"/>
 </office:font-face-decls>
 <office:styles>
  <style:default-style style:family="graphic">
   <style:graphic-properties svg:stroke-color="#3465a4" draw:fill-color="#729fcf" fo:wrap-option="no-wrap" draw:shadow-offset-x="0.3cm" draw:shadow-offset-y="0.3cm" style:flow-with-text="false"/>
  </style:default-style>
  <draw:marker draw:name="Arrow" svg:viewBox="0 0 20 30" svg:d="M10 0l-10 30h20z"/>
  <draw:stroke-dash draw:name="Fine_20_Dotted" draw:display-name="Fine Dotted" draw:style="round" draw:dots1="1" draw:dots1-length="100%" draw:distance="100%"/>
  <draw:stroke-dash draw:name="Dot" draw:style="rect" draw:dots1="1" draw:dots1-length="100%" draw:distance="100%"/>
  <draw:stroke-dash draw:name="Dash" draw:style="rect" draw:dots1="1" draw:dots1-length="300%" draw:distance="100%"/>
  <draw:stroke-dash draw:name="Long_20_Dash" draw:display-name="Long Dash" draw:style="rect" draw:dots1="1" draw:dots1-length="800%" draw:distance="300%"/>
  <draw:stroke-dash draw:name="Dash_20_Dot" draw:display-name="Dash Dot" draw:style="rect" draw:dots1="1" draw:dots1-length="300%" draw:dots2="1" draw:dots2-length="100%" draw:distance="100%"/>
  <style:style style:name="Graphics" style:family="graphic">
   <style:graphic-properties text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" style:wrap="dynamic" style:number-wrapped-paragraphs="no-limit" style:wrap-contour="false" style:vertical-pos="top" style:vertical-rel="paragraph" style:horizontal-pos="center" style:horizontal-rel="paragraph"/>
  </style:style>
  <style:style style:name="Frame" style:family="graphic">
   <style:graphic-properties text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" fo:margin-left="0.201cm" fo:margin-right="0.201cm" fo:margin-top="0.201cm" fo:margin-bottom="0.201cm" style:wrap="parallel" style:number-wrapped-paragraphs="no-limit" style:wrap-contour="false" style:vertical-pos="top" style:vertical-rel="paragraph-content" style:horizontal-pos="center" style:horizontal-rel="paragraph-content" fo:padding="0.15cm" fo:border="0.06pt solid #000000"/>
  </style:style>
  <style:default-style style:family="paragraph">
   <style:paragraph-properties fo:orphans="2" fo:widows="2" fo:hyphenation-ladder-count="no-limit" style:text-autospace="ideograph-alpha" style:punctuation-wrap="hanging" style:line-break="strict" style:tab-stop-distance="1.27cm" style:writing-mode="page"/>
   <style:text-properties style:font-name="Aptos" fo:font-size="12pt" fo:language="en" fo:country="GB" style:letter-kerning="true" fo:hyphenate="false" fo:hyphenation-remain-char-count="2" fo:hyphenation-push-char-count="2"/>
  </style:default-style>
  <style:default-style style:family="table">
   <style:table-properties table:border-model="collapsing"/>
  </style:default-style>
  <style:default-style style:family="table-row">
   <style:table-row-properties fo:keep-together="auto"/>
  </style:default-style>
  <style:style style:name="Standard" style:display-name="Normal" style:family="paragraph" style:class="text">
   <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.282cm" fo:line-height="115%"/>
  </style:style>
  <style:style style:name="No_20_Spacing" style:display-name="No Spacing" style:family="paragraph" style:parent-style-name="Standard" style:class="text">
   <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:line-height="100%"/>
  </style:style>
  <style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text">
   <style:paragraph-properties fo:keep-with-next="always"/>
   <style:text-properties style:font-name="Aptos Display"/>
  </style:style>${H(1, '20pt')}${H(2, '16pt')}${H(3, '14pt')}${H(4, '12pt', ' fo:font-style="italic"')}
  <style:style style:name="Title" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:class="chapter">
   <style:paragraph-properties fo:margin-bottom="0.141cm" fo:line-height="100%"/>
   <style:text-properties fo:font-size="28pt" fo:letter-spacing="-0.018cm"/>
  </style:style>
  <style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:class="chapter">
   <style:paragraph-properties fo:margin-bottom="0.282cm"/>
   <style:text-properties style:font-name="Aptos" fo:font-size="14pt" fo:color="#595959" fo:letter-spacing="0.026cm"/>
  </style:style>
  <style:style style:name="Quote" style:family="paragraph" style:parent-style-name="Standard" style:class="html">
   <style:paragraph-properties fo:margin-left="2.032cm" fo:margin-right="2.032cm" fo:margin-top="0.282cm" fo:text-align="center"/>
   <style:text-properties fo:font-style="italic" fo:color="#404040"/>
  </style:style>
  <style:style style:name="Intense_20_Quote" style:display-name="Intense Quote" style:family="paragraph" style:parent-style-name="Standard" style:class="html">
   <style:paragraph-properties fo:margin-left="2.032cm" fo:margin-right="2.032cm" fo:margin-top="0.635cm" fo:margin-bottom="0.635cm" fo:text-align="center" fo:padding="0.353cm" fo:border-top="0.51pt solid #0f4761" fo:border-bottom="0.51pt solid #0f4761" fo:border-left="none" fo:border-right="none"/>
   <style:text-properties fo:font-style="italic" fo:color="#0f4761"/>
  </style:style>
  <style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard" style:class="list">
   <style:paragraph-properties fo:margin-left="1.27cm"/>
  </style:style>
  <style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
   <style:paragraph-properties fo:margin-bottom="0cm" fo:line-height="100%"/>
  </style:style>
  <style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents" style:class="extra">
   <style:text-properties fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="Caption" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
   <style:paragraph-properties fo:margin-bottom="0.353cm" fo:line-height="100%"/>
   <style:text-properties fo:font-size="9pt" fo:font-style="italic" fo:color="#0e2841"/>
  </style:style>
  <style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
   <style:paragraph-properties fo:margin-bottom="0cm" fo:line-height="100%"><style:tab-stops><style:tab-stop style:position="7.96cm" style:type="center"/><style:tab-stop style:position="15.92cm" style:type="right"/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
   <style:paragraph-properties fo:margin-bottom="0cm" fo:line-height="100%"><style:tab-stops><style:tab-stop style:position="7.96cm" style:type="center"/><style:tab-stop style:position="15.92cm" style:type="right"/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Footnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
   <style:paragraph-properties fo:margin-bottom="0cm" fo:line-height="100%"/>
   <style:text-properties fo:font-size="10pt"/>
  </style:style>
  <style:style style:name="Endnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
   <style:paragraph-properties fo:margin-bottom="0cm" fo:line-height="100%"/>
   <style:text-properties fo:font-size="10pt"/>
  </style:style>
  <style:style style:name="Index" style:family="paragraph" style:parent-style-name="Standard" style:class="index">
   <style:paragraph-properties fo:margin-bottom="0.176cm"/>
  </style:style>
  <style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="index">
   <style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" fo:keep-with-next="always"/>
   <style:text-properties fo:font-size="16pt" fo:color="#0f4761" style:font-name="Aptos Display"/>
  </style:style>
  <style:style style:name="Contents_20_1" style:display-name="Contents 1" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="0.000cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="15.920cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Contents_20_2" style:display-name="Contents 2" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="0.388cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="15.532cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Contents_20_3" style:display-name="Contents 3" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="0.776cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="15.144cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Contents_20_4" style:display-name="Contents 4" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="1.164cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="14.756cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Contents_20_5" style:display-name="Contents 5" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="1.552cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="14.368cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Contents_20_6" style:display-name="Contents 6" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="1.940cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="13.980cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Contents_20_7" style:display-name="Contents 7" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="2.328cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="13.592cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Contents_20_8" style:display-name="Contents 8" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="2.716cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="13.204cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Contents_20_9" style:display-name="Contents 9" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="3.104cm" fo:margin-right="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="12.816cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Illustration_20_Index_20_Heading" style:display-name="Table of Figures Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="index">
   <style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" fo:keep-with-next="always"/>
   <style:text-properties fo:font-size="16pt" fo:color="#0f4761" style:font-name="Aptos Display"/>
  </style:style>
  <style:style style:name="Illustration_20_Index_20_1" style:display-name="Table of Figures" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="0cm" fo:text-indent="0cm"><style:tab-stops><style:tab-stop style:position="15.920cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties>
  </style:style>
  <style:style style:name="Index_20_Heading" style:display-name="Index Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="index">
   <style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" fo:keep-with-next="always"/>
   <style:text-properties fo:font-size="16pt" fo:color="#0f4761" style:font-name="Aptos Display"/>
  </style:style>
  <style:style style:name="Index_20_1" style:display-name="Index 1" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="0.500cm" fo:text-indent="-0.5cm" fo:margin-bottom="0cm"/>
  </style:style>
  <style:style style:name="Index_20_2" style:display-name="Index 2" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="1.000cm" fo:text-indent="-0.5cm" fo:margin-bottom="0cm"/>
  </style:style>
  <style:style style:name="Index_20_3" style:display-name="Index 3" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="1.500cm" fo:text-indent="-0.5cm" fo:margin-bottom="0cm"/>
  </style:style>
  <style:style style:name="Index_20_Separator" style:display-name="Index Separator" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-top="0.212cm" fo:margin-bottom="0.106cm" fo:keep-with-next="always"/>
   <style:text-properties fo:font-weight="bold" fo:color="#0f4761"/>
  </style:style>
  <style:style style:name="Bibliography_20_Heading" style:display-name="Bibliography Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="index">
   <style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm" fo:keep-with-next="always"/>
   <style:text-properties fo:font-size="16pt" fo:color="#0f4761" style:font-name="Aptos Display"/>
  </style:style>
  <style:style style:name="Bibliography_20_1" style:display-name="Bibliography 1" style:family="paragraph" style:parent-style-name="Index" style:class="index">
   <style:paragraph-properties fo:margin-left="1.27cm" fo:text-indent="-1.27cm" fo:margin-bottom="0.212cm"/>
  </style:style>
  <style:style style:name="Endnote_20_Heading" style:display-name="Endnotes Heading" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">
   <style:paragraph-properties fo:margin-top="0.423cm" fo:margin-bottom="0.212cm"/>
   <style:text-properties fo:font-size="12pt" fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="Emphasis" style:family="text">
   <style:text-properties fo:font-style="italic"/>
  </style:style>
  <style:style style:name="Strong_20_Emphasis" style:display-name="Strong" style:family="text">
   <style:text-properties fo:font-weight="bold"/>
  </style:style>
  <style:style style:name="Subtle_20_Emphasis" style:display-name="Subtle Emphasis" style:family="text">
   <style:text-properties fo:font-style="italic" fo:color="#404040"/>
  </style:style>
  <style:style style:name="Intense_20_Emphasis" style:display-name="Intense Emphasis" style:family="text">
   <style:text-properties fo:font-style="italic" fo:color="#0f4761"/>
  </style:style>
  <style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text">
   <style:text-properties fo:color="#467886" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/>
  </style:style>
  <style:style style:name="Index_20_Link" style:display-name="Index Link" style:family="text"/>
  <style:style style:name="Footnote_20_anchor" style:display-name="Footnote anchor" style:family="text">
   <style:text-properties style:text-position="super 58%"/>
  </style:style>
  <style:style style:name="Endnote_20_anchor" style:display-name="Endnote anchor" style:family="text">
   <style:text-properties style:text-position="super 58%"/>
  </style:style>
  <text:list-style style:name="List_20_Bullet" style:display-name="List Bullet">
   ${bulletLevels.map((ch, i) => `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${ch}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${indent(i)}cm" fo:text-indent="-0.635cm" fo:margin-left="${indent(i)}cm"/></style:list-level-properties></text:list-level-style-bullet>`).join('\n   ')}
  </text:list-style>
  <text:list-style style:name="Numbering_20_123" style:display-name="Numbering 123">
   ${numberFormats.map((f, i) => `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${f}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${indent(i)}cm" fo:text-indent="-0.635cm" fo:margin-left="${indent(i)}cm"/></style:list-level-properties></text:list-level-style-number>`).join('\n   ')}
  </text:list-style>
  <text:outline-style style:name="Outline">
   ${Array.from({ length: 10 }, (_, i) => `<text:outline-level-style text:level="${i + 1}" style:num-format=""><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab"/></style:list-level-properties></text:outline-level-style>`).join('\n   ')}
  </text:outline-style>
  <text:notes-configuration text:note-class="footnote" text:citation-style-name="Footnote_20_anchor" style:num-format="1" text:start-value="0" text:footnotes-position="page" text:start-numbering-at="document"/>
  <text:notes-configuration text:note-class="endnote" text:citation-style-name="Endnote_20_anchor" style:num-format="i" text:start-value="0"/>
  <text:linenumbering-configuration text:number-lines="false" text:offset="0.499cm" style:num-format="1" text:number-position="left" text:increment="5"/>
 </office:styles>
 <office:automatic-styles>
  <style:page-layout style:name="pm1">
   <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" style:num-format="1" style:print-orientation="portrait" fo:margin-top="2.54cm" fo:margin-bottom="2.54cm" fo:margin-left="2.54cm" fo:margin-right="2.54cm" style:writing-mode="lr-tb"/>
   <style:header-style/>
   <style:footer-style/>
  </style:page-layout>
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
 </office:master-styles>
</office:document-styles>
`;
