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

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV;

// CORS proxy for development
// Using a modern proxy that doesn't require special headers
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

// Alternative proxies if needed:
// const CORS_PROXY = 'https://corsproxy.io/?';
// const CORS_PROXY = 'https://cors-anywhere.herokuapp.com/';

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
  },
  {
    id: 'fallback-5',
    homeTeam: 'Milwaukee Bucks',
    awayTeam: 'Chicago Bulls',
    startTime: new Date(new Date().setHours(new Date().getHours() + 5)),
    prediction: 'Milwaukee Bucks',
    confidence: 81,
    homeOdds: 1.40,
    awayOdds: 2.90
  },
  {
    id: 'fallback-6',
    homeTeam: 'Dallas Mavericks',
    awayTeam: 'Houston Rockets',
    startTime: new Date(new Date().setHours(new Date().getHours() + 7)),
    prediction: 'Dallas Mavericks',
    confidence: 74,
    homeOdds: 1.55,
    awayOdds: 2.45
  },
  {
    id: 'fallback-7',
    homeTeam: 'Toronto Raptors',
    awayTeam: 'Cleveland Cavaliers',
    startTime: new Date(new Date().setHours(new Date().getHours() + 1)),
    prediction: 'Cleveland Cavaliers',
    confidence: 59,
    homeOdds: 2.20,
    awayOdds: 1.68
  },
  {
    id: 'fallback-8',
    homeTeam: 'New York Knicks',
    awayTeam: 'Atlanta Hawks',
    startTime: new Date(new Date().setHours(new Date().getHours() + 8)),
    prediction: 'New York Knicks',
    confidence: 63,
    homeOdds: 1.85,
    awayOdds: 2.00
  }
];

export async function fetchOdds(): Promise<ProcessedGame[]> { 
  try {
    console.log("====== API REQUEST DETAILS ======");
    console.log("Fetching data from prediction API...");
    console.log("API Key length:", API_KEY.length);
    console.log("API Key format valid:", API_KEY.length >= 10);
    console.log("Environment:", isDevelopment ? "Development" : "Production");
    
    // Test if API key is properly loaded
    if (!API_KEY || API_KEY.length < 10) {
      console.error("Invalid API key format:", API_KEY ? `${API_KEY.substring(0, 3)}...` : "undefined");
      throw new Error("API key is invalid or missing");
    }
    
    // Prepare the base API URL
    const apiUrl = `${BASE_URL}/basketball_nba/odds/?apiKey=${API_KEY}&regions=us&markets=h2h&oddsFormat=decimal`;
    console.log("Base API URL (without key):", BASE_URL + "/basketball_nba/odds/");
    
    // ALWAYS use the CORS proxy that we've confirmed works
    try {
      console.log("Attempting request with CORS proxy...");
      
      // Use the CORS proxy with proper encoding (this approach worked in our test)
      const requestUrl = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`;
      
      console.log("CORS Proxy being used:", CORS_PROXY);
      console.log("Sending full request to:", requestUrl.replace(API_KEY, "API_KEY_HIDDEN"));
      
      const response = await fetch(requestUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        signal: AbortSignal.timeout(20000), // Increase timeout slightly
        credentials: 'omit'
      });
      
      console.log("Response received, status:", response.status, response.statusText);
      
      if (response.ok) {
        console.log("CORS proxy request successful");
        const data: Game[] = await response.json();
        console.log(`Successfully fetched data for ${data.length} games`);
        return processGames(data);
      } else {
        // Handle specific error codes
        if (response.status === 401) {
          throw new Error("API key unauthorized. Please check your API key.");
        } else if (response.status === 429) {
          throw new Error("API rate limit exceeded. Please try again later.");
        } else {
          const errorText = await response.text();
          console.error("API error response:", errorText);
          throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
        }
      }
    } catch (error) {
      console.error("Error during API request:", error);
      // Rethrow the error with more context
      if (error instanceof Error) {
        throw new Error(`API request failed: ${error.message}`);
      }
      throw error;
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

