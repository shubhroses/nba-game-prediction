# NBA predictions web app

A single-page React app that shows, for every upcoming NBA game, each team's chance of winning as this repository's two models see it, with the sportsbooks' number beside it as the yardstick. It also shows how the picks of the two models and of the sportsbooks have done, where each model has every team, and how the models work.

The page reads JSON files that a scheduled job in this repository publishes. It sends no request to the odds provider, and neither its code nor its build holds an API key. The forecasts are made by the job, not by the page.

Built with React 19, Vite 6, Tailwind CSS 3 and TypeScript 6. It has no other runtime dependency: every bar and chart is hand-written SVG.

Demo: https://nba-predictions-app.vercel.app (Vercel builds this folder on every push to `main`)

## Where the numbers come from

The job in [`pipeline/`](../pipeline/README.md) asks The Odds API for the upcoming games six times a day. For every game it takes each US sportsbook that quotes both teams, removes that sportsbook's margin, and records the median home win probability with the lowest, the highest and the number of sportsbooks. Once a day, in the morning, it records the final scores of the games that are over, rebuilds [two models](../pipeline/model/README.md) from the results of the season, freezes their forecasts for the games of the day, and grades the forecasts of the games that are over. It commits all of it to the [`data` branch](https://github.com/shubhroses/nba-game-prediction/tree/data).

The page reads four kinds of file from that branch, under

```
https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1
```

| File | What it holds | When the page asks for it |
| --- | --- | --- |
| `slate.json` | The board: the games to come with the sportsbooks' line, Elo's chance and, for a game of the day, the frozen forecast of the points-and-rest model. With them the picks won and lost so far and the results of the last eight days. | When it opens, and every five minutes after that. |
| `record.json` | The record of the season for each source: picks won and lost with a 95% interval, the Brier score and the log loss, each model next to the sportsbooks, the results by band of chance and by day, and the biggest upsets. | When the Record view is opened, and again while its counts are not the ones the board carries. |
| `model.json` | Every team's rating in both models, with its wins and losses. | When the Games view or the Rankings view is opened, only while the board says that the models have been built, and again while it is of another daily run than the board. |
| `predictions/YYYY-MM-DD.json` | The forecasts that were frozen on the morning of one day. | When the Games view is opened, for the one day whose forecasts the board carries. It holds the games of that day that have started and left the board. |

[`pipeline/README.md`](../pipeline/README.md#the-files) documents every field. That host answers requests from any origin and lets a browser cache a file for five minutes.

The page shows what the files hold. It turns a chance for the home team into a percentage for each team and words the result. It grades nothing itself: every verdict is the job's. What it works out, it works out from numbers that the files hold:

- Counts and differences: how many picks of a day won, how far an Elo rating has moved since the rating of a week before, how many points the whole percent of a model is from that of the sportsbooks.
- Three shares, each from two counts that the record gives and rounded once to one decimal: the picks of a source that won, the games that the home team won, and for each band of the calibration the picks that won. The record also gives the first of them rounded to four decimals. The page draws the track from that number and does not write it: 6 of 11 is 0.5455 there, which would read as 54.6% where the share is 54.5%.
- Elo's chance in the matchup calculator, from two published ratings and the published home court, by the formula that the job uses. For a game on the board the card shows the published chance, and the calculator says whether its sum gives the same number.

## What the page shows

A header, five tabs, one status line and a footer frame every view. On a phone the header is the title alone. The address after the `#` names the view, as in `#/record`, so a view can be linked to and the server has one page to serve. Some views take one more part: `#/games/2026-11-10` and `#/results/2026-11-07` show one day, and `#/rankings/NYK-at-BOS` opens the matchup calculator with New York at Boston. Anything else that a visitor types there falls back to what the view shows without it.

The status line reads, for example, `Odds as of 12:12 PM (2 h 50 min ago), the median of up to 6 sportsbooks. Next update about 3:10 PM.` The first time is when the snapshot was taken and the second is the start of the next slot of the job, both in the visitor's time zone. Once that start has passed without a newer snapshot, the line says `The next update was due at 3:10 PM.` The words `Odds as of 12:12 PM` are a status region (`role="status"`), so a screen reader reads them out when a newer snapshot arrives.

### The words

- The three sources are **Points & Rest**, **Elo** and **Sportsbooks**, always in that order and each in its own color: orange, blue and gray. A color never stands without the name.
- A percentage is a team's **chance** of winning. A game card writes whole percent, never below 1% or above 99%, and never 52% for a team that is short of a pick: 0.5199 is written as 51%, and the other team as 49%. The record and the details of a result write one decimal, and two where one would say what the files do not: 0.9996 would read as 100.0%, and 0.5199 as 52.0%.
- A **pick** is the side that a source puts at 52% or more, by the rule the job grades by: 0.52 is a pick and 0.5199 is not. Between 48% and 52% a source has no pick, and the page says **Toss-up**.
- A share of wins comes with the number of games it is of, and an interval is called a 95% interval.
- A state without a number has its own words and no number: no line yet, a toss-up, a forecast that is made on the morning of the game, a model that is left out for the day, a game that has started and has no result, a game that is not graded, a forecast that was published too late to count.

### Games (`#/games`)

The games to come, a day at a time.

- A sentence or two on what the forecasts rest on: the day through which the ratings include the results on record, and whether today's forecasts are made. On a day whose morning froze no forecast, a third sentence says so. The cards of that day then lead with Elo's number from its current ratings, marked `not frozen`, and say that the models are not graded on the game. When the job left the points-and-rest model out, a notice says so and leads to the Rankings view, which lists what the job's checks found.
- The picks won and lost so far of each source, as one link to the record, which says that each source is counted on its own picks: the three tallies are not of the same games. Before the first pick is graded, a sentence says when that will be.
- A rail of days, one link for each day that has a game. The current day is selected when it has games, otherwise the first day that has. Late in the evening the board may list no game of the current day any more. The day keeps its place then: its games are in the forecasts file, and until that file is here the rail says `Loading` or `Not loaded` in place of a count. On a phone the rail scrolls sideways inside its own box.
- Two filters. `My teams` appears once a team is followed, and `Different picks` when a model and the sportsbooks pick different sides in some game. A day that the filters empty says which filter, and leads to the nearest day that still has a game.
- One card for each game: the start in the visitor's time zone, both teams with logo and full name, and each team's chance by the first source that has a number for the game. That is Points & Rest once its forecast is frozen on the morning of the game, Elo before that, and the sportsbooks when no model has said anything. A caption says which it is. The pick is bold and tagged.
- Under them the three sources, each with a bar that leans from an even game toward the side it favors, and its pick, `Toss-up`, or the reason it has no number. The sportsbooks' line says how many sportsbooks it is the median of and how far apart they are.
- One sentence when a model and the sportsbooks pick different sides, or when the leading model is five percentage points or more from the sportsbooks.
- `How these numbers are made` opens to the expected margin of Points & Rest as the sum of its three parts, the two ratings of Elo with a link to the calculator that does their sum, and the sportsbooks' line with its range and the first line that the job recorded for the game. That is `open` of the board, the line of the first snapshot in which the job saw one, so the page does not say that the line opened then.
- A game without a line says which of three things it is: no line yet, when no snapshot has had one, no line right now, when an earlier snapshot had one, and for a game that is read from the forecasts file, no line that morning.
- A star next to each team follows it. The teams are kept in the browser's storage, under the key `nba-predictions.my-teams`, and nowhere else.
- Under the games of the current day, the games that have started and have no result yet, as smaller cards with the forecasts of that morning. A game that has left the board is read from the forecasts file, whose line is the one the job held when it froze the forecasts, normally of 21:10 the evening before. Its card gives the time of that line, as in `as of Sat 9:10 PM`, and so does the sentence that compares a model with it. The sentence under the heading names the morning of the forecasts and the morning on which the results are due by their dates.
- A game of the morning's forecasts that the latest snapshot does not list, although it was taken before the scheduled start, is shown apart under `Not in the latest snapshot` and is not called started: the odds provider no longer had it, as when a game is put off.
- At the foot of a day, links to the day before and the day after.
- On a phone the first screen belongs to the games. Below 640px the heading of the view is for a screen reader alone, because the tab names the view, and the sentences on what the forecasts rest on and the record strip stand under the games. At 375 by 667 pixels the first card starts 299 pixels down, with both of its large chances and the first of its three sources on the first screen.

### Results (`#/results`)

The games of the last eight days that are over, by day, the newest first, read from the board.

- The same rail of days as on Games, with `All days` first. One day alone is shown under its own address.
- The newest day, or a day that is shown alone, has a tile for each source: how many of its picks won, of how many, with the games without a pick and the games not graded beside it. An earlier day has the three counts in one line.
- One game shows both teams with the final score, the winner in bold, and for each source what it said and what became of it: right, wrong, no pick or not graded. On a phone a game is a card. From 1024px a day is one card with a row for each game under column heads.
- Up to two labels: `Upset` when the sportsbooks' favorite lost, and `Models split` when the two models picked different sides.
- `Details` opens to what the result line holds: when the game started and when its result was recorded, the line it was graded against with when it was taken and from how many sportsbooks, each model's chance and when it was published, and for Points & Rest the expected margin next to the final one.
- A source without something to grade says why: no line before the start, left out that day, no forecast for this game, published too late to count.
- Before the first result, the view says when the first one is due, from the games on the board.

### Record (`#/record`)

How the picks of each source have done this season, from `record.json`.

- A scorecard for each source: picks won and lost, the share of them with its 95% interval on a track, the toss-ups, the games not graded, the Brier score and the log loss. Each card says that the cards are not over the same games, so that their scores are not to be compared with each other, and points to the comparison under them. Under the cards, what picking the home team every time would have won.
- Each model against the sportsbooks: the difference between the two Brier scores with its 95% interval, read out in words that say no more than the numbers do, and the games in which the two picked different sides. Where the whole interval is on one side of zero, the card adds that a 95% interval that is read every day is so now and then by chance alone. A notice says that the two are not forecasts of the same moment: a model's is from the morning, and the sportsbooks' line is from the last snapshot before the start.
- Calibration: for each source a chart of the chance it gave its picks against the share of them that won, with the same numbers as a table.
- The latest 14 days as a table, each linked to its results while the board still holds them.
- The biggest upsets of each source.
- A source with fewer than 30 graded picks is named in a notice that says its numbers will swing.
- Before the first game the view says when the record starts. Under that, and only then, it shows the backtest that the models were chosen in, under its label: a backtest on 2,643 games of 2024-25 and 2025-26, with no odds in it, not a result of this season. No figure of the backtest is shown once the record has a game.
- When the file cannot be loaded, the view says why, with a `Try again` button, and shows the picks won and lost that the board carries.

### Rankings (`#/rankings`)

Where each model has every team, from `model.json`.

- A table of the 30 teams, ranked by Points & Rest or by Elo: wins and losses, the rating in points with its uncertainty and a bar centered on an average team, the Elo rating, and how far that moved in a week. A place goes by the rating as the table writes it, so teams that show the same rating share a place, and the order among them is that of the file's two decimals. A phone has four columns and no sideways scroll at 320px.
- Before the first result of the season the ratings are the opening ones. A notice says where they come from, and the columns that would read 0–0 and a dash for every team are left out.
- When the job left Points & Rest out, a notice gives the job's reasons and the table shows Elo alone.
- The matchup calculator: any two teams, Elo's chance for the home team, and the sum behind it. It opens with the next game on the board, keeps its matchup in the address, and lists what the sum leaves out. It does not offer Points & Rest, whose chance needs more than the file of the ratings holds.
- A team that the visitor follows has a star on its logo.

### How it works (`#/method`)

What the two models are, in plain words and with their formulas: what the page is, Elo with a worked game and a drawing of its formula, Points & Rest with the three parts of a margin and its rest terms, that a forecast is frozen on the morning of its game, how a forecast is graded, what the models cannot know, the backtest under its label with what it does and does not show, where the numbers come from, and where to read more. It says that Elo's method and three of its four constants are FiveThirtyEight's, and links the ratings that the opening ratings start from to where FiveThirtyEight published them, next to their license. It reads no file, so it is shown while the board loads and when the board cannot be loaded, under the sentence that says so. Every figure it quotes is held by a test to [`pipeline/model/README.md`](../pipeline/model/README.md) and to the two opening files of the season.

### When something cannot be loaded

When the board cannot be loaded, the page shows one sentence that says why and a `Try again` button, under the tabs. The same sentence and button stand in for the record, the ratings or the forecasts of the morning when one of those cannot be loaded, and the rest of the page goes on. On Games the sentence for the forecasts of the morning stands under whichever day is shown. A file that the server does not have is not an error where the board does not say that the file exists: the view says in its own words what is not published yet. Where the board says that it exists, "no such file" is an older answer of the host and is shown as the failure it is, with HTTP 404 and the button. After a `Try again` that brought the board, the focus goes to the content, because the button is gone.

## The look

One system in a light and a dark theme, which follows `prefers-color-scheme`.

- Every color is a CSS variable in `src/index.css` with one value for each theme, and `tailwind.config.js` gives it a class name: `bg-surface`, `text-ink`, `text-muted`, `bg-sunken`, `border-line`, and for the sources `pr`, `elo` and `books`, each with a soft variant. Tailwind's own palette is taken out, so a component cannot write `bg-gray-100`, and none writes a `dark:` variant. `src/pageRules.test.ts` fails on either.
- `src/display/tokens.test.ts` holds the colors to WCAG AA: 4.5 to 1 for every color that text is written in, on the page, on a card and on the sunken color, and 3 to 1 for a bar on its track and for the focus ring. Three colors of the design were darkened or changed to pass: `faint` is `#5d6d84`, `win` is `#147a3a` and `warn` is `#985c06` in the light theme.
- The header is the same navy in both themes. Team logos sit on a white disc, because they are drawn for a white background.
- The font is the system's. Every number has digits of one width.
- `tailwind.config.js` also names three sizes of the frame that a view has to agree with: `gutter`, the room at either side of the page, `tabs`, the height of the bar of tabs that stays at the top of the window, and `below-tabs`, where something that the page is scrolled to comes to rest. `src/index.css` gives that much margin for scrolling to everything in the content that can take the focus, so whatever the keyboard, a link or the page itself brings into sight there rests under the tabs and not behind them. It is a margin on those elements and not a padding of the page: a padding would count for the tabs themselves, and the page would move whenever one of them took the focus. The details of a result have a larger margin of their own, for the title of the day and the heads of the columns, which stay as well.
- A link or a button of a row that scrolls sideways, which the tabs, the rail of days and the parts of How it works are on a phone, is brought into its row when it takes the focus.
- The five tabs fit a screen of 320px, in letters of 12px there, and one of 360px in their usual 14px. A narrower row scrolls inside its own box.
- A style for the pointer over a control is given only where a pointer can rest over one, so that it does not stay on a control after a tap on a touch screen.
- In a theme of forced colors the selected day has a heavier border and a line under its name, and the line under the tabs stands under the current one alone.
- The small components that every view is built from are in `src/components/ui`: a card, a chip, a notice, an empty state, the title of a view and of a section, the name of a source with its dot, the lean bar, the mark of a verdict, a team's logo and badge, a link, a disclosure, a box that scrolls sideways inside itself, the rail of days with its pager, and the icons.
- Nothing moves for a visitor who has asked for less motion.

## Loading and refreshing

The Games view comes with the page. Each of the other four views is a file of its own, so the first screen does not wait for what it does not show. `src/App.tsx` asks for those files once the first screen is up and the browser is idle, so that a tab opens at once. A view that is opened before its file has arrived shows a spinner until it has, and a file that cannot be had is reported in place of the view, with the tabs left standing.

`src/hooks/useBoard.ts` loads the board. Its state is kept by a reducer in `src/data/boardState.ts`: a status (`loading`, `ready` or `error`), the board, the time it arrived and a flag that is set while a later check is under way.

- The page makes one request for the board when it opens.
- While the tab is visible it checks for a newer board every five minutes. A check that comes due while the tab is hidden is made when the tab is shown again.
- A request that fails on the network is repeated once, two seconds later. An HTTP error or a file of the wrong shape is not repeated.
- A request is given up after 15 seconds, and that counts as a network error.
- When a later check fails, the board that is on screen stays there, with its age in the status line.
- When a later check is answered with an older board than the one on screen, the newer one stays. The host keeps more than one copy of a file, and they are not of one age.

The other three files are loaded by `src/hooks/usePublished.ts`, through `useRecord`, `useModel` and `usePredictions`. `src/data/publishedStore.ts` keeps one state and at most one request for each file, whichever components show it, and keeps the file when its view is left, so the view has it at once when it is opened again. A file is asked for again when the board has a newer snapshot, which is how the page learns that the job has run. When asking again fails, the file that is on screen stays. A network failure is repeated once, as for the board. HTTP 404 is not a failure but the answer that there is no such file.

The host keeps a copy of every file by itself for five minutes, and "no such file" as long. So in the minutes after a daily run the page can get the new board next to yesterday's record or ratings, or be told that the forecasts of the morning do not exist. `src/data/expected.ts` says what the board lets the page expect of each file: the record has the picks won and lost that the board carries, the ratings have the board's day of the last result and its status, and a forecasts file exists for every day that the board carries a forecast of. An answer that does not go with that is asked for again, past the browser's own copy (`cache: 'no-cache'`): once when it arrives, and then with every check of the board until the two go together. `Try again` asks past the browser's copy as well.

A shape check that throws anything but its own complaint, as it would in a browser that lacks a function it calls, ends the load as a failure with its sentence and its button.

Every file is checked when it arrives, by `src/data/board.ts`, `record.ts`, `model.ts` and `predictions.ts`, against schema 1 as [`pipeline/README.md`](../pipeline/README.md#the-files) documents it: the types of the fields, the time formats, probabilities strictly between 0 and 1, team codes of three capital letters. A field that the check does not know is ignored, so the pipeline can add fields. Anything else, another value of `schema` included, is a wrong shape. A request ends in the file, in "no such file", or in one of three errors: `network`, `http` with the status, or `shape` with what is wrong.

A view that a visitor goes to starts at its top. A view that they come back to with Back or Forward is put where they left it: `useViewScroll` in `src/hooks/useHashRoute.ts` writes a name into every entry of the browser's history that the page shows, notes how far down the page is in each, and so tells a new entry from one that was shown before. What was opened in a view, such as the details of a card, is closed again after Back.

The day that the page calls today turns at 10:00 UTC, as the day of a game does in the job. In the fifty minutes before that in which the job has already done its daily work, while New York is on daylight saving time, the page goes by the board, which then carries the forecasts of the new day.

## Run locally

Requires Node.js 20.19 or later, 22.13 or later, or 24 and later, which is the range the lint and test tools accept. CI uses Node 22. No key and no `.env` file are needed.

```bash
npm ci
npm run dev
```

The development server shows the published files.

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the development server. |
| `npm run build` | Checks the types, then builds into `dist/`. |
| `npm run typecheck` | `tsc -b` over `src/` and `vite.config.ts`. |
| `npm run lint` | ESLint. A warning fails it. |
| `npm test` | The unit tests, once. |
| `npm run preview` | Serves `dist/`. |

### `VITE_DATA_BASE_URL`

The address the files are read from is one constant in `src/data/published.ts`. The build variable `VITE_DATA_BASE_URL` replaces it. It is not a secret. For example, this shows the preseason rehearsal that the job writes until 17 October 2026, which has the sportsbooks' line and no forecast:

```bash
VITE_DATA_BASE_URL=https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1-dryrun npm run dev
```

The server it names has to allow requests from other origins. In a deployment, its host also has to be in `connect-src` in `vercel.json`.

### `VITE_DATA_NOW`

The page goes by the visitor's clock: it decides which games have started, which day is today and how old the snapshot is. The build variable `VITE_DATA_NOW` fixes that clock at one moment, written as a UTC time to the second, such as `2026-11-08T23:30:00Z`. It exists to preview a copy of the files that is of another day than the one the page is opened on. Without it, every game of such a copy would have started long ago, and the page would list none of them. The clock then stands still: no age grows and no game starts while the page is open. A value in any other format is ignored, and the clock runs.

`src/data/clock.ts` reads the variable and `src/hooks/useNow.ts` is the page's clock. A view is handed the time and never asks the clock itself, which a test holds it to. The published page sets neither variable.

`vite.config.ts` sets `envPrefix` to `VITE_DATA_`. Vite can copy into the bundle any variable whose name starts with that prefix. With Vite's default, `VITE_`, that would include `VITE_SPORTS_API_KEY`, which held the API key when the page still asked the provider itself and which the Vercel project may still define.

### The sample data

Until the season has results, most of the page has nothing real to show. [`sample-data/`](sample-data/README.md) holds an invented season in progress in the files that the page reads: the board of the evening of 8 November 2026 with 26 games to come and 60 results, the record after 143 games, the ratings, and the forecasts of nine days. Nothing in it happened. It is written by `tests/sample_season.py`, which plays invented games through the real job, and its README says which game shows which state.

To look at the page with it, build with the two variables, put the folder next to the built page and serve both:

```bash
VITE_DATA_BASE_URL=/sample-data/v1 VITE_DATA_NOW=2026-11-08T23:30:00Z npm run build
cp -R sample-data dist/
npm run preview
```

`VITE_DATA_NOW=2026-11-09T04:00:00Z` shows the late evening of the same day, when its last five games have started. A build without the two variables does not read the folder, and the folder is not deployed.

The unit tests read the same files through `src/data/sampleData.ts`, so the views are tested on a season in progress. Several of them hold exact figures of the sample, such as its 60 results on eight days. After a rebuild that changes the files, those tests have to be given the new figures.

## Checks

- **Types.** `tsconfig.json`, `tsconfig.app.json` and `tsconfig.node.json` are the files of Vite's `react-ts` template. `npm run build` runs the type check first, so a type error stops a deployment.
- **Lint.** ESLint with typescript-eslint's recommended rules and the `react-hooks` rules over every `.ts` and `.tsx` file, and `no-console` as an error. A warning fails the script.
- **Unit tests.** Vitest, about 1,500 tests in 57 files next to the code they test. What a view shows is worked out by plain functions in `src/display`, which is where most of the tests are. Six files draw components to markup with `react-dom/server`, which is installed already, and read the result as a visitor would.

The files that are read from the server, in `src/data`:

| File | What it covers |
| --- | --- |
| `shape.test.ts` | The pieces that the four shape checks are built from: a day, a time, a number within its bounds, a value that may be null, and a row of a table without `Object.hasOwn`. |
| `board.test.ts`, `results.test.ts` | The board and its result lines: the examples of the pipeline documentation are accepted as they are, unknown fields are left out, and each rule is broken once. |
| `record.test.ts`, `model.test.ts`, `predictions.test.ts` | The same for the record, the ratings and the forecasts of a day. |
| `published.test.ts`, `fetchBoard.test.ts` | The address with and without `VITE_DATA_BASE_URL`, one request without extra headers, the three kinds of error, "no such file", a check that throws, a request past the browser's copy, the caller's abort, the 15 seconds and the one repeat after a network failure. `fetch` is replaced by a stand-in. |
| `boardState.test.ts`, `publishedState.test.ts`, `publishedStore.test.ts` | Every transition of the two reducers, among them that a failed later check keeps what is on screen and that an older board does not replace a newer one, that a file has one state and one request whoever asks, when an answer does not go with the board, and that "no such file" for a file that exists is shown as a failure. |
| `expected.test.ts` | What the board lets the page expect of the record, the ratings and a forecasts file, held to the sample: the files of the same run go with the board, and a copy of another run is told from them. |
| `clock.test.ts` | `VITE_DATA_NOW` in its one format, and everything else ignored. |
| `myTeams.test.ts` | The followed teams in a storage that holds them, holds something else, is missing or is blocked. |
| `sample.test.ts` | The sample data passes the shape checks field for field and holds the states that the views count on. |

What a view shows, in `src/display`:

| File | What it covers |
| --- | --- |
| `pick.test.ts` | The 52% rule at and around the line, read against `pipeline/grading.py`, the whole percents that add up to 100 and say 52% or more of a side exactly when the job picks it, the one decimal that never rounds a toss-up into a pick or a chance to 100%, and the label of a pick. |
| `day.test.ts` | The day of a game on both sides of 10:00 UTC and across the change of the clocks, read against the job's rule, in four time zones of the visitor, and the day that the page calls today. |
| `numbers.test.ts`, `words.test.ts`, `teams.test.ts`, `sources.test.ts`, `verdict.test.ts`, `lean.test.ts`, `route.test.ts`, `loadError.test.ts`, `pointsRest.test.ts` | Counts, shares, points and scores as the page writes them, among them the share of two counts for every count that a season can have, the 30 teams with their codes as `pipeline/teams.py` has them and their short names, the three sources in their order, the words of a verdict, the lean bar, the addresses of the views, the sentence of a load error, and why a game has no forecast of Points & Rest. |
| `statusLine.test.ts` | Times in a given time zone, the date on another day, ages from under a minute to days, the count of sportsbooks, a snapshot that is due and one that is overdue. |
| `gameCard.test.ts`, `games.test.ts`, `gamesIntro.test.ts` | The card of a game in every state, among them a line that is gone, a line from the forecasts file and a chance that is not a frozen forecast, the days, the filters, the started games, a late evening without the forecasts file, a game that the latest snapshot no longer lists, the links between days, and what stands above the games. |
| `results.test.ts`, `resultsGame.test.ts` | The results by day with their counts, held to `by_day` of the sample's record, one game with its labels and details, the address of a day, and what is said without a result. |
| `record.test.ts`, `recordScorecard.test.ts`, `recordAgainst.test.ts`, `recordCalibration.test.ts`, `recordDays.test.ts`, `recordUpsets.test.ts`, `recordTrack.test.ts` | Each section of the record view: its words, its numbers and where its drawings put them. |
| `rankings.test.ts`, `rankingsMatchup.test.ts` | The rows of the table in either order, and the calculator, whose sum reproduces every published Elo chance of the sample. |
| `method.test.ts`, `methodElo.test.ts`, `methodCurve.test.ts`, `backtest.test.ts`, `links.test.ts` | Every figure that the page quotes of the models and of the backtest, held to `pipeline/model/README.md` and the two opening files, Elo's arithmetic, the curve of its formula, and the links out of the page. |
| `tokens.test.ts` | The colors of both themes against WCAG AA. |
| `wordRules.test.ts` | The list of words that the page does without, which the tests of every view share. |

The page as a whole:

| File | What it covers |
| --- | --- |
| `src/components/GameCard/GameCard.test.tsx`, `src/views/Results/index.test.tsx`, `src/views/Record/Season.test.tsx`, `src/views/Rankings/words.test.tsx`, `src/views/Method/words.test.tsx` | Each view drawn to markup in its states and read as text: what stands where, headings in order, real tables, no `style` attribute, links to views only, and none of the words that the page does without. |
| `src/components/ui/ui.test.tsx` | The small components drawn to markup: that each option does what its name says, and that an icon has one size, the one its class asks for or else its usual one. |
| `src/pageRules.test.ts` | The source as text: colors from the tokens only, no `dark:` variant, no markup put on the page as text, the clock read in two places, the margin for scrolling of what can take the focus and no padding of the page, none of three functions that older browsers lack, no host of the odds provider and no key, and nothing inline in `index.html`. |
| `src/utils/formatters.test.ts`, `src/utils/classes.test.ts` | The start time across the end of daylight saving time, the logo lookup, and the joining of class names. |

Apart from the sample data and the examples and figures that the tests read from the two pipeline documents, all numbers in the tests are invented.

The `web` job of `.github/workflows/ci.yml` runs `npm ci`, the lint, the type check, the tests and the build on Node 22. Then it runs two guards on the built files:

1. They must not contain `apiKey=`, the host name of the odds provider or `VITE_VERCEL_`. The step of the workflow has the three as it looks for them.
2. The build is repeated with `VITE_SPORTS_API_KEY` set to a dummy value, and that value must not be in the output.

Two tests of the Python suite read files of this folder: `tests/test_pipeline_teams.py` reads the logo table in `src/utils/formatters.ts`, and `tests/test_sample_season.py` holds `sample-data/` to what `tests/sample_season.py` writes.

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

The policy lets the page load its own script and stylesheet, team logos from `cdn.nba.com` and the published files from `raw.githubusercontent.com`, and nothing else. There is no inline script or style in the built page, no component sets a `style` attribute, and the page loads no font.

Files under `/assets/` have a hash of their content in their name and are served with `Cache-Control: public, max-age=31536000, immutable`.

The page reads two build variables, `VITE_DATA_BASE_URL` and `VITE_DATA_NOW`. Both are optional, and a deployment sets neither. `VITE_SPORTS_API_KEY` is no longer read and can be deleted from the Vercel project.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/data/` | The four files: their types, the shape check of each, the request, and the state that the hooks keep. Also the followed teams and the clock that a build can fix. `sampleData.ts` and `pipelineExamples.ts` are for the tests only. |
| `src/hooks/` | `useBoard` for the board, `usePublished` with `useRecord`, `useModel` and `usePredictions` for the other files, `useHashRoute` for the address, `useNow` for the clock, `useMyTeams` for the followed teams, and `useDayRail` for a view that shows one day at a time. |
| `src/display/` | Plain functions that turn the files into what a view shows, with a test beside each. `day.ts`, `pick.ts`, `numbers.ts`, `words.ts`, `teams.ts`, `sources.ts`, `verdict.ts`, `route.ts` and `links.ts` are shared. The files that start with `game`, `results`, `record`, `rankings` and `method` belong to one view each, and `backtest.ts` to the two views that show the backtest. |
| `src/components/ui/` | The small components that every view is built from. |
| `src/components/` | `Layout`, `StatusLine`, `LoadFailure`, `LoadingSpinner` and `ErrorBoundary` for the frame of the page, `GameCard` and `GameList` for the Games view, and `BacktestTable` for the two views that show the backtest. |
| `src/views/` | One folder for each view: `Games`, `Results`, `Record`, `Rankings` and `Method`. A view is handed the board, the time, whether a newer board is being checked for, and what follows it in the address. |
| `src/utils/` | The start time of a game, the table of team logos, and the joining of class names. |
| `src/App.tsx` | Loads the board and shows the view that the address names. |
| `src/main.tsx` | Mounts the app inside an error boundary. If rendering throws, the visitor sees a short message and a button that reloads the page. A view that throws leaves the tabs standing. |
| `sample-data/` | The invented season, which the tests and a preview read. |

## What has been checked, and what has not

Checked on this version of the page, on 11 October 2026:

- The lint, the type check, the unit tests and the build pass, and so do the two guards on the built files, on Node 25 on macOS.
- The Python tests that read files of this folder pass.
- The page was built twice, once as it is published and once with the sample data and the clock fixed at `2026-11-08T23:30:00Z`. Each build was served locally with the headers of `vercel.json` and loaded in headless Chrome 154.
- On both builds each of the five views was opened at 320, 375, 640, 768, 1024 and 1280 pixels wide, in the light and in the dark theme. A script found no error in the console, no violation of the policy, no failed request, no sideways scroll of the page, no text under 12 pixels, nothing to tap that is under 40 pixels high or wide apart from links in a line of text, no heading out of order, no control without a name and no `style` attribute. With the sample data it found the same with every `details` element open. It named one pair of labels at the corner of each calibration chart, the `0%` of one axis and the `50%` of the other: their boxes meet by three pixels, and their letters do not touch.
- The box of the backtest was measured at twenty widths from 320 to 1440 pixels, on How it works and on the Record view before the first game. Each interval stands on one line, except from 640 to 690 pixels, where it takes two and breaks between `95% interval` and its two ends. No count of games and no name of a figure takes two lines. With the browser's default font at 130% and at 150%, nothing in the box reached past it at 320, 375, 640, 768, 1024 and 1280 pixels. At 200% nothing did either, except on How it works at 1024 pixels, where the box cuts 6 pixels off the last figure of each row.
- With the sample data the Results view is 19,235 pixels long on a screen of 375 by 812 pixels and has 120 team logos, which are asked for as they come near the screen. Scrolled from its top to its foot a screen at a time, every logo in sight had loaded.

Checked on 10 October 2026, before the last two changes to what the page draws, and not again since. The two are how a place in the rankings is counted and how the lines under a figure of the backtest are laid out:

- The build without the variables read the real files on the `data` branch, which hold the preseason: 46 games on 12 days with Elo's chance, no forecast of Points & Rest, no result and no graded pick. Every view said so in its own words, and every card gave the first line on record as that, in a sentence that starts `The first line recorded here, on Oct 10,`. The team logos loaded from `cdn.nba.com`. With every view opened in turn, each file was asked for once.
- The first screen of Games on a phone was measured at 320 by 568, 360 by 640, 375 by 667, 390 by 664 and 412 by 780 pixels. With the sample data the first card starts 299 pixels down at each of them, its two large chances end 443 pixels down, and the first of its three sources ends no more than 574 pixels down. With the real files the card starts at 299 pixels, and at 315 on the screen of 320, where the status line takes a third line. The five tabs are in sight at 320 pixels.
- A script pressed Tab through every stop of each view, forward and back, at 375 by 667, 768 by 900 and 1280 by 800 pixels on both builds, and at 320 by 568 and 1024 by 768 with the sample data. No stop ended under the bars that stay at the top, wholly or in part. The one stop that was not wholly in sight is the table of the record's days at 320 pixels, which is taller than that screen. In the rows that scroll sideways, at 320 and at 375 pixels, every day, every part of How it works and every tab that took the focus was wholly inside its row. After a link at the foot of a day on Games and on Results, after a button of How it works and after a link from a card to the calculator, what the page scrolled to rested 64 pixels down, under the tabs. The details of a result that took the focus far down a day rested under the title of the day. With the page scrolled down, the focus was moved along the tabs, and the page stayed where it was.
- Back and Forward, at 375 by 667 with the sample data: Results scrolled to 6,000 pixels, a link to the record, the record scrolled to 3,000, Back and Forward put each view back where it was left. Results at 15,000 pixels, the Games tab with a filter on, which is a page of 1,300 pixels, and Back: 15,000. Deep in the games, the link of a card to the calculator and Back: the same place, with the details of the card closed. A tab led to the top of its view, and a day of the same view did not send the page to its top.
- With the files answered by a script on the build that is published, and the clock set: a late evening on which the board lists no game of the day, with the forecasts file arriving, arriving after four seconds and answering HTTP 500. A day whose morning froze no forecast. A game that the latest snapshot does not list. The record and the ratings of the day before next to the board of the morning, which were asked for again and replaced with the next check. A record that answers HTTP 500, has the wrong shape or is not there. A check of the board that is answered with an older board. The board refused while the address names How it works, and `Try again`, after which the focus was on the content. A browser without `Object.hasOwn`, `Array.prototype.at` and `findLast`, in which all five views drew.
- A walk through the Games view at 375 pixels: following a team, the two filters, the followed team after a reload, a storage that throws or holds rubbish, the days, the links at the foot of a day and the back button. Addresses that name no view, no day or no matchup fell back as the views describe. In the calculator, a choice of teams changed the address without a step of history.
- In Chrome's emulation of a theme of forced colors the selected day had a border of 3 pixels and a line under its name, and only the current tab had a line under it. In its emulation of a touch screen a star that was tapped twice looked as it does at rest. With the browser's default font at 130% and at 150% no view scrolled sideways at 375 pixels, and at 130% none at 320.

Checked on an earlier version, and not again since:

- The behavior of `useBoard` in a browser beyond what is listed above: no request while the tab is hidden and one when it is shown again.
- That the policy is in force: an inline script, a style attribute written as text, an image from another host and a request to another host were each refused.
- `vercel.json` validates against Vercel's published schema.
- With changed copies of the sample, the page with Points & Rest left out, with a model file that cannot be read and with no model file.
- The walk from the record strip on Games to the record, from a day of the record to its results and on to How it works, at 375 and at 1280 pixels, and the walk through the Games view at 320 and at 1280 pixels.
- The steps under [The sample data](#the-sample-data), run as written.

Not checked:

- Vercel has not built this version, and CI has not run on it: the checks above were run on one machine.
- No real season has been seen. Every state of a season in progress was looked at with invented data. The real files are due to hold their first result on the morning of 21 October 2026.
- No screen reader was tried, and no browser other than Chrome. That Back puts a view back where it was left, that a link with the focus is brought into its row and that the margin for scrolling keeps the focus clear of the tabs are known for Chrome alone. The theme of forced colors and the touch screen were Chrome's emulations.
- What the odds provider does with a game that is put off was not seen. The page shows a game that the latest snapshot no longer lists apart, whatever the reason.
- The components are not tested in a browser by CI. The scripts above were run by hand and are not in the repository.

## Limitations

- The models see final scores and the schedule, and nothing else. The How it works view says what follows from that, and [`pipeline/model/README.md`](../pipeline/model/README.md) says what the backtest does and does not show.
- The board is as fresh as the job's last snapshot: six a day at best, and a visitor's browser may hold a copy for five more minutes. The status line gives its age. The forecasts of a day are made once, in the morning.
- The Results view reads the results that the board carries, which reach back eight days. Its oldest day can be cut short, and the view says so. A result line does not say where a game was played, so a game on a neutral floor reads there as one team at the other, while on the day of the game its card on Games says `neutral floor`.
- The page depends on `raw.githubusercontent.com`, which GitHub may rate-limit for requests that carry no token. The page then shows the error sentence with the status it was given.
- A team's chance on a card is in whole percent while the rule for a pick is applied to four decimals. So that no toss-up reads as the 52% of a pick, a chance from 51.5% up to 52% is written as 51%, which is up to a point under it. The matchup calculator gives such a chance with two decimals under its two whole percents.
- The matchup calculator always adds Elo's home court. For a game on a neutral floor its sum is not the published chance, and it says so.
- A team code that is not one of the 30 is shown as the code, with initials in place of a logo.
- Dates and times are written the American way for every visitor, and the details are the browser's. A clock time is in the visitor's time zone. A day is not: `Today`, `Tomorrow`, `Last night` and `this morning` are those of the day of the games in North America for every visitor, so early on a Monday in Tokyo the page still calls Sunday's games today's.
- After Back, a view stands where it was left, and what was opened in it, such as the details of a card, is closed.
- The followed teams are kept in one browser. Where the browser has no storage or blocks it, they last until the page is closed, and the page says so.
