#!/usr/bin/env bash
# One-off asset preparation: converts the open metric-compatible fonts
# (Carlito, Caladea, Liberation Sans/Serif/Mono — SIL OFL 1.1) to WOFF2.
#
# The conversion is LOSSLESS (a container change only: no subsetting, hinting
# kept). Carlito and Liberation carry OFL Reserved Font Names, and the OFL
# forbids modified versions from using those names, so the fonts must not be
# subset or otherwise altered.
#
# The results are committed in assets/fonts/, so normal builds don't need this.
# Requires: fonttools + brotli (pip install fonttools brotli) and the TTFs
# (Debian: fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation).
set -euo pipefail
FONTTOOLS="${FONTTOOLS:-fonttools}"
OUT="$(dirname "$0")/../assets/fonts"
mkdir -p "$OUT"
rm -f "$OUT"/*.woff2
for f in /usr/share/fonts/truetype/crosextra/{Carlito,Caladea}-*.ttf /usr/share/fonts/truetype/liberation/Liberation{Sans,Serif,Mono}-*.ttf; do
  name="$(basename "$f" .ttf)"
  "$FONTTOOLS" ttLib.woff2 compress -o "$OUT/$name.woff2" "$f"
done
ls -la "$OUT"

# Selawik (UI font, metric-compatible with Segoe UI): Microsoft publishes only
# the UFO sources, built here unmodified (needs Python with fontmake and brotli):
#   git clone --depth 1 https://github.com/microsoft/Selawik /tmp/selawik
#   for w in Regular Bold; do fontmake -u "/tmp/selawik/Source files/UFO/Selawik-$w.ufo" -o ttf --output-dir /tmp/selawik/out; done
#   python3 -c "from fontTools.ttLib import TTFont
#   for w in ('Regular','Bold'): f=TTFont(f'/tmp/selawik/out/Selawik-{w}.ttf'); f.flavor='woff2'; f.save(f'assets/fonts/Selawik-{w}.woff2')"
