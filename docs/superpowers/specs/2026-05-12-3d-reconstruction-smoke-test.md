# 3D reconstruction — manual smoke test

The spec-driven reconstruction is complete. This is the human-driven E2E verification.

## Environment setup

Ensure `.env.local` has all of:
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Map Tiles API enabled
- `GOOGLE_SOLAR_API_KEY` — Solar API
- `ANTHROPIC_API_KEY` — server-only; new for this work
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — spec cache

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Test 1: The original bug-report address

Search for: `3A, DOWNS WALK, PEACEHAVEN, BN10 7SN`

Wait for the 3D model tab to populate. Then verify in the browser console:

- [ ] Console logs `[recon] spec generated { source: 'agent', cached: false, confidence: 'high' | 'medium' }`
- [ ] The 3D model is **recognisably a house** — walls, pitched roof, plausible shape. **NOT a black blob.**
- [ ] If a chimney/dormer is visible on the Satellite tab, it's also visible on the 3D model (Claude's feature extraction)
- [ ] The roof segments shown on the page (`N 19° 157 m²`, `S 40° 40 m²`, etc.) align with the rendered roof orientation

## Test 2: FALLBACK_SPEC path (no Anthropic key)

1. Temporarily comment out `ANTHROPIC_API_KEY` in `.env.local`
2. Restart `npm run dev`
3. Reload the same address
4. Verify:
   - [ ] Console shows `source: 'fallback'`
   - [ ] Model is simpler (gable on longest axis, generic colors), but still recognisable as a house
5. Restore the key

## Test 3: Cache hit

1. With `ANTHROPIC_API_KEY` set, reload the same Peacehaven address
2. Verify:
   - [ ] Console shows `cached: true`
   - [ ] Model appears within ~1 second (no Claude inference latency)

## Test 4: Tile capture fallback (Level 4 DSM)

1. Temporarily unset `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
2. Reload
3. Verify:
   - [ ] Viewer shows the DSM heightmap mesh (no model fail/blob)
4. Restore the key

## Test 5: Additional addresses

Pick 3 UK addresses covering: rectangular footprint, L-shape, address with no Solar segment data. Run each through the wizard.

For each:
- [ ] Reaches Level 0 or 1 (not 2 fallback)
- [ ] Model is recognisable as the property
- [ ] No black blobs, no error toasts, no empty viewers

## Acceptance

Pass when all checkboxes above are checked.

## Known limitations (documented in design)

- Hip/mansard/mixed roof types are visual approximations, not CAD-grade.
- Photo projection uses a heuristic coverage estimate (>=3 captures → assume 85% coverage). If walls/roof look muddy, extend `textureRebaker.ts` to surface real coverage stats.
- Stock textures in `public/textures/` are placeholders (1×1 white fallback). For higher-fidelity rendering, drop real tileable JPEGs in that directory using the filenames in `public/textures/README.md`.
