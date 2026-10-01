# Academy v4 — Giải Đấu Đệ Tử

Academy v4 adds an internal tournament system on top of the student/class/training foundation.

## Eligibility

A tournament may restrict:

- Step minimum / maximum
- internal Puzzle Rating minimum / maximum
- one Academy class (optional)
- maximum number of players

Students must have completed placement and satisfy the tournament filters to register.

## State machine

`draft -> registration -> running -> completed`

A tournament may also be cancelled before completion.

Registration is locked when the event starts.

## Swiss rounds

Pairing order is based on current score, Buchholz/wins/seed ordering from the live standings.

The pairing algorithm:

1. groups players in standing order,
2. prefers opponents with the closest score,
3. avoids previous opponents when possible,
4. uses seed rating as a secondary pairing distance,
5. balances White/Black history,
6. assigns an odd-player bye to the lowest-ranked player who has not already received a bye when possible.

A bye is worth one point. The same student remains eligible for only one pairing per round.

For very small fields running more rounds than unique opponents permit, repeat pairings are allowed only after no unused opponent remains.

## Standings

Ordering:

1. game points
2. Buchholz (sum of opponents' current points)
3. wins
4. seed Puzzle Rating
5. display name

Scores:

- win: 1
- draw: 0.5
- loss: 0
- bye: 1

## PGN

Admin may attach PGN text when recording a board result. v4 stores and displays it but does not yet analyze the game. A later Academy version can feed these PGNs into Stockfish/lesson analysis and update the student's training plan.

## Admin routes

- `GET /api/admin/academy/tournaments`
- `POST /api/admin/academy/tournaments`
- `GET /api/admin/academy/tournaments/{id}`
- `PATCH /api/admin/academy/tournaments/{id}`
- `POST /api/admin/academy/tournaments/{id}/registration/open`
- `POST /api/admin/academy/tournaments/{id}/start`
- `POST /api/admin/academy/tournaments/{id}/rounds/next`
- `POST /api/admin/academy/tournaments/{id}/pairings/{pairingId}/result`
- `POST /api/admin/academy/tournaments/{id}/finish`

## Student routes

- `GET /api/academy/tournaments`
- `GET /api/academy/tournaments/{id}`
- `POST /api/academy/tournaments/{id}/register`
- `DELETE /api/academy/tournaments/{id}/register`

Student UI:

- `/academy/tournaments`
- `/academy/tournaments/{id}`

Admin UI:

- `/admin/academy/tournaments`

## Scope

Tournament results do not directly alter Step, Skill Mastery or Puzzle Rating. These are real-game outcomes, not puzzle-training outcomes. PGN analysis will be the bridge back into Skill Map/Bí Cảnh in a later version.
