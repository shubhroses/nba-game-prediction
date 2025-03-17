import { useState, useEffect } from 'react';
import { ProcessedGame } from '../types';
import { fetchOdds } from '../services/api';

export function usePredictions() {
  const [predictions, setPredictions] = useState<ProcessedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPredictions() {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchOdds();
        setPredictions(data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load predictions. Please try again later.';
        setError(errorMessage);
        console.error('Error loading predictions:', err);
      } finally {
        setLoading(false);
      }
    }

    loadPredictions();
    
    // Optional: Set up polling to refresh data every 15 minutes
    const interval = setInterval(loadPredictions, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { predictions, loading, error };
}