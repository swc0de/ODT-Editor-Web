/** fontkit (MIT): reads the bundled WOFF2 fonts for PDF and XPS (core/fixed), loaded on first use. */
import * as fontkit from 'fontkit';

export const create = (bytes) => fontkit.create(bytes);
