# Changelog

## [0.1.1] - 2026-10-22

### Added

- Project later-round matchups, including players who advance through a bye, and suggest a small seed move while the phase is unplayed.

### Fixed

- A history retry that gets a null start.gg payload stays failed instead of looking like no rematch.
- Refresh after a seed write compares the projected players. A later clock does not by itself say the bracket changed.
- The first match a bye player actually plays heats like round 1. The match after that stays round 3.
- A failed event lookup no longer leaves every pair on "checking".
- Rate-limit retries stop after three attempts, and a replaced load does not keep retrying.
- A seed with an entrant and no player id stays unresolved instead of handing the opponent a bye.

## [0.1.0] - 2026-10-19

### Added

- Paste a start.gg event or bracket link and see rematch heat for a singles elimination phase.
- Open the last meeting, with the local date, the day count, the round, the winner, and the event link.
- Pick one seed move of one or two slots and push it while the phase is still unplayed.
- Tune the recency and round multipliers in Advanced. Those two numbers stay on this browser.
