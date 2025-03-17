/// <reference types="vite/client" />
import { Game, ProcessedGame } from '../types';

interface ImportMetaEnv {
  readonly VITE_SPORTS_API_KEY: string;
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// For development testing, you can provide a fallback API key if needed
const API_KEY = import.meta.env.VITE_SPORTS_API_KEY || '';

console.log("API environment check:", {
  envExists: typeof import.meta.env !== 'undefined',
  apiKeyExists: !!import.meta.env.VITE_SPORTS_API_KEY,
  apiKeyLength: import.meta.env.VITE_SPORTS_API_KEY ? import.meta.env.VITE_SPORTS_API_KEY.length : 0
});

if (!API_KEY) {
  console.error("API key is not configured in environment variables");
  throw new Error('API key is not configured. Please check your environment variables.');
}

// Generic API endpoint
const BASE_URL = 'https://api.the-odds-api.com/v4/sports';

// Fallback data for when the API is unavailable
const FALLBACK_GAMES: ProcessedGame[] = [
  {
    id: 'fallback-1',
    homeTeam: 'Los Angeles Lakers',
    awayTeam: 'Golden State Warriors',
    startTime: new Date(new Date().setHours(new Date().getHours() + 3)),
    prediction: 'Los Angeles Lakers',
    confidence: 68,
    homeOdds: 1.75,
    awayOdds: 2.15
  },
  {
    id: 'fallback-2',
    homeTeam: 'Boston Celtics',
    awayTeam: 'Brooklyn Nets',
    startTime: new Date(new Date().setHours(new Date().getHours() + 4)),
    prediction: 'Boston Celtics',
    confidence: 72,
    homeOdds: 1.65,
    awayOdds: 2.35
  },
  {
    id: 'fallback-3',
    homeTeam: 'Miami Heat',
    awayTeam: 'Philadelphia 76ers',
    startTime: new Date(new Date().setHours(new Date().getHours() + 6)),
    prediction: 'Philadelphia 76ers',
    confidence: 57,
    homeOdds: 2.10,
    awayOdds: 1.75
  },
  {
    id: 'fallback-4',
    homeTeam: 'Phoenix Suns',
    awayTeam: 'Denver Nuggets',
    startTime: new Date(new Date().setHours(new Date().getHours() + 2)),
    prediction: 'Phoenix Suns',
    confidence: 65,
    homeOdds: 1.90,
    awayOdds: 1.95
  }
];

export async function fetchOdds(): Promise<ProcessedGame[]> { 
  try {
    console.log("Fetching data from prediction API...");
    console.log(`API URL: ${BASE_URL}/basketball_nba/odds/`);
    
    // Test if API key is properly loaded
    if (!API_KEY || API_KEY.length < 10) {
      console.error("Invalid API key format:", API_KEY ? `${API_KEY.substring(0, 3)}...` : "undefined");
      throw new Error("API key is invalid or missing");
    }
    
    try {
      const response = await fetch(
        `${BASE_URL}/basketball_nba/odds/?apiKey=${API_KEY}&regions=us&markets=h2h&oddsFormat=decimal`,
        {
          headers: {
            'Accept': 'application/json',
          },
          // Add timeout to prevent long hanging requests
          signal: AbortSignal.timeout(15000)
        }
      );
      
      console.log("Response status:", response.status);
      
      if (!response.ok) {
        // Try to get error details
        let errorDetails = "Unknown error";
        try {
          const errorData = await response.json();
          errorDetails = JSON.stringify(errorData);
          console.error("API error response:", errorData);
        } catch (parseError) {
          console.error("Could not parse error response:", parseError);
          // Try to get text instead
          errorDetails = await response.text();
        }
        
        throw new Error(`API request failed with status ${response.status}: ${errorDetails}`);
      }
      
      const data: Game[] = await response.json();
      console.log(`Successfully fetched data for ${data.length} games`);
      return processGames(data);
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        console.error("Request timed out after 15 seconds");
        throw new Error("API request timed out. Please try again later.");
      }
      throw fetchError;
    }
  } catch (error) {
    console.error('Error fetching odds:', error);
    
    // Check if network connectivity issues
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('Network connection issue detected');
      throw new Error("Network error: Please check your internet connection");
    }
    
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

// For development or when API is down - export a function to get fallback data
export function getFallbackGames(): ProcessedGame[] {
  console.log("Using fallback game data");
  return FALLBACK_GAMES;
}

