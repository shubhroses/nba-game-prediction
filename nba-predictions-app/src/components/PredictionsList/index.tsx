import React from 'react';
import { ProcessedGame } from '../../types';
import GameCard from '../GameCard';

interface PredictionsListProps {
  predictions: ProcessedGame[];
}

export default function PredictionsList({ predictions }: PredictionsListProps) {
  if (predictions.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p className="text-lg font-medium">No upcoming games found</p>
        <p className="mt-2">Check back later for new predictions.</p>
      </div>
    );
  }

  // Sort games by confidence (highest first) and then by start time
  const sortedPredictions = [...predictions].sort((a, b) => {
    // Handle NaN confidence
    const aConf = isNaN(a.confidence) ? 0 : a.confidence;
    const bConf = isNaN(b.confidence) ? 0 : b.confidence;
    
    if (bConf !== aConf) {
      return bConf - aConf;
    }
    return a.startTime.getTime() - b.startTime.getTime();
  });
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {sortedPredictions.map(game => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}