export function formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(date);
  }
  
  export function formatOdds(decimal: number): string {
    if (decimal <= 1) return '-';
    
    // Convert to American odds format
    if (decimal >= 2) {
      return `+${Math.round((decimal - 1) * 100)}`;
    } else {
      return `${Math.round(-100 / (decimal - 1))}`;
    }
  }
  
  // NBA Team logo mapping
  const NBA_TEAMS: Record<string, string> = {
    // Atlantic Division
    'Boston Celtics': 'https://cdn.nba.com/logos/nba/1610612738/global/L/logo.svg',
    'Brooklyn Nets': 'https://cdn.nba.com/logos/nba/1610612751/global/L/logo.svg',
    'New York Knicks': 'https://cdn.nba.com/logos/nba/1610612752/global/L/logo.svg',
    'Philadelphia 76ers': 'https://cdn.nba.com/logos/nba/1610612755/global/L/logo.svg',
    'Toronto Raptors': 'https://cdn.nba.com/logos/nba/1610612761/global/L/logo.svg',
    
    // Central Division
    'Chicago Bulls': 'https://cdn.nba.com/logos/nba/1610612741/global/L/logo.svg',
    'Cleveland Cavaliers': 'https://cdn.nba.com/logos/nba/1610612739/global/L/logo.svg',
    'Detroit Pistons': 'https://cdn.nba.com/logos/nba/1610612765/global/L/logo.svg',
    'Indiana Pacers': 'https://cdn.nba.com/logos/nba/1610612754/global/L/logo.svg',
    'Milwaukee Bucks': 'https://cdn.nba.com/logos/nba/1610612749/global/L/logo.svg',
    
    // Southeast Division
    'Atlanta Hawks': 'https://cdn.nba.com/logos/nba/1610612737/global/L/logo.svg',
    'Charlotte Hornets': 'https://cdn.nba.com/logos/nba/1610612766/global/L/logo.svg',
    'Miami Heat': 'https://cdn.nba.com/logos/nba/1610612748/global/L/logo.svg',
    'Orlando Magic': 'https://cdn.nba.com/logos/nba/1610612753/global/L/logo.svg',
    'Washington Wizards': 'https://cdn.nba.com/logos/nba/1610612764/global/L/logo.svg',
    
    // Northwest Division
    'Denver Nuggets': 'https://cdn.nba.com/logos/nba/1610612743/global/L/logo.svg',
    'Minnesota Timberwolves': 'https://cdn.nba.com/logos/nba/1610612750/global/L/logo.svg',
    'Oklahoma City Thunder': 'https://cdn.nba.com/logos/nba/1610612760/global/L/logo.svg',
    'Portland Trail Blazers': 'https://cdn.nba.com/logos/nba/1610612757/global/L/logo.svg',
    'Utah Jazz': 'https://cdn.nba.com/logos/nba/1610612762/global/L/logo.svg',
    
    // Pacific Division
    'Golden State Warriors': 'https://cdn.nba.com/logos/nba/1610612744/global/L/logo.svg',
    'Los Angeles Clippers': 'https://cdn.nba.com/logos/nba/1610612746/global/L/logo.svg',
    'Los Angeles Lakers': 'https://cdn.nba.com/logos/nba/1610612747/global/L/logo.svg',
    'Phoenix Suns': 'https://cdn.nba.com/logos/nba/1610612756/global/L/logo.svg',
    'Sacramento Kings': 'https://cdn.nba.com/logos/nba/1610612758/global/L/logo.svg',
    
    // Southwest Division
    'Dallas Mavericks': 'https://cdn.nba.com/logos/nba/1610612742/global/L/logo.svg',
    'Houston Rockets': 'https://cdn.nba.com/logos/nba/1610612745/global/L/logo.svg',
    'Memphis Grizzlies': 'https://cdn.nba.com/logos/nba/1610612763/global/L/logo.svg',
    'New Orleans Pelicans': 'https://cdn.nba.com/logos/nba/1610612740/global/L/logo.svg',
    'San Antonio Spurs': 'https://cdn.nba.com/logos/nba/1610612759/global/L/logo.svg'
  };

  export function getTeamLogo(teamName: string): string | null {
    // Exact match lookup
    if (teamName in NBA_TEAMS) {
      return NBA_TEAMS[teamName];
    }
    
    // Try partial matching for flexibility
    const normalizedName = teamName.toLowerCase();
    for (const [key, value] of Object.entries(NBA_TEAMS)) {
      if (key.toLowerCase().includes(normalizedName) || normalizedName.includes(key.toLowerCase())) {
        return value;
      }
    }
    
    // If no match is found
    console.warn(`No logo found for team: ${teamName}`);
    return null;
  }