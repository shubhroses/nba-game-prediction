/**
 * The NBA's three-letter team codes, which is how the board names a team,
 * with the full names. The names are the keys of the logo table in
 * utils/formatters.ts and the codes are the ones in pipeline/teams.py.
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
