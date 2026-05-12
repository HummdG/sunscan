# Stock tileable textures

These 512² tileable PBR base-color textures are used as fallback materials when
photo-projection coverage on a face is below 30%. They are tinted at render
time by `material.color` from `spec.materials.wallColor` / `roofColor`.

Required filenames (all `.jpg`, sRGB, 512×512, seamlessly tileable):
- `brick-tileable.jpg`
- `render-tileable.jpg`
- `stone-tileable.jpg`
- `timber-tileable.jpg`
- `pebble-dash-tileable.jpg`
- `tile-tileable.jpg`
- `slate-tileable.jpg`
- `thatch-tileable.jpg`
- `metal-tileable.jpg`

Sourcing: use CC0 or compatible textures (ambientcg.com, polyhaven.com).
Each file should be ~80 KB after JPEG encoding at quality 85.

Until the real assets are added, `stockTextures.ts` falls back to a flat
1×1 white texture and tinting still works.
