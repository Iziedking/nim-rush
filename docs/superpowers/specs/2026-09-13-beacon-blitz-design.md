# Beacon Blitz Design

**Status:** Approved for implementation on 2026-09-13

## Product promise

Beacon Blitz is the arcade mode of NIM Atlas: a fast third-person bike run through a stylised city, where the road itself teaches one useful Nimiq idea at a time. The player should understand the game in seconds, enjoy the handling before they understand the scoring, and immediately want to see the next city.

## Launch scope

- Three launch circuits: Lagos Pulse, London Relay, and Dubai Afterglow.
- One 90-second run format. A strong run finishes in roughly 65 to 85 seconds; the remaining time is a visible margin, not forced waiting.
- Auto-forward bike with lane steering, drift, boost, collisions, close-pass bonuses, and readable speed feedback.
- Three road-integrated relay decisions per run, selected deterministically from a larger Nimiq mission pool.
- Results with score breakdown, personal best, next-city reveal, replay, and leaderboard entry.
- Guest play is immediate. Wallet connection is requested only when a player chooses to verify a leaderboard score.
- Leaderboard identity is username plus shortened wallet address. A wallet can own one username per season and a username cannot silently move between wallets.

## Core loop

1. A minimal NIM Atlas title screen presents one dominant action: Ride Lagos.
2. A three-count starts the bike directly in the city.
3. The bike accelerates automatically. The player steers, holds drift through bends, and spends boost on clean exits.
4. Three relay gates appear on the road. Each presents a short two-choice Nimiq decision with a strict response window.
5. Correct choices add score and boost. Wrong or missed choices create a brief speed penalty, then reveal one short explanation without stopping the run.
6. Crossing the finish line ends the run immediately. Timing out also ends it.
7. The result screen exposes the score honestly, offers wallet verification, and reveals the next circuit.

## City identity

The cities share the proven NIM Atlas rendering foundation, but not a generic reskin. Each circuit receives a different road shape, skyline silhouettes, light palette, landmark kit, traffic rhythm, mission order, and soundtrack pulse.

- **Lagos Pulse:** warm sunset, lagoon blue, yellow transit accents, dense roadside energy, fast S-bends.
- **London Relay:** blue dusk, brick and stone, red transit accents, tighter technical corners.
- **Dubai Afterglow:** night gold, glass towers, broad high-speed sweepers, longer boost windows.

The environments are stylised circuits inspired by each city, not geographic replicas.

## Nimiq meaning

The game does not pause for a lesson. Relay choices turn network ideas into racing decisions: selecting a healthy peer, recognising finality, protecting a recovery phrase, choosing a valid address, avoiding a suspicious payment request, and understanding a low-friction payment. Every answer is short enough to read at speed and every explanation is one sentence.

## Visual and interaction direction

- Preserve NIM Atlas navy, cyan, warm orange, verified teal, and expressive world lighting.
- Remove the explorer HUD, books, passports, role selection, long mission cards, joystick labels, and dense status panels from the run.
- Use a low chase camera and a believable adult rider silhouette with human proportions, face, hair, fitted clothing, articulated riding posture, and reactive lean.
- The bike must read clearly at mobile size through wheel motion, suspension movement, tail light, boost trail, and ground shadow.
- HUD during play is limited to timer, score, speed/boost, current relay, and pause.
- Touch: drag or hold left/right on the lower-left zone to steer; hold the lower-right control to drift; tap boost when charged. Keyboard mirrors this with arrows/A-D, Shift, and Space.
- Reduced motion removes camera shake, aggressive FOV changes, and flashing while retaining all game information.

## Fair competition

- Ranked runs use a server-issued deterministic seed and fixed-step simulation.
- The submitted trace contains sampled steering, drift, boost, and relay choices; the server replays it and rejects mismatched state or score.
- Practice runs may rotate freely and are never labelled verified.
- Ranked boards store the best verified score per wallet per city and season.
- Tie-break order is score, then finish time, then fewer collisions, then earlier verified submission.
- No transaction is required to play or rank. Wallet signing proves identity only.

## Five-day boundary

The launch build prioritises one excellent loop over breadth. It does not include an open world, pedestrians with schedules, combat, bike customisation, multiplayer synchronisation, cash prizes, mainnet transactions, or five production cities. Los Angeles and California Coast remain post-launch circuits.

## Done means

- A fresh mobile user reaches moving gameplay within five seconds of tapping Ride Lagos.
- All three circuits can be completed and replayed without reloading.
- At least six mission templates rotate deterministically into three gates per run.
- Steering, drift, boost, collision, finish, timeout, score, results, city unlock, and local personal best are covered by deterministic tests.
- Wallet verification and leaderboard seams fail safely when the service or wallet is unavailable.
- The full repository check and production build pass.
- A 390x844 browser smoke test proves the complete Lagos loop and the transition to London.
