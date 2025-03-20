import { useState, useEffect } from 'react';
import { ProcessedGame } from '../types';
import { fetchOdds, getFallbackGames } from '../services/api';

// Configuration options for development and testing
const CONFIG = {
  // Set this to true to always use fallback data (for development or when API is down)
  USE_FALLBACK_MODE: false,
  
  // Set to true to allow automatic fallback to sample data if API fails
  ALLOW_AUTO_FALLBACK: true,
  
  // How long to wait before timing out API requests (in milliseconds)
  REQUEST_TIMEOUT: 25000, // Increased timeout for production environments
  
  // Number of retries before giving up
  MAX_RETRIES: 3, // Increased number of retries
  
  // Delay between retries (in milliseconds)
  RETRY_DELAY: 2000
};

export function usePredictions() {
  const [predictions, setPredictions] = useState<ProcessedGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [forceFallback, setForceFallback] = useState(CONFIG.USE_FALLBACK_MODE);

  // Function to reset and try again - useful for retry button
  const retryLoading = () => {
    console.log("Retrying data fetch...");
    setLoading(true);
    setError(null);
    setUseFallback(false);
    setRetryCount(0); // Reset retry count
  };
  
  // Function to toggle between real and sample data
  const toggleDataMode = () => {
    const newMode = !forceFallback;
    console.log(`Switching to ${newMode ? 'sample' : 'real'} data mode`);
    setForceFallback(newMode);
    
    // Clear previous state
    setLoading(true);
    setError(null);
    setUseFallback(false);
    setRetryCount(0);
    
    // If switching to real data mode, force a delayed reload to ensure clean state
    if (!newMode) {
      setTimeout(() => {
        retryLoading();
      }, 300);
    }
  };

  useEffect(() => {
    let isMounted = true; // For cleanup/preventing state updates after unmount
    let retryTimeout: number | null = null;
    
    async function loadPredictions() {
      if (!isMounted) return;
      
      try {
        setLoading(true);
        setError(null);
        
        // If in fallback mode, use sample data
        if (forceFallback) {
          console.log("Using fallback mode for development");
          setTimeout(() => {
            if (isMounted) {
              setPredictions(getFallbackGames());
              setLoading(false);
            }
          }, 800); // Simulate API delay
          return;
        }
        
        console.log(`Attempting to fetch live data from API (attempt ${retryCount + 1})...`);
        const data = await fetchOdds();
        
        if (isMounted) {
          console.log(`Successfully loaded ${data.length} predictions from API`);
          setPredictions(data);
          setLoading(false);
          setRetryCount(0); // Reset retry count on success
        }
      } catch (err) {
        if (!isMounted) return;
        
        const errorMessage = err instanceof Error ? err.message : 'Failed to load predictions. Please try again later.';
        console.error('Error loading predictions:', err);
        
        // Handle automatic retries if not exceeding max retries
        if (retryCount < CONFIG.MAX_RETRIES) {
          console.log(`Retry ${retryCount + 1}/${CONFIG.MAX_RETRIES} will start in ${CONFIG.RETRY_DELAY}ms`);
          
          // Use a timeout for retry
          retryTimeout = window.setTimeout(() => {
            if (isMounted) {
              setRetryCount(prev => prev + 1);
            }
          }, CONFIG.RETRY_DELAY);
          return;
        }
        
        // If we've exhausted retries and auto-fallback is enabled, show fallback data
        if (CONFIG.ALLOW_AUTO_FALLBACK && !useFallback && !forceFallback) { // Only auto-fallback if not manually set to force fallback
          console.log("API failed after retries, switching to fallback data");
          setUseFallback(true);
          if (isMounted) {
            setPredictions(getFallbackGames());
            setError(null); // Clear error since we're showing fallback data
            setLoading(false);
          }
        } else {
          if (isMounted) {
            if (forceFallback) {
              // If user has chosen to use fallback data, show it without error
              setPredictions(getFallbackGames());
              setError(null);
              setLoading(false);
            } else {
              // Otherwise show the error
              setError(errorMessage);
              setLoading(false);
            }
          }
        }
      }
    }

    loadPredictions();
    
    // Optional: Set up polling to refresh data every 15 minutes
    const interval = setInterval(loadPredictions, 15 * 60 * 1000);
    
    // Cleanup function
    return () => {
      isMounted = false;
      clearInterval(interval);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [useFallback, retryCount, forceFallback]); // Include retryCount and forceFallback in dependencies

  return { 
    predictions, 
    loading, 
    error,
    isUsingFallback: useFallback || forceFallback,
    retry: retryLoading,
    toggleDataMode,
    isRealDataMode: !forceFallback
  };
}