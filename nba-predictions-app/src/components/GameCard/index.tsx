import React from 'react';
import { ProcessedGame } from '../../types';
import { formatDate, formatOdds } from '../../utils/formatters';
import TeamLogo from '../TeamLogo';

interface GameCardProps {
  game: ProcessedGame;
}

export default function GameCard({ game }: GameCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden">
      {/* Header with date and confidence */}
      <div className="bg-gray-50 px-4 py-3 border-b flex justify-between items-center">
        <span className="text-gray-600 text-sm font-medium">{formatDate(game.startTime)}</span>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          game.confidence >= 70 
            ? 'bg-green-100 text-green-800' 
            : game.confidence >= 55 
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-gray-100 text-gray-600'
        }`}>
          {isNaN(game.confidence) ? 'No Data' : `${game.confidence}% Confidence`}
        </span>
      </div>
      
      {/* Teams comparison */}
      <div className="p-5">
        <div className="flex justify-between items-center mb-4">
          <div className="flex flex-col items-center w-2/5">
            <div className="mb-3">
              <TeamLogo teamName={game.homeTeam} size="lg" />
            </div>
            <div className="text-center">
              <div className="font-semibold text-sm sm:text-base">{game.homeTeam}</div>
              <div className="text-gray-600 text-xs sm:text-sm font-mono mt-1">{formatOdds(game.homeOdds)}</div>
            </div>
          </div>
          
          <div className="text-gray-400 font-bold text-lg">VS</div>
          
          <div className="flex flex-col items-center w-2/5">
            <div className="mb-3">
              <TeamLogo teamName={game.awayTeam} size="lg" />
            </div>
            <div className="text-center">
              <div className="font-semibold text-sm sm:text-base">{game.awayTeam}</div>
              <div className="text-gray-600 text-xs sm:text-sm font-mono mt-1">{formatOdds(game.awayOdds)}</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Prediction footer */}
      <div className={`p-3 text-center ${
        !game.prediction ? 'bg-gray-100 text-gray-700' :
        game.prediction === game.homeTeam 
          ? 'bg-blue-50 text-blue-800 border-t border-blue-100' 
          : 'bg-purple-50 text-purple-800 border-t border-purple-100'
      }`}>
        {game.prediction ? (
          <>Prediction: <strong>{game.prediction}</strong> to win</>
        ) : (
          <>Prediction data unavailable</>
        )}
      </div>
    </div>
  );
}