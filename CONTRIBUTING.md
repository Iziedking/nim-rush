# Contributing to NIM RUSH

NIM RUSH is a skill game. Contributions should make the ride clearer, fairer,
more responsive, or more replayable.

## Before opening a pull request

1. Open an issue for a new feature, balance change, or public-facing change.
2. Keep one pull request focused on one player-facing outcome.
3. Explain the rule or interaction in plain language.
4. Add or update focused tests for deterministic behavior and UI contracts.
5. Run `npm run check` and `npm run build` locally.
6. Include screenshots or a short recording when the change affects the game surface.

## Pull requests

Use a clear title such as `feat(rush): add landing quality mission` or
`fix(ui): keep result ledger readable on landscape screens`. Describe what the
player can now do, how the result was verified, and any known limitation.

Do not include wallet secrets, private keys, user data, fabricated leaderboard
rows, or unverified reward claims. Do not change competitive rules without a
matching replay and fairness test.

## Local development

```bash
npm ci
npm run dev
```

The default practice run does not require a wallet or a payment. Never use a
real wallet or real funds for local testing.

## Review standard

Reviewers look for readable controls, honest states, deterministic results,
mobile-safe targets, reduced-motion support, and public copy that explains the
game without hype.
