3tap toolbar update

- Uses Lucide SVG geometry for LogIn, Archive, KeyRound, Sun, and Moon.
- Normalizes all toolbar icons to 16x16 with 1.5 stroke width.
- Adds restrained theme-aware action colors:
  - add device: blue
  - archive: orange
  - recovery: violet
  - theme: indigo
- Hover states brighten within each theme.

Apply from the project root:
unzip -o ~/Downloads/3tap-lucide-toolbar-patch.zip
npm run dev
