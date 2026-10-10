# NBA predictions web app

A single-page React app that lists upcoming NBA games and, for each one, the team the sportsbooks favour and by how much.

The page reads one JSON file that a scheduled job in this repository publishes. It sends no request to the odds provider, and neither its code nor its build holds an API key.

Built with React 19, Vite 6, Tailwind CSS 3 and TypeScript 6.

Demo: https://nba-predictions-app.vercel.app (Vercel builds this folder on every push to `main`)

## Where the numbers come from

The job in [`pipeline/`](../pipeline/README.md) asks The Odds API for the upcoming games six times a day. For every game it takes each US sportsbook that quotes both teams, removes that sportsbook's margin, and records the median home win probability with the lowest, the highest and the number of sportsbooks. It commits the result to the [`data` branch](https://github.com/shubhroses/nba-game-prediction/tree/data).

The page reads the board, the list of upcoming games as of the latest snapshot:

```
https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1/slate.json
```

That host answers requests from any origin and lets a browser cache the file for five minutes. The page does no arithmetic on odds. It turns the home team's probability into a percentage for each team and words the result. It does not run a model of its own.

## What the page shows

Above the cards:

- One status line, for example `Odds as of 12:12 PM (2 h 50 min ago), the median of up to 6 sportsbooks. Next update about 3:10 PM.` The first time is when the snapshot was taken and the second is the start of the next slot of the job, both in the visitor's time zone. Once that start has passed without a newer snapshot, the line says `The next update was due at 3:10 PM.` A time on another day has its date after it.
- One sentence that says what a percentage is.

One card for each game that has not started, the soonest first:

- The start time in the visitor's time zone.
- Both teams by full name, with the logo from `cdn.nba.com`. If a logo does not load, a coloured circle with the team's initials is shown.
- Under each team, its chance of winning in whole percent. The away team's figure is 100 minus the home team's, so the two always add up. A figure is never below 1% or above 99%.
- Under that, the range between the sportsbooks for that team, such as `63% to 65%`, when there are two or more and they differ in whole percent.
- The number of sportsbooks: `Median of 6 sportsbooks`, `1 sportsbook`, or `4 sportsbooks within a point of each other`.
- A label and a footer with the outcome. `64% implied` and `Favored: Boston Celtics, 64% implied` name the favourite. `Toss-up` is shown, and no team is named, when the home team's probability is within 2 points of 50%. `No line yet` is shown when the board has no line for the game, and such a card has no percentage on it.

The label is green from 70%, yellow from 55% and grey below that. The footer is blue for a home favourite and purple for an away favourite.

No number on the page is a sportsbook's price. The page shows no moneyline.

When the board cannot be loaded, the page shows one sentence that says why and a `Try again` button. When no game on the board is still to start, it says that no games have odds posted.

## Loading and refreshing

`src/hooks/useBoard.ts` is the one place that loads data. Its state is kept by a reducer in `src/data/boardState.ts`: a status (`loading`, `ready` or `error`), the board, the time it arrived and a flag that is set while a later check is under way.

- The page makes one request when it opens.
- While the tab is visible it checks for a newer board every five minutes. A check that comes due while the tab is hidden is made when the tab is shown again.
- A request that fails on the network is repeated once, two seconds later. An HTTP error or a file of the wrong shape is not repeated.
- A request is given up after 15 seconds, and that counts as a network error.
- When a later check fails, the board that is on screen stays there, with its age in the status line.
- The request is aborted when the component is unmounted.

`src/data/board.ts` checks what arrives against schema 1 of the board as [`pipeline/README.md`](../pipeline/README.md#prefixslatejson) documents it: the types of the fields, the two time formats, probabilities strictly between 0 and 1 with `lo <= p_home <= hi`, and team codes of three capital letters. A field it does not know is ignored, so the pipeline can add fields. Anything else, another value of `schema` included, is a wrong shape. `src/data/fetchBoard.ts` returns one of three errors: `network`, `http` with the status, or `shape` with what is wrong.

## Run locally

Requires Node.js 20, 22, or 24 and later. No key and no `.env` file are needed.

```bash
npm ci
npm run dev
```

The development server shows the published board.

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the development server. |
| `npm run build` | Checks the types, then builds into `dist/`. |
| `npm run typecheck` | `tsc -b` over `src/` and `vite.config.ts`. |
| `npm run lint` | ESLint. A warning fails it. |
| `npm test` | The unit tests, once. |
| `npm run preview` | Serves `dist/`. |

### `VITE_DATA_BASE_URL`

The address the files are read from is one constant in `src/data/fetchBoard.ts`. The build variable `VITE_DATA_BASE_URL` replaces it. It is not a secret. For example, this shows the preseason rehearsal that the job writes until 17 October 2026:

```bash
VITE_DATA_BASE_URL=https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1-dryrun npm run dev
```

The server it names has to allow requests from other origins. In a deployment, its host also has to be in `connect-src` in `vercel.json`.

`vite.config.ts` sets `envPrefix` to `VITE_DATA_`. Vite can copy into the bundle any variable whose name starts with that prefix. With Vite's default, `VITE_`, that would include `VITE_SPORTS_API_KEY`, which held the API key when the page still asked the provider itself and which the Vercel project may still define.

## Checks

- **Types.** `tsconfig.json`, `tsconfig.app.json` and `tsconfig.node.json` are the files of Vite's `react-ts` template. `npm run build` runs the type check first, so a type error stops a deployment.
- **Lint.** ESLint with typescript-eslint's recommended rules and the `react-hooks` rules over every `.ts` and `.tsx` file, and `no-console` as an error. A warning fails the script.
- **Unit tests.** Vitest, in files next to the code they test:

| File | What it covers |
| --- | --- |
| `src/data/board.test.ts` | The shape check: the example of the pipeline documentation is accepted as it is, unknown fields are left out, and each rule is broken once. |
| `src/data/fetchBoard.test.ts` | The address with and without `VITE_DATA_BASE_URL`, one request without extra headers, the three kinds of error, the caller's abort and the 15 seconds. `fetch` is replaced by a stand-in. |
| `src/data/boardState.test.ts` | Every transition of the reducer, among them that a failed later check keeps the board. |
| `src/display/teams.test.ts` | 30 teams. The names are the keys of the logo table, and the codes are the ones in `pipeline/teams.py`, which the test reads as text. |
| `src/display/gameCard.test.ts` | Favourite at home and away, the toss-up at and around 48% and 52%, no line, 1% and 99%, a half point, the range, the order of the list and the games that have started. |
| `src/display/statusLine.test.ts` | Times in a given time zone, the date on another day, ages from under a minute to days, the count of sportsbooks, a snapshot that is due and one that is overdue. |
| `src/utils/formatters.test.ts` | The start time across the end of daylight saving time, and the logo lookup. |

All numbers in the tests are invented.

The `web` job of `.github/workflows/ci.yml` runs `npm ci`, the lint, the type check, the tests and the build on Node 22. Then it runs two guards on the built files:

1. They must not contain `apiKey=`, `the-odds-api` or `VITE_VERCEL_`.
2. The build is repeated with `VITE_SPORTS_API_KEY` set to a dummy value, and that value must not be in the output.

## Deployment

`vercel.json` holds what Vercel needs to build the folder (`npm ci`, `npm run build`, output in `dist`) and the response headers.

Every response carries:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.nba.com; connect-src 'self' https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |

The policy lets the page load its own script and stylesheet, team logos from `cdn.nba.com` and the board from `raw.githubusercontent.com`, and nothing else. There is no inline script or style in the built page. React sets the colours of the logo placeholder through the DOM, which `style-src 'self'` allows.

Files under `/assets/` have a hash of their content in their name and are served with `Cache-Control: public, max-age=31536000, immutable`.

The only build variable the page reads is `VITE_DATA_BASE_URL`, and it is optional. `VITE_SPORTS_API_KEY` is no longer read and can be deleted from the Vercel project.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/data/board.ts` | The types of the board and the shape check. |
| `src/data/fetchBoard.ts` | The address of the board, the request and its three errors. |
| `src/data/boardState.ts` | The reducer behind the data hook. |
| `src/hooks/useBoard.ts` | The data hook: first load, re-check, retry, abort. |
| `src/hooks/useNow.ts` | The current time, refreshed every half minute. |
| `src/display/teams.ts` | Team codes to full names. |
| `src/display/gameCard.ts` | Turns a game of the board into what its card shows, and orders the list. |
| `src/display/statusLine.ts` | The wording of the status line. |
| `src/utils/formatters.ts` | The start time of a game, and the table of team logos. |
| `src/components/` | `Layout`, `StatusLine`, `GameList`, `GameCard`, `TeamLogo`, `LoadFailure`, `LoadingSpinner`. |
| `src/App.tsx` | Puts the page together. |
| `src/main.tsx` | Mounts the app inside an error boundary. If rendering throws, the visitor sees a short message and a button that reloads the page. |

## What has been checked, and what has not

Checked, as of 10 October 2026:

- `npm ci`, the lint, the type check, the unit tests and the build pass from a clean checkout, and so do the two guards: on Node 22 in a Linux container, with the steps taken from the workflow file, and on Node 25 on macOS.
- 37 behaviours were each broken once in a scratch copy of `src/`, and every time a unit test failed.
- Each guard was seen to fail: the first with a request to the provider put back into the code, the second with the whole environment object shown on the page and `envPrefix` removed. With `envPrefix` in place the second guard passed even then.
- The built files were served locally with the headers of `vercel.json` and loaded in headless Chrome 154, with the request for the board answered inside the browser by an invented board. The cards came in start-time order, a game that had started was left out, and the status line, a toss-up card and a card without a line read as described above. The page made one request for the board and none to any host other than its own and `cdn.nba.com`. Chrome reported no violation of the policy. An inline script, a style attribute written as text, an image from another host and a request to another host were each refused, which shows that the policy was in force.
- In the same browser, with the page's clock moved forward: a second request after five minutes, none while the tab was marked hidden and one when it was shown again, the board kept on screen through a check that failed, a game dropped from the list once it had started, and the status line turning to `The next update was due at`. A network error was retried once after two seconds. HTTP 404, HTTP 429, a file of another schema and a file that is not JSON were not retried, and each gave its sentence. With rendering made to throw, the page showed the short message of the error boundary and none of the error's text.
- Under the development server, where React mounts every component twice, the request of the first mount was aborted and the cards were shown once.
- The board as it was on the `data` branch on 10 October 2026, fetched once, passes the shape check, and the parsed board equals the file field for field. Served to the built page in the same way as the invented one, it gave one card for each of its 46 games.
- `vercel.json` validates against Vercel's published schema.

Not checked:

- Vercel has not built this version, and the headers have not been seen on the deployed site. On a preview deployment Vercel may add its toolbar from another origin, which this policy would refuse. The page does not need it.
- The team logos did not load in headless Chrome: `cdn.nba.com` ends its requests with an HTTP/2 protocol error, while `curl` gets the same file. The checks therefore saw the placeholders, and that the policy lets the logo requests out, but not the logos.
- The hidden tab was simulated by overriding `document.visibilityState`.
- No browser other than Chrome was tried.

## Limitations

- The page shows what the sportsbooks imply. It makes no prediction of its own, and it does not display the output of the notebooks in the parent repository.
- The board is as fresh as the job's last snapshot: six a day at best, and a visitor's browser may hold a copy for five more minutes. The status line gives its age.
- The page depends on `raw.githubusercontent.com`, which GitHub may rate-limit for requests that carry no token. The page then shows the error sentence with the status it was given.
- The components are not tested in a browser by CI. The checks above were run by hand.
- The toss-up rule is applied to the probability as the board gives it, to four decimals, while the cards show whole percent. A favourite at 52.3% and a toss-up at 51.8% both show 52%.
- A team code that is not one of the 30 is shown as the code, with initials in place of a logo.
- The header still calls the page "NBA Game Predictions" and spells "favourites" the British way, while the cards say "Favored". The wording is left for the redesign.
