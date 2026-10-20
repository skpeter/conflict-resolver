# TODOS

## Rematch

### Compare the first refresh to the preview

**What:** On the first unplayed phase, after a successful write, refresh and note whether the pairs match the preview.

**Why:** `updatePhaseSeeding` might rebuild the sets in a different shape than the preview assumed. The page says so when they differ. This note is the record of what start.gg actually did.

**Context:** The preview keeps existing set slots and swaps who holds each seed number. A successful write does not reload. Refresh fetches again and, if the pairs differ, says the bracket changed from the preview. Depends on one unplayed singles phase.

**Effort:** S
**Priority:** P2
**Depends on:** One unplayed singles elimination phase

### Remember sets across events

**What:** Remember sets across events this organizer did not run, so the next bracket does not refetch every pair from scratch.

**Why:** The heat map only knows what start.gg returns on this visit. A pair past the five-page cap, or a week of events this organizer did not seed, stays missing until something stores those sets.

**Context:** Version 1 keeps a pair map in page memory, keyed by the two player ids, and that map dies with the tab. The no-storage decision is completeness 7/10. The upgrade trigger is a second event that needs the first event's sets without refetching, or the start of region memory. Sets, the token, and aliases stay off disk in version 1. Start this only after a real bracket has been used.

**Effort:** L
**Priority:** P3
**Depends on:** Version 1 used on a real bracket

### Player view for upcoming events

**What:** A view where a player pastes an upcoming event and sees their own conflicts, using the same heat rules.

**Why:** The original request named two audiences. Version 1 only serves the organizer. A player who is not that organizer has no page.

**Context:** Office hours chose one organizer as the first viewer. Player sign-in and per-player links are not in this version, so this needs its own entry path rather than a panel on the organizer page. Reuse the heat, receipt, and history rules. Start after those rules have been sat with on a real bracket.

**Effort:** L
**Priority:** P3
**Depends on:** Heat rules used on a real bracket

### Correct two accounts for one person

**What:** Let the organizer mark that two player ids are the same person, so a rematch under a second account still heats.

**Why:** If the same person has two start.gg players, the page treats them as strangers. The receipt can name the wrong history, and a real rematch can score 0.

**Context:** Version 1 matches on player id only. Gamer tag and user id are not keys. The page already says the receipt can be wrong when two tags are the same person. Start this only after a real bracket shows two accounts for one person. Version 1 stores only the two multipliers, so this correction needs its own persistence decision when it starts.

**Effort:** L
**Priority:** P3
**Depends on:** A real bracket where two accounts for one person show up

## Completed
