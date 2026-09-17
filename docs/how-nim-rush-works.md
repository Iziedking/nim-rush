# How NIM RUSH works

Every rule the game plays by, in one place. The result screen used to carry
most of this as footnotes under each panel, which meant a rider read the same
four sentences after every single run and still had nowhere to look things up.

## The descent

A run is one city, about 1.9 km, with a 90 second limit. There is no lap and no
second chance inside a run: you get down the hill once.

## Riding position

The bike does not hold its own speed. Four controls, each with a cost:

| Control | Gives | Costs |
| --- | --- | --- |
| **Tuck** | 16% more speed | 38% of your steering |
| **Brake** | 30% more grip | speed |
| **Drift** | a hard direction change, and nitro back | one gearbox |
| **Boost** | 8.5 m/s on top | nitro |

Doing nothing coasts, and coasting is 14% below the speed the course was built
around. A rider who never tucks will finish, but close to the limit.

Braking into a corner and tucking out of it is faster than holding one position
through both. That is the whole skill.

## Supplies

Boost and drift only come off the road. Nothing refills on its own.

- **Nitro bottles** — 12 per city, about a second of boost each
- **Gearboxes** — 6 per city, one slide each

A slide feeds the tank back, so a gearbox converts control into fuel. Because
the supplies sit in lanes rather than on the centre line, the line you take is
the fuel you finish with.

## Scoring

Points come from the racing line, finish time, airtime and landings, contracts,
and drift. Contacts and missed gates take points away. A contact also drains 15
nitro and cuts your speed to a third, so it costs the run twice.

## Contracts

Three per run, drawn from the day's seed. They ask for things a good rider does
anyway: hold the clean line, land inside the rhythm, make no contact.

## Rider levels

Career score is the sum of your best run in each city, so the ladder is climbed
by riding better, not by riding more.

| Level | Career score | Unlocks |
| --- | --- | --- |
| 1 Courier | 0 | — |
| 2 Ridge Runner | 15,000 | a fourth gearbox, and one more to start with |
| 3 Night Courier | 40,000 | a bigger tank: 84 nitro instead of 60 |
| 4 Beacon Runner | 70,000 | longer slides: two seconds per gearbox |
| 5 Descent Master | 110,000 | a wider reach for supplies |

**Levels change free rides only. Every ranked run is ridden on the same
equipment.** This is not a promise the client is trusted to keep: the server
rebuilds every ranked run from the city and the seed alone, so a client that
handed itself a bigger tank produces a trace the server disagrees with, and the
run is refused rather than ranked.

A course change resets the ladder, because scores set on a different course are
not comparable.

## Ranked runs and the daily pool

A ranked run is replay-verified. The server re-simulates it from your input
trace and compares the score; browser-submitted numbers are never trusted.

When a day is sponsored, the pool pays the top three at 50% / 30% / 20%.

**Nothing is paid until the day closes and the transfer is reconciled on
chain.** A reward reads as paid only once the transfer has been seen on chain,
from the treasury to your wallet, at the right amount and deeply enough to
trust. Until then it reads as owed, sending, or held — and a held payout keeps
its reason.

Floor-division dust stays with the treasury rather than being paid out.

## What this game does not do

- No pay-to-win. Nothing that costs money makes a bike faster.
- No chance-based rewards, and no entry fee into a prize pool.
- No fake riders, fake pools, or fake leaderboard activity.
- No reward shown that is not funded.
