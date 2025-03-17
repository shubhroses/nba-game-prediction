import { useState, useEffect } from 'react';
import { ProcessedGame } from '../types';
import { fetchOdds, getFallbackGames } from '../services/api';

// Set this to true to always use fallback data (for development or when API is down)
const USE_FALLBACK_MODE = true;

export function usePredictions() {
  const [predictions, setPredictions] = useState<ProcessedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    async function loadPredictions() {
      try {
        setLoading(true);
        setError(null);
        
        // If in fallback mode, use sample data
        if (USE_FALLBACK_MODE) {
          console.log("Using fallback mode for development");
          setTimeout(() => {
            setPredictions(getFallbackGames());
            setLoading(false);
          }, 800); // Simulate API delay
          return;
        }
        
        const data = await fetchOdds();
        setPredictions(data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load predictions. Please try again later.';
        setError(errorMessage);
        console.error('Error loading predictions:', err);
        
        // If API fails, we can opt to show fallback data instead of error
        if (!useFallback) {
          console.log("API failed, switching to fallback data");
          setUseFallback(true);
          setPredictions(getFallbackGames());
          setError(null); // Clear error since we're showing fallback data
        }
      } finally {
        setLoading(false);
      }
    }

    loadPredictions();
    
    // Optional: Set up polling to refresh data every 15 minutes
    const interval = setInterval(loadPredictions, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [useFallback]);

  return { 
    predictions, 
    loading, 
    error,
    isUsingFallback: useFallback || USE_FALLBACK_MODE 
  };
}