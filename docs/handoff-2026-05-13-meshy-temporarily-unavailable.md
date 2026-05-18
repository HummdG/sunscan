# SunScan Meshy reconstruction — handoff

**Date:** 2026-05-13
**Branch:** `feat/meshy-reconstruction`
**Last commit:** `1089888 fix(meshy): host front image on Supabase + ASCII-only texture prompt`
**Uncommitted:** `src/lib/ai/meshyClient.ts` has a pending diff (`MESHY_API_VERSION` env override + a full-task-body dump on failure + `task_error.code` typed on the response). **Not yet committed and may not have hot-reloaded on the last test run.**

## TL;DR

The Meshy direct-API pipeline (`/api/report/[id]/reconstruction/generate` → `src/lib/ai/meshyClient.ts`) has now failed three times in a row with **`Meshy task FAILED: The generation service is temporarily unavailable. Please retry.`** — once per attempt, then retried once internally, fails again, returns HTTP 502 to the client. The Meshy status page (status.meshy.ai) shows **100% uptime over 90 days for both Web App and API**, so the error string is misleading — the service is not actually down.

Two prior fixes were aimed at known causes of this same misleading error and **did not resolve it**:

- `600481e` — added auto-retry once on transient errors
- `1089888` — switched the front image from a data URI to a Supabase signed HTTPS URL (Meshy fails on data URIs >1MB) **and** rewrote `buildTexturePrompt()` to ASCII only (`°`, `²`, `×` trip Meshy's text pipeline)

Both fixes are confirmed active in the last failing run (`imageMode: 'https-url'` in the log; the texture prompt logged was `seg1 pitch 19 deg/azimuth 164 deg (MCS)/area 156.5 sqm. seg2 pitch 40 deg/azimuth 17 deg (MCS)/area 40.3 sqm. seg3 pitch 8 deg/azimuth 25 deg (MCS)/area 16.6 sqm` — pure ASCII).

Per systematic-debugging discipline (3+ failed fixes → question fundamentals), **stop coding and gather evidence before the next attempt.** The most important missing piece is the full Meshy task JSON body (with `task_error.code` + any debug fields) — currently dumped only in the uncommitted code, which may not have run.

## Last run (the smoking-gun log)

```
[generate] POST received for report id: scratch-1778674567405 {
  hasMeshyKey: true, hasFalKey: true, hasGeminiKey: true,
  hasSupabaseUrl: true, hasSupabaseKey: true
}
[generate] cache miss, cacheKey: 6d636e23495e...
[generate] MESHY_API_KEY present, length: 40
[generate] meshy input image signed url: https://...supabase.co/.../sunscan-reports/meshy/tmp/...
[meshy] direct API: {
  imageBytes: 1848590, polycount: 30000, imageMode: 'https-url',
  urlPreview: 'https://lmygmhhjrslctlfdgliu.supabase.co/storage/v1/object/sign/sunscan-reports/'
}
[meshy] task created: 019e2144-3276-712c-936b-6adcd3ca2f0e
[meshy] transient error, retrying in 5000ms: Meshy task FAILED: The generation service is temporarily unavailable. Please retry.
[meshy] retry attempt 2/2
[meshy] task created: 019e2145-b26e-71bb-8488-08d4bbfd6089
[meshy] task failed (no more retries) {
  message: 'Meshy task FAILED: The generation service is temporarily unavailable. Please retry.',
  attempt: 2,
  texturePromptPreview: 'UK single-family house. Roof segments: seg1 pitch 19 deg/azimuth 164 deg (MCS)/area 156.5 sqm. seg2 pitch 40 deg/azimuth 17 deg (MCS)/area 40.3 sqm. seg3 pitch 8 deg/azimuth 25 deg (MCS)/area 16.6 sqm'
}
POST /api/report/scratch-1778674567405/reconstruction/generate 502 in 2.4min
```

**What this tells us:**
- Image-URL fix is in effect (`imageMode: 'https-url'`).
- ASCII prompt fix is in effect (no `°`, `²`, `×`).
- Task **creates** successfully both times → auth, image URL accessibility, payload schema all pass Meshy's input validation.
- Task **fails during generation** (~2 min in) → problem is downstream of input validation.
- The retry pattern matches `/temporarily unavailable/i` so it does retry once — and gets the same error.

**What this run is missing:** the `[meshy] task ended in failure — full task body:` JSON dump that the uncommitted code at `src/lib/ai/meshyClient.ts:163-164` adds. Either Next dev didn't hot-reload the change, or the JSON was truncated when pasted. **That dump is the highest-value evidence we don't have.**

## Surviving hypotheses (ranked)

| # | Hypothesis | Why plausible | How to confirm/refute |
|---|------------|---------------|----------------------|
| 1 | **Account-state issue** — credits exhausted, plan limit hit, building-image flag on account | Status page green + per-account calls fail = not service-wide. Status page shows aggregate availability, not per-account quota | Check Meshy dashboard (meshy.ai) for credit balance, banners, plan tier |
| 2 | **Content classifier rejecting building imagery** | Meshy's image-to-3D is marketed for assets/characters; the fal.ai variant of Meshy is character-only (documented in `CLAUDE.md` — schema includes T-pose, rigging height, animation IDs). The direct API isn't supposed to share this restriction, but "service unavailable" may be the umbrella error a content filter raises | `task_error.code` from the full body dump should be `content_policy` / `invalid_image` / similar |
| 3 | **`meshy-5` model-specific failure on this account** | `meshy-5` is the default; `meshy-4` is the prior generation. Newer model may have plan-gating or higher failure rate on certain inputs | Set `MESHY_AI_MODEL=meshy-4` in `.env.local` and retry — single env change, no code |
| 4 | **Texture prompt is CAD metadata, not natural language** | We already know prompt text can break Meshy (ASCII fix). The current prompt reads like a spec sheet (`pitch 19 deg/azimuth 164 deg/area 156.5 sqm`) which Meshy's texturing pipeline may not parse as a description | Set `should_texture: false` or pass empty `texture_prompt` and retry; or rewrite to plain English ("Detached two-storey UK house with clay tile roof and brick walls") |

## Next steps — evidence first, then one change at a time

### Step 1 — Get the full task body dump (zero code change)

The uncommitted diff in `src/lib/ai/meshyClient.ts` already adds this. To make sure it runs:

```bash
# stop any running dev server, then
npm run dev
```

Reproduce the failure (run the wizard end-to-end on the same report or scratch id). In the terminal, look for:

```
[meshy] task ended in failure — full task body: {
  "id": "...",
  "status": "FAILED",
  "task_error": { "message": "...", "code": ??? },
  ...
}
```

The `task_error.code` field plus any extra fields Meshy returns will most likely identify the actual cause and discriminate between hypotheses 1–4 above.

### Step 2 — Check the Meshy dashboard (zero code change)

Log in at https://www.meshy.ai/ → check:

- Credit / quota balance (and whether it ticked down on the failed tasks)
- Any account banners (plan limits, content warnings, billing)
- Task history: do the two failed task IDs (`019e2144-3276-712c-936b-6adcd3ca2f0e`, `019e2145-b26e-71bb-8488-08d4bbfd6089`) appear with more detail than the API returned?

### Step 3 — One-shot isolation curl (zero code change)

To rule out the entire SunScan pipeline as the problem, post a known-good test image directly:

```bash
# Replace $MESHY_API_KEY with your key
curl -s -X POST https://api.meshy.ai/openapi/v1/image-to-3d \
  -H "Authorization: Bearer $MESHY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://docs.meshy.ai/_static/sample-image-to-3d.png",
    "ai_model": "meshy-5",
    "topology": "triangle",
    "target_polycount": 30000,
    "should_remesh": true,
    "should_texture": true,
    "enable_pbr": true,
    "texture_prompt": "A small wooden chair"
  }'
```

Then poll `GET /openapi/v1/image-to-3d/{id}` every 5s. **If this also fails with the same error** → account-level issue, confirms hypothesis #1. **If this succeeds** → our specific image/prompt combo is the trigger, narrows to #2 / #4.

### Step 4 — Only after steps 1–3, decide on a code change

Possible follow-up actions based on what the dump shows:

| If `task_error.code` is… | Action |
|---|---|
| `content_policy` / similar | Hypothesis #2 confirmed. Options: pre-process the image (different framing? less photo-realistic?), submit a heavily-cropped version, or stop using Meshy for buildings and pivot back to the DSM-driven plan in `docs/handoff.md` |
| `quota_exceeded` / `payment_required` | Hypothesis #1 confirmed. Top up Meshy credits or upgrade plan |
| `model_unavailable` / `invalid_model` | Hypothesis #3 confirmed. Default to `meshy-4` (`MESHY_AI_MODEL=meshy-4`) and document |
| Anything mentioning texture / prompt | Hypothesis #4. Rewrite `buildTexturePrompt()` as plain prose or drop the segment metadata entirely |
| Blank / "internal error" / unhelpful | Open a Meshy support ticket with both task IDs; in the meantime, fall back to the DSM-driven mesh (`DsmMesh` already exists in `SolarRoofViewer.tsx`) as the primary output, with Meshy as a non-blocking enrichment |

## What I would NOT do next

- **Do not add a fourth retry / longer backoff / different jitter.** We've already retried; the problem is not transience.
- **Do not switch to a different `target_polycount` / `topology` / `enable_pbr` value as a guess.** None of these are flagged in any evidence we have.
- **Do not "just commit the uncommitted diff and call it a fix."** The diff is an instrumentation change — it improves visibility, it doesn't address the root cause.
- **Do not pivot away from Meshy yet.** The status page is green, the task IDs are accepted, and we have not yet collected the diagnostic data that would justify a pivot. Pivoting on insufficient evidence is the same anti-pattern as fixing on insufficient evidence.

## Cross-references

- `CLAUDE.md` → "3D viewer" section + "Environment Variables" → documents the Meshy direct-API path and `MESHY_API_KEY` semantics (502 retryable when unset).
- `docs/handoff.md` — the previous 3D-reconstruction handoff. Predates the Meshy pivot; its recommended "DSM-driven reconstruction" is the natural fallback if Meshy turns out to systematically reject building imagery.
- `src/lib/ai/meshyClient.ts` — single source of truth for the Meshy integration.
- `src/app/api/report/[id]/reconstruction/generate/route.ts` — caller; turns Meshy failures into 502 `{ retryable: true }` and leaves the wizard on the optimistic cropped-tile preview.

## Open questions

1. Was the full task body dump actually present in the failing run? If yes, please paste it — that closes 80% of the investigation in one step. If no, restart `npm run dev` and reproduce.
2. What does the Meshy dashboard show for credits, plan, and the two failed task IDs?
3. Does the dashboard's task list expose a `task_error.code` or detail field that the API doesn't return?
4. If Meshy is systematically rejecting building photos, do we commit to the DSM-driven pivot described in `docs/handoff.md`, or keep Meshy and adapt inputs?
