# NIM RUSH

[![NIM RUSH checks](https://github.com/Iziedking/sFace/actions/workflows/ci.yml/badge.svg)](https://github.com/Iziedking/sFace/actions/workflows/ci.yml)

NIM RUSH is a daily downhill skill-racing Mini App for Nimiq. Ride the ridge,
read the terrain, and prove a cleaner descent than your last run.

[Play NIM RUSH](https://sface.site/) · [Nimiq Mini Apps](https://nimiq.dev/mini-apps/)

## The game

Every run is a short, deterministic descent over the Ridge Run course. Your
speed is only useful when you can control it. The course rewards a clean line,
late braking, stable landings, and deliberate risk.

The loop is:

1. Choose the daily descent and its fixed ranked rules.
2. Read the surface, corner, jump, and obstacle ahead.
3. Steer, brake, drift, boost, or tuck to shape the run.
4. Complete three physical mission contracts: one line, one control, and one risk contract.
5. Review the result ledger and return with one clear improvement to chase.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | Left / Right arrows or A / D | Drag the steering pad |
| Drift | Space | Drift |
| Boost | Shift | Boost |
| Brake | Down arrow or S | Brake |
| Tuck | Up arrow or W | Tuck |
| Pause | P or Escape | Pause |

The surface changes grip and speed. Dirt invites a different line from wood;
ramps create airtime; landings preserve or destroy momentum; collisions cost
score and time. The rider has full control, with only a small recovery guard to
prevent a bad landing from becoming an unrecoverable input lock.

## Scoring

The finish screen exposes the complete score instead of hiding it behind a
single number:

- finish time
- racing-line quality
- braking and control
- airtime and landing quality
- mission completion
- drift and control
- collision penalties
- missed-gate penalties

Ranked riders use equal fixed loadouts. Progression is earned through skill;
there is no paid physics advantage or pay-to-win boost.

## Verified competition

Practice is playable without a wallet. For ranked participation, Nimiq can
provide identity and signed participation while the server issues a scoped run
ticket and verifies the deterministic input trace. The browser's score is a
claim; the verified replay is the result. A future friend challenge can compare
verified asynchronous ghost runs without pretending to be live multiplayer.

Rewards are shown only when they are genuinely funded, transparent, and
reconciled. NIM RUSH does not use gambling, chance-based rewards, fake players,
or fake prize pools.

## Screenshots

These snapshots come from the local PC browser capture flow and are checked in
so the public repository shows the actual game surface.

<p>
  <img src="public/nim-rush/screenshots/intro-landscape.png" width="720" alt="NIM RUSH daily descent launch screen" />
</p>
<p>
  <img src="public/nim-rush/screenshots/course-355.png" width="720" alt="NIM RUSH rider approaching a course section" />
</p>
<p>
  <img src="public/nim-rush/screenshots/result.png" width="720" alt="NIM RUSH result screen with score ledger and mission contracts" />
</p>

## Run locally

Requirements: Node.js 20.19 or newer.

```bash
npm ci
npm run dev
```

Open the local address printed by Vite. The game starts in practice mode and
does not require a wallet.

Release checks:

```bash
npm run check
npm run build
```

To capture fresh PC snapshots after a visual change, run the local server and
use the browser probe with its public capture flag:

```bash
node scripts/probe-rush-browser.mjs --origin=http://127.0.0.1:5173 --public-screenshots
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Every
gameplay change should explain the player-facing rule, add a focused test, and
include the verification command used.

## License

MIT. See [LICENSE](LICENSE).
