/// <reference types="vite/client" />
import { Game, ProcessedGame } from '../types';

interface ImportMetaEnv {
  readonly VITE_SPORTS_API_KEY: string;
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

const API_KEY = import.meta.env.VITE_SPORTS_API_KEY;

if (!API_KEY) {
  throw new Error('API key is not configured. Please check your environment variables.');
}

// Generic API endpoint
const BASE_URL = 'https://api.the-odds-api.com/v4/sports';

export async function fetchOdds(): Promise<ProcessedGame[]> { 
  try {
    const response = await fetch(
      `${BASE_URL}/basketball_nba/odds/?apiKey=${API_KEY}&regions=us&markets=h2h&oddsFormat=decimal`
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `API request failed with status ${response.status}`);
    }
    
    const data: Game[] = await response.json();
    return processGames(data);
  } catch (error) {
    console.error('Error fetching odds:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to fetch predictions: ${error.message}`);
    }
    throw new Error('Failed to fetch predictions. Please check your API configuration.');
  }
}

// Transform raw API data into more usable format with predictions
function processGames(games: Game[]): ProcessedGame[] {
  return games.map(game => {
    // Get the consensus odds from the first bookmaker (or average multiple if needed)
    const bookmaker = game.bookmakers[0];
    const market = bookmaker?.markets.find(m => m.key === 'h2h');
    
    // Find home and away team odds
    const homeOutcome = market?.outcomes.find(o => o.name === game.home_team);
    const awayOutcome = market?.outcomes.find(o => o.name === game.away_team);
    
    const homeOdds = homeOutcome?.price || 0;
    const awayOdds = awayOutcome?.price || 0;
    
    // Calculate implied probabilities from odds
    const homeProb = homeOdds ? (1 / homeOdds) * 100 : 0;
    const awayProb = awayOdds ? (1 / awayOdds) * 100 : 0;
    
    // Normalize probabilities to account for bookmaker margin
    const total = homeProb + awayProb;
    const normHomeProb = (homeProb / total) * 100;
    const normAwayProb = (awayProb / total) * 100;
    
    // Determine prediction and confidence
    const prediction = normHomeProb > normAwayProb ? game.home_team : game.away_team;
    const confidence = Math.round(Math.max(normHomeProb, normAwayProb));
    
    return {
      id: game.id,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      startTime: new Date(game.commence_time),
      prediction,
      confidence,
      homeOdds,
      awayOdds
    };
  });
}

