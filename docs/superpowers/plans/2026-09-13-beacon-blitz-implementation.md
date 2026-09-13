# Beacon Blitz Implementation Plan

**Design:** `docs/superpowers/specs/2026-09-13-beacon-blitz-design.md`

## Batch 1 — Deterministic arcade core

- [x] Add typed city, route, mission, input, run, result, and replay contracts under `shared/atlas/blitz/`.
- [x] Add three city routes and at least six Nimiq relay mission templates.
- [x] Implement fixed-step auto-forward movement, lane steering, drift, boost, collision penalties, relay gates, finish/timeout, and score breakdown.
- [x] Implement canonical trace hashing and authoritative replay.
- [x] Add focused tests for determinism, handling, mission rotation, scoring, finish, timeout, and tamper detection.
- [x] Run the focused core suite.

Owner commit checkpoint:

```text
git add shared/atlas/blitz tests/atlas-blitz-core.test.ts tests/atlas-blitz-replay.test.ts docs/superpowers/specs/2026-09-13-beacon-blitz-design.md docs/superpowers/plans/2026-09-13-beacon-blitz-implementation.md
git commit -m "feat(atlas): add deterministic Beacon Blitz core"
```

## Batch 2 — Playable NIM Atlas arcade client

- [ ] Add a dedicated Blitz app and input layer with instant city entry, countdown, run HUD, relay choices, result screen, city progression, and local personal bests.
- [ ] Extend the Three renderer with a dedicated bike and believable rider presentation, city mood, route markers, relay gates, boost trail, and arcade chase-camera feedback.
- [ ] Add a compact arcade stylesheet that preserves the existing NIM Atlas identity.
- [ ] Route the public Atlas entry to Beacon Blitz while keeping the previous Atlas application available behind an explicit legacy query parameter.
- [ ] Add source-contract and DOM tests for the launch flow and accessible controls.
- [ ] Run focused client tests and typecheck.

Owner commit checkpoint:

```text
git add src/atlas/main.ts src/atlas/blitz src/atlas/render src/atlas/atlas.css tests/atlas-blitz-ui.test.ts tests/atlas-renderer-cascade.test.ts
git commit -m "feat(atlas): ship the Beacon Blitz arcade client"
```

## Batch 3 — Wallet identity and verified leaderboard

- [ ] Add Blitz ticket, submission, replay-verification, username binding, and per-city leaderboard services.
- [ ] Add validated API routes and client guards.
- [ ] Connect the result screen to the existing explicit Nimiq wallet-signing flow; keep guest results local and label offline/service failures honestly.
- [ ] Add server tests for replay mismatch, seed mismatch, username/wallet conflicts, ranking, idempotency, and best-score replacement.
- [ ] Run focused server and API suites.

Owner commit checkpoint:

```text
git add server/atlas src/atlas/api.ts src/atlas/blitz shared/atlas/blitz tests/atlas-blitz-server.test.ts tests/atlas-api.test.ts
git commit -m "feat(atlas): verify Blitz scores and rank wallet riders"
```

## Batch 4 — Polish and release evidence

- [ ] Tune all three circuits for 65–85 second strong finishes within the 90-second limit.
- [ ] Add reduced-motion, pause/resume, hidden-tab safety, responsive layout, sound controls, and failure recovery.
- [ ] Run formatting, typecheck, full tests, asset verification, and production build.
- [ ] Smoke-test the full Lagos run at 390x844 and verify the London reveal and replay path.
- [ ] Record honest remaining limitations and final file-scoped owner commit commands.

Owner commit checkpoint:

```text
git add src shared server tests docs package.json
git commit -m "fix(atlas): polish and validate Beacon Blitz launch"
```

## Guardrails

- The owner performs all Git history operations; implementation work does not stage or commit.
- Do not deploy, broadcast transactions, fund wallets, or run `npm run server`.
- Preserve unrelated files and existing NIM Atlas systems.
- Do not claim physical-device, production-server, or geographic-replica evidence without actually obtaining it.
