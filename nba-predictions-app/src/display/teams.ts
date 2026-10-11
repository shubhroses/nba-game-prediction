/**
 * The NBA's three-letter team codes, which is how the board names a team,
 * with the full name and the short name of each. The full names are the keys
 * of the logo table in utils/formatters.ts and the codes are the ones in
 * pipeline/teams.py.
 */
export const TEAM_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    ATL: 'Atlanta Hawks',
    BOS: 'Boston Celtics',
    BKN: 'Brooklyn Nets',
    CHA: 'Charlotte Hornets',
    CHI: 'Chicago Bulls',
    CLE: 'Cleveland Cavaliers',
    DAL: 'Dallas Mavericks',
    DEN: 'Denver Nuggets',
    DET: 'Detroit Pistons',
    GSW: 'Golden State Warriors',
    HOU: 'Houston Rockets',
    IND: 'Indiana Pacers',
    LAC: 'Los Angeles Clippers',
    LAL: 'Los Angeles Lakers',
    MEM: 'Memphis Grizzlies',
    MIA: 'Miami Heat',
    MIL: 'Milwaukee Bucks',
    MIN: 'Minnesota Timberwolves',
    NOP: 'New Orleans Pelicans',
    NYK: 'New York Knicks',
    OKC: 'Oklahoma City Thunder',
    ORL: 'Orlando Magic',
    PHI: 'Philadelphia 76ers',
    PHX: 'Phoenix Suns',
    POR: 'Portland Trail Blazers',
    SAC: 'Sacramento Kings',
    SAS: 'San Antonio Spurs',
    TOR: 'Toronto Raptors',
    UTA: 'Utah Jazz',
    WAS: 'Washington Wizards',
  }),
);

/** The full name for a code. A code that is not in the table is shown as it is. */
export function teamName(code: string): string {
  return TEAM_NAMES.get(code) ?? code;
}

/**
 * The short name of each team, for where the full name is too long: the
 * place it plays for, as in "Detroit", which is how people speak of a game.
 * Los Angeles has two teams, so those two go by their own names.
 */
const SHORT_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    ATL: 'Atlanta',
    BOS: 'Boston',
    BKN: 'Brooklyn',
    CHA: 'Charlotte',
    CHI: 'Chicago',
    CLE: 'Cleveland',
    DAL: 'Dallas',
    DEN: 'Denver',
    DET: 'Detroit',
    GSW: 'Golden State',
    HOU: 'Houston',
    IND: 'Indiana',
    LAC: 'Clippers',
    LAL: 'Lakers',
    MEM: 'Memphis',
    MIA: 'Miami',
    MIL: 'Milwaukee',
    MIN: 'Minnesota',
    NOP: 'New Orleans',
    NYK: 'New York',
    OKC: 'Oklahoma City',
    ORL: 'Orlando',
    PHI: 'Philadelphia',
    PHX: 'Phoenix',
    POR: 'Portland',
    SAC: 'Sacramento',
    SAS: 'San Antonio',
    TOR: 'Toronto',
    UTA: 'Utah',
    WAS: 'Washington',
  }),
);

/** The short name for a code, as a label writes it: "Detroit", "Lakers". A code that is not in the table is shown as it is. */
export function shortName(code: string): string {
  return SHORT_NAMES.get(code) ?? code;
}

/**
 * The short name in the middle of a sentence: "Detroit", "the Lakers". A
 * team that goes by its own name takes an article there, and one that goes
 * by its place does not.
 */
export function nameInSentence(code: string): string {
  const name = shortName(code);
  return teamName(code).endsWith(` ${name}`) ? `the ${name}` : name;
}
