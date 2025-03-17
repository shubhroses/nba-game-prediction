export interface Game {
    id: string;
    sport_key: string;
    sport_title: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: Bookmaker[];
}

export interface Bookmaker {
    key: string;
    title: string;
    last_update: string;
    markets: Market[];
}

export interface Market {
    key: string;
    outcomes: Outcome[];
}

export interface Outcome {
    name: string;
    price: number;
}

export interface ProcessedGame {
    id: string;
    homeTeam: string;
    awayTeam: string;
    startTime: Date;
    prediction: string;
    confidence: number;
    homeOdds: number;
    awayOdds: number;
}