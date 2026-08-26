# Jobbox marks

The mark is the **bb** at the centre of jo**bb**ox, knocked out of a rounded square. It is a
hole rather than a drawing — the letters take the colour of whatever sits behind the tile, so
one file covers light mode, dark mode and reversed use without a second asset.

Geometry, on a 128 grid: stem width 10, bowl radius 15, round terminals, corner radius 28.
The bowl of the first `b` is tangent to the stem of the second, which is what keeps the pair
reading as one word at small sizes. Nothing else is tuned by eye — every coordinate falls out
of those four numbers.

## Files

| File | Use |
|---|---|
| `mark.svg` | The tile, drawn in `currentColor`. For **inlining** into HTML/JSX where the surrounding text colour should drive it. |
| `icon.svg` | The tile in `#007aff`. For `<img>`, favicons, and anywhere a fixed colour is wanted. |
| `icon-macos.svg` | Same tile inset on Apple's 1024 icon grid (824 artwork, 100 margin). Source for the app icon. |
| `wordmark.svg` | "Jobbox" with a blue `bb`, dark ink. **For light backgrounds.** |
| `wordmark-ondark.svg` | Same, light ink. **For dark backgrounds.** |
| `wordmark-mono.svg` | Single colour, no blue. For solid accent fills and photography, where a blue `bb` would disappear. |
| `lockup.svg` | Tile + wordmark, dark ink. For light backgrounds. |
| `lockup-ondark.svg` | Tile + wordmark, light ink. For dark backgrounds. |

Every file accepts `--jobbox-ink` and `--jobbox-accent` as CSS custom properties when it is
inlined, so a page with its own tokens can override both without a new asset.

## Two things that will bite you

**`currentColor` does not cross an `<img>` boundary.** An SVG loaded through `<img src>` is an
isolated document; `currentColor` there resolves to black, not to the colour of the page. Use
`mark.svg` only when you are inlining the markup. Through `<img>`, reach for `icon.svg`.

**Neither does `prefers-color-scheme`, usefully.** Inside an `<img>`-loaded SVG that media
query follows the *operating system*, not the host page — so a media-query-driven wordmark
renders dark ink on a page that has pinned itself light on a Mac in dark mode, and vanishes.
That is why the light and dark wordmarks are separate files instead of one clever one. Pick
the variant that matches the background you are placing it on.

## App icon

`build/icon.png` is the 1024×1024 render of `icon-macos.svg`. `electron-builder.yml` already
points `buildResources` at `build/`, and electron-builder picks up `icon.png` there by
convention, so the packaged app uses it with no config change.

To regenerate after editing the SVG:

```bash
rsvg-convert -w 1024 -h 1024 assets/logo/icon-macos.svg -o build/icon.png
```
