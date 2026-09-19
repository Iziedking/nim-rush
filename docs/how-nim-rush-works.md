# How NIM RUSH works

Every rule the game plays by, in one place. The result screen used to carry
most of this as footnotes under each panel, which meant a rider read the same
four sentences after every single run and still had nowhere to look things up.

## The descent

A run is one city, about 1.9 km, with a 120 second limit. There is no lap and
no second chance inside a run: you get down the hill once.

On the daily challenge each wallet gets **three attempts**, and the best of them
is the score that stands for the day. Learning the day's course is part of the
day; grinding it is not, which is why there is a number and the number is small.

A free run rides today's descent too: same obstacles, same coins, same
contracts, unranked. It is practice for the run that counts.

### Three sectors

From 19 September 2026 the descent hardens as it goes:

| Sector | Where | What changes |
| --- | --- | --- |
| **Warm-up** | first third | the course as it always was |
| **The Pinch** | middle third | 4% faster, extra obstacles, gates 10% narrower |
| **The Gauntlet** | last third | 8% faster, extra obstacles, gates 20% narrower |

Corner push grows with the square of speed, so faster is harder, not just
quicker. The HUD tells you as you cross into each sector.

### A different hill every day

Each day's seed mirrors some obstacles to the other side of the road. The same
day is the same layout for everyone, on every attempt, but no two days are
alike, so a line cannot be learned once and ridden forever. The NIM trail is
laid around the day's obstacles, so there is always a clean line through the
coins.

## Riding position

The bike does not hold its own speed.

**Two pads, one per thumb.** The left one steers. The right one is your
posture: hold the top to tuck, slide your thumb down to brake, let go to sit
up. Brake into the corner, tuck out of it - without lifting your thumb. Nitro
and gear keys light up in their slots above it when you have something to
spend, and a tap spends it; they never move the pad underneath them.

On a keyboard: arrows or A/D steer, up or W tucks, down or S brakes, space
boosts, shift drifts.

Four controls, each with a cost:

| Control | Gives | Costs |
| --- | --- | --- |
| **Tuck** | 16% more speed | 38% of your steering |
| **Brake** | 30% more grip | speed |
| **Drift** | a hard direction change, and nitro back | one gearbox |
| **Boost** | 8.5 m/s on top | nitro |

From 20 September 2026 the bike works the way a bike works. **The tuck is what
rides it** - the rider on the pedals, folded out of the wind. **Nitro is a
shove**, and the tank holds about four seconds of it. Let go of both and
nothing is driving the bike at all: gravity pulls it down the pitch while drag
and the tyres take it back, so it keeps rolling on anything steep and winds
down to a stop on the flat.

On Lagos, a rider who touches nothing covers about a sixth of the course before
the clock runs out, averaging 9 km/h. Steering the whole way without tucking
gets a fifth of the way. Holding the tuck but never steering finishes, and
scores 3,380. Riding it properly scores about 17,000.

**And it does not hold the line.** A bike nobody is steering runs wide in a
bend and leaves the road, because staying on the racing line is the rider's
job, not the road's. Top speed is capped at 162 km/h, where drag catches you.

Before that date a hands-off run reached the bottom of Lagos in 97 seconds and
scored zero, which is the bug this fixes: the hill was doing the work.

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

Distance pays one point a metre, so getting to the bottom is a floor of about
1,900 and not a score. Everything above that is ridden for:

| Earns | Worth |
| --- | --- |
| Each second you finish under the limit | 150 |
| Each NIM coin off the trail | 40, x1.5 from 10 in a row, x2 from 20 in a row |
| Holding the line through a route gate | 900 |
| Clearing a contract | 700 to 1,400 |
| Putting a rival down | 1,500 |
| Passing a rival | 600 |
| Drifting | by angle and speed, while the slide lasts |

Missing a gate costs 300, and a near miss pays 150 — enough to notice, never
enough to aim for.

**The NIM trail is a combo.** Coins taken in an unbroken run pay more: x1.5
from the tenth in a row, x2 from the twentieth. Riding past a coin or touching
anything resets the streak to zero. You can hear it: each coin in a streak
rings a step higher. A clean trail is worth about 5,000, and coins picked up
here and there about 1,500. (Before 19 September a coin paid a flat 60.)

Contacts escalate: 300 for the first, 250 more for each after it. One contact
is a mistake and stays cheap. Eight is not eight mistakes, it is a way of
riding, and it costs 9,400. A contact also drains 15 nitro and cuts your speed
to a third, so it is paid for twice over.

Distance used to pay ten a metre, which meant 19,000 of a run's score came from
arriving at the bottom however you got there. A rider who held a control and
weaved scored 6,599; the same input now scores 130.

## Badges and streaks

Every finished run can earn badges, shown on the result screen with what each
one asks for:

| Badge | Asks for |
| --- | --- |
| **Full trail** | nine coins in ten |
| **Untouched** | a finish without touching anything |
| **Clean line** | all three gates clean |
| **Combo 20** | twenty coins in a row |
| **Contractor** | all three contracts |

Your **day streak** counts the consecutive days you have posted a verified
ranked run, and sits beside your name in the lobby. It stays alive until the day
is over: if you rode yesterday and not yet today, it says so.

None of this can be bought. Badges are read from the run the server re-rode,
and the streak from the server's own verified rows.

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
