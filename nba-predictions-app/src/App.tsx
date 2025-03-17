import React from 'react';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import PredictionsList from './components/PredictionsList';
import { usePredictions } from './hooks/usePredictions';

function App() {
  const { predictions, loading, error, isUsingFallback } = usePredictions();

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Upcoming Games & Predictions</h2>
        <p className="text-gray-600">
          Our predictions are based on advanced statistical analysis.
        </p>
        
        {isUsingFallback && (
          <div className="mt-3 bg-blue-50 text-blue-700 px-4 py-2 rounded-md text-sm">
            Note: Currently displaying sample prediction data for demonstration purposes.
          </div>
        )}
      </div>
      
      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-semibold text-red-800">Unable to Load Predictions</h3>
          </div>
          <p className="text-red-700">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : (
        <PredictionsList predictions={predictions} />
      )}
    </Layout>
  );
}

export default App;