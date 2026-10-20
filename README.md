# Conflict Resolver

One-page start.gg tool for elimination brackets. Paste an event or bracket link and a token, see rematch heat, open the last meeting, and push a small seed move while the phase is unplayed.

## Run

```bash
npm install
npm run dev
```

```bash
npm test
npm run build
```

## Notes

- The token stays in tab memory and is sent only to `https://api.start.gg/gql/alpha`.
- Only the two Advanced multipliers are stored in `localStorage`.
- Singles single-elim and double-elim only. No bracket reset.
