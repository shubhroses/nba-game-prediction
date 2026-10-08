# NBA predictions web app

A single-page React app that lists upcoming NBA games and, for each one, the side a bookmaker's odds favour and by how much.

Built with React 19, Vite 6 and Tailwind CSS 3. The components are written in TypeScript (`.tsx`); Vite strips the types at build time and there is no separate type-check step.

Demo: https://nba-predictions-app.vercel.app (deployed on Vercel from this folder, with `VITE_SPORTS_API_KEY` set as a project environment variable)

## How the "prediction" is computed

The app does not run a model of its own. It requests head-to-head odds for NBA games from The Odds API (`api.the-odds-api.com/v4/sports/basketball_nba/odds`, US region, decimal format) and, for each game:

1. takes the first bookmaker's home and away prices;
2. converts each price to an implied probability (`1 / decimal odds`);
3. normalises the two probabilities so they sum to 100%, which removes the bookmaker's margin;
4. shows the more likely team as the prediction and its normalised probability as the confidence.

The logic is in `processGames` in `src/services/api.ts`.

## Behaviour

- Cards are sorted by confidence, then by start time. Confidence of 70% or more is shown in green, 55% or more in yellow, anything lower in grey.
- Odds are displayed in American format. Team logos load from `cdn.nba.com`; if one fails, a coloured circle with the team's initials is shown instead.
- In a production build the API is called directly first; if that fails, the request is retried through a list of public CORS proxies (`api.allorigins.win`, `corsproxy.io`, `cors-anywhere.herokuapp.com`, `crossorigin.me`). In development the proxies are used from the start.
- A failed load is retried three times, two seconds apart. After the last retry `usePredictions` switches to eight hard-coded sample games, but that state change re-runs the loading effect, which makes one more attempt and, when that fails too, replaces the sample games with an error panel (Try Again and Reload Page buttons). In practice a visitor sees the error panel, not the sample games.
- The button next to the heading switches between live data and the sample games. The sample games' odds and confidence figures are made up, and the page labels them as sample data.
- Data is refreshed every 15 minutes. `Ctrl+Shift+D` toggles a debug panel showing the build mode, whether an API key is present and how long it is (never the key itself).

## Run locally

Requires Node.js 18, 20, or 22 and later, and an API key for The Odds API.

```bash
npm ci
echo "VITE_SPORTS_API_KEY=<your Odds API key>" > .env
npm run dev
```

`VITE_ODDS_API_KEY` is accepted as an alternative name. `src/services/api.ts` throws on load if neither variable is set, so a key is required even to view the sample data. A value shorter than 10 characters is rejected as invalid when the first request is made.

Other scripts: `npm run build`, `npm run preview`, `npm run lint`. The ESLint configuration only matches `.js` and `.jsx` files, so `npm run lint` does not check the `.ts` and `.tsx` sources.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/services/api.ts` | Odds request, CORS-proxy fallback, odds-to-probability conversion, sample data |
| `src/hooks/usePredictions.ts` | Loading and error state, retries, switch to sample data, 15-minute refresh |
| `src/components/` | `GameCard`, `PredictionsList`, `TeamLogo`, `Layout`, `LoadingSpinner` |
| `src/utils/formatters.ts` | Date formatting, decimal-to-American odds, team name to logo URL map |
| `src/types/index.ts` | Types for the API response and the processed game |
| `src/App.tsx` | Page composition, data-mode toggle, debug panel |

`index.html` loads `src/main.jsx`, which imports `./App.jsx`. There is no `App.jsx`; Vite resolves the import to `App.tsx`. `src/main.tsx`, which wraps the app in an error boundary, is not referenced by `index.html`. `src/App.css` and `src/assets/react.svg` are unused leftovers from the Vite template.

## Limitations

- The API key is not secret once deployed: Vite inlines `VITE_*` variables into the client bundle, and the proxy fallback sends the full request URL, including the key, to third-party CORS proxies. Use a free-tier key you are prepared to rotate. `API_TROUBLESHOOTING.md` sketches a server-side proxy that would remove the problem.
- Only the first bookmaker in the response is used; prices are not averaged across books.
- A game that comes back without bookmaker odds gets a "No Data" badge, but its card still names the away team as the prediction, because the comparison falls through to the away side. Equal prices are also resolved in favour of the away team.
- The app is independent of the notebooks in the parent repository. It does not display their model output.
- The Terms, Privacy and About links in the footer are placeholders.
- There are no automated tests.
