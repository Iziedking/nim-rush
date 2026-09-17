# NIM RUSH

[![NIM RUSH checks](https://github.com/Iziedking/sFace/actions/workflows/ci.yml/badge.svg)](https://github.com/Iziedking/sFace/actions/workflows/ci.yml)

NIM RUSH is a daily downhill race inside Nimiq Pay. One city, 1.9 km, 90
seconds. Your wallet signs the run, the server re-simulates it from your input
trace, and the day's top three split a funded Nimiq mainnet pool.

Every verified run is recorded as a line. The next rider down the hill races
three of them as solid bikes, so the descent is traffic to get through rather
than an empty time trial.

[Play NIM RUSH](https://sface.site/) · [Roadmap](docs/roadmap.md) · [Rules](docs/how-nim-rush-works.md) · [Nimiq Mini Apps](https://nimiq.dev/mini-apps/)

## The game

A run is one descent of a city course: about 1.9 km, 90 seconds, no laps and no
second chance inside it. The bike does not hold its own speed, so the whole run
is a series of decisions about how much of it you can afford to carry.

The loop is:

1. Connect once with Nimiq. The signature proves who you are and moves nothing.
2. Pick a mode: a free run to practise, or today's challenge to take a rank.
3. Read the ridge ahead: the surface, the corner, the jump, the traffic.
4. Work the controls. Tuck for speed, sit up and brake for grip, spend a
   gearbox on a slide, spend nitro on a straight.
5. Collect what you need off the road. Nothing refills on its own.
6. Clear three contracts: one for your line, one for control, one for risk.
7. Read the ledger, find the one thing that cost you, and drop in again.

## Modes

**Free run.** Practise any city at Rookie or Pro rules. Contracts are live and
the ledger is the same. A free run never takes a place on the leaderboard, and
it is the only mode your rider level changes anything in.

**Daily challenge.** One course, one seed, the same for everybody, reset at
00:00 UTC. Free to enter. This is the run that ranks, and the run the day's
funded pool pays out on. Rules are fixed here: the Rookie/Pro chooser applies
to free runs and private lobbies only, because a ranked board on which riders
picked their own difficulty would not be a board.

A day needs a field. Until two different wallets have posted a verified run,
the day is not a race, so the pool pays nothing and stays whole rather than
handing a prize to the only person who turned up.

**Private lobbies.** Open a lobby, send the link, and the first seven riders
through the door are the field. First come, first served, free to enter. The
link is the invitation, so lobby ids are twenty-four random bytes. Followed
outside Nimiq Pay, the link explains itself and offers the app rather than
failing.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | Left / Right arrows or A / D | Drag the steering pad |
| Tuck | Up arrow or W | Tuck |
| Brake | Down arrow or S | Brake |
| Drift | Shift | Drift |
| Boost | Space | Boost |
| Pause | P or Escape | Pause |

Each control costs something. Tuck adds about 16% to your speed and takes
roughly 38% of your steering authority. Brake trades speed for grip. Drift
spends a gearbox and buys a slide. Boost spends nitro. A rider who touches
nothing coasts about 14% below the speed the course was built around, which is
enough to finish and not enough to win.

Braking into a corner and tucking out of it is faster than holding one position
through both. That is the skill the course is built to reward.

## Supplies

Boost and drift are carried, not granted.

- **Nitro bottles** — twelve per city, roughly a second of boost each.
- **Gearboxes** — six per city, one slide each.

They sit in lanes rather than on the centre line, so the line you take decides
the fuel you finish with. A slide feeds the tank back, which turns a gearbox
into speed and makes control worth spending.

## The pack

You do not ride alone. Every verified run records the line it drew, and the
next rider's ticket pins three of them. They ride as solid bikes: you can be
held up behind one, squeeze past on the inside, and put a shoulder in going
through.

Contact moves you and never them. Their run was ridden before yours existed, so
the game is overtaking traffic rather than fighting it, and the replay stays
honest. Two riders cannot take each other down today; that needs both bikes
live at once, and it is on the roadmap rather than pretended at here.

Your place in the field is on screen for the whole descent. A rider whose
recording has run out finished ahead of you and keeps counting as ahead, so
you cannot climb the order by being slow.

## What is on screen

The trail is the thing you are reading, so the HUD stays off it.

- **Place in the field**, top left, for the whole run.
- **One contract at a time** — whichever is live, or the next one waiting. It
  fades a few seconds after anything last changed and comes straight back when
  progress moves. Three cards stacked over the trail were covering the part of
  the screen they were instructions about.
- **Speed, clock and score**, top right.
- **Nitro and gearboxes**, above your thumb, where spending them happens.

You name your rider once. After that the name is shown as settled with one way
to change it, rather than asking again on the way into every race. A name is one
per wallet per season, so if somebody already has the one you picked, the field
opens again and says so.

## Scoring

The finish screen shows the whole score rather than hiding it behind one
number:

- finish time
- racing-line quality
- braking and control
- airtime and landing quality
- mission completion
- drift and control
- collision penalties
- missed-gate penalties

A contact costs points, drains fifteen nitro and cuts your speed to a third, so
it is paid for twice.

## Rider levels

Career score is the sum of your best run in each city, so the ladder is climbed
by riding better rather than by riding more. Levels widen the frame you work
in: a fourth gearbox, a bigger tank, longer slides, a wider reach for supplies.

Levels change free rides only. **Every ranked run is ridden on the same
equipment.** That is not a policy the client is trusted to keep: the server
rebuilds every ranked run from the city and the seed alone, so a client that
handed itself a bigger tank produces a trace the server disagrees with, and the
run is refused rather than ranked.

## Verified competition

Nimiq provides identity. The wallet signs who you are; it never signs a
payment, and entry is free.

The server issues a scoped ticket, pins the pack to it, and re-simulates the
submitted input trace against that same pack. The browser's score is a claim.
The verified replay is the result.

The daily pool pays the top three from a Nimiq mainnet treasury. A reward reads
as paid only once the transfer has been seen on chain, from the treasury to the
rider's wallet, at the right amount, deeply enough to trust. Until then it
reads as owed, sending, or held, and a held payout keeps its reason.

NIM RUSH has no gambling, no chance-based rewards, no entry fee, no fake
players, and no prize pool that is not funded.

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

## Atlas adventure reference

The earlier NIM Atlas adventure is still in the build and still reachable at
[/?atlas=legacy](/?atlas=legacy). It is kept as a reference for the payment
evidence flow - ask, permission, current network record - which NIM RUSH
reuses for its verified runs. It is not the default game and is not ranked.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Every
gameplay change should explain the player-facing rule, add a focused test, and
include the verification command used.

## License

MIT. See [LICENSE](LICENSE).
