/**
 * ODF namespaces with their canonical prefixes. Documents may use other
 * prefixes for these URIs; the importer maps them to the canonical ones so
 * the model always uses "text:p", "style:name"… Unknown namespaces keep the
 * document's own prefix and are re-declared on export.
 */
export const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  dc: 'http://purl.org/dc/elements/1.1/',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  number: 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  chart: 'urn:oasis:names:tc:opendocument:xmlns:chart:1.0',
  dr3d: 'urn:oasis:names:tc:opendocument:xmlns:dr3d:1.0',
  math: 'http://www.w3.org/1998/Math/MathML',
  form: 'urn:oasis:names:tc:opendocument:xmlns:form:1.0',
  script: 'urn:oasis:names:tc:opendocument:xmlns:script:1.0',
  config: 'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  smil: 'urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0',
  anim: 'urn:oasis:names:tc:opendocument:xmlns:animation:1.0',
  db: 'urn:oasis:names:tc:opendocument:xmlns:database:1.0',
  of: 'urn:oasis:names:tc:opendocument:xmlns:of:1.2',
  xhtml: 'http://www.w3.org/1999/xhtml',
  grddl: 'http://www.w3.org/2003/g/data-view#',
  xforms: 'http://www.w3.org/2002/xforms',
  xsd: 'http://www.w3.org/2001/XMLSchema',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  dom: 'http://www.w3.org/2001/xml-events',
  ooo: 'http://openoffice.org/2004/office',
  ooow: 'http://openoffice.org/2004/writer',
  oooc: 'http://openoffice.org/2004/calc',
  rpt: 'http://openoffice.org/2005/report',
  officeooo: 'http://openoffice.org/2009/office',
  tableooo: 'http://openoffice.org/2009/table',
  drawooo: 'http://openoffice.org/2010/draw',
  calcext: 'urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0',
  loext: 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0',
  field: 'urn:openoffice:names:experimental:ooo-ms-interop:xmlns:field:1.0',
  formx: 'urn:openoffice:names:experimental:ooxml-odf-interop:xmlns:form:1.0',
  css3t: 'http://www.w3.org/TR/css3-text/',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  xml: 'http://www.w3.org/XML/1998/namespace',
};

export const PREFIX_BY_URI = Object.fromEntries(Object.entries(NS).map(([p, u]) => [u, p]));

/** Namespaces declared on every content/styles root we write. */
export const ROOT_PREFIXES = Object.keys(NS).filter((p) => p !== 'manifest' && p !== 'xml' && p !== 'config');
