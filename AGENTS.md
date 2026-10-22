## Learned User Preferences

- Score a rematch by how recently that pair played and how early the set sits in the bracket. The organizer view is a heat map; tapping a set opens the last meeting.
- When checking a past event, score history as of that event's start and ignore later meetings and that event's own sets. Upcoming events stay as of now. Completed events are how the algorithm gets validated.
- Later rounds must include projected matchups from the initial seeding for both past and upcoming events. start.gg does not return those projections, and a later slot that is still empty still needs heat so round 2 and beyond can be seeded.
- Show seed suggestions only for the selected set, and keep them small enough that they do not drastically change the original seeding. Push seeds only while no set in the phase has started; after that, edits are manual, and the bracket is never reset.
- Name the player a suggestion swaps with, and keep the seed number beside the tag. State the hottest heat left on the bracket once on the card. Keep a suggestion when it cools the selected set and every set it heats stays below that set's current heat.
- A swap that drops a player into a worse placement tier is still allowed. Show that drop, and use the placement bands for this bracket format.
- Do not list bye sets. The player who receives the bye advances, and the next real match is what shows. Leave Grand Final Reset off the list too.
- Last-meeting details include the tournament name beside the event name. Set links go directly to the set (`/tournament/{slug}/event/{event}/set/{id}`) and must not add a second `tournament/` segment.
- Keep start.gg tokens out of chat and out of git. For a live API run, the event link is enough: read the gitignored `startgg.token.local` file in the repo root and do not print it. Do not ask for the token. A token set only in the user's own PowerShell window is not visible to the agent shell.
- Publish the static app with GitHub Actions to GitHub Pages. That workflow runs `npm test` and the production build before deploy, and `npm test` only runs the files named in `package.json`.

## Learned Workspace Facts

- Conflict Resolver is the public Vite/React app at https://github.com/skpeter/conflict-resolver, published from `main` to https://skpeter.github.io/conflict-resolver/. Version 1 is a one-page singles single-elim or double-elim audit with no account and no stored bracket; each visit refetches start.gg.
- The token stays in tab memory and is sent only to `https://api.start.gg/gql/alpha`. Only the two Advanced multipliers are stored in `localStorage`.
- start.gg `completedAt` and `event.startAt` are unix seconds. The heat window is 60 days in milliseconds. Convert seconds (values under 1e12) before comparing, or every meeting looks older than the window and shows no heat.
- The start.gg client stays at or under 80 requests per 60 seconds. Do not raise that cap until start.gg's real limit is known. History asks for up to 100 sets per pair, eight pairs per request, and splits a batch in half when start.gg rejects a response for more than 1000 objects. A one-completed-set page is the smaller shape to try next, because unfinished sets matter only when a result was never reported, but do not switch until a live run returns the same receipts in fewer calls.
- start.gg omits bye matches and seats those players in the next round. Projection has to follow the prerequisite graph, or later pairs never appear. A bye has fewer than two players, so it is not sent as a history query.
- Seed writeback uses `updatePhaseSeeding` and only while the phase is unplayed. Once the bracket has started, start.gg locks seeding, and resetting the bracket clears reported scores.
