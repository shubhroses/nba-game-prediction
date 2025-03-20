import React from 'react';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import PredictionsList from './components/PredictionsList';
import { usePredictions } from './hooks/usePredictions';

// Check if we're in development mode
const isDevelopment = import.meta.env.DEV;

function App() {
  const { predictions, loading, error, isUsingFallback, retry, toggleDataMode, isRealDataMode } = usePredictions();

  return (
    <Layout>
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-semibold">Upcoming Games & Predictions</h2>
          
          {/* Data mode toggle button */}
          <button
            onClick={toggleDataMode}
            className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
              isRealDataMode 
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            }`}
          >
            {isRealDataMode ? 'Using Real Data' : 'Using Sample Data'}
          </button>
        </div>
        
        <p className="text-gray-600">
          Our predictions are based on advanced statistical analysis.
        </p>
        
        {isDevelopment && (
          <div className="mt-3 bg-amber-50 text-amber-700 px-4 py-2 rounded-md text-sm mb-2">
            Development Mode Active
          </div>
        )}
        
        {isUsingFallback && !loading && !error && (
          <div className="mt-3 bg-blue-50 border border-blue-200 p-4 rounded-md">
            <div className="flex items-center mb-2">
              <svg className="w-5 h-5 text-blue-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-md font-semibold text-blue-700">Sample Data Mode</h3>
            </div>
            <p className="text-blue-600">
              Currently displaying sample prediction data for demonstration purposes.
              Click the "Using Sample Data" button above to try fetching real API data.
            </p>
          </div>
        )}

        {!isUsingFallback && !loading && !error && (
          <div className="mt-3 bg-green-50 border border-green-200 p-4 rounded-md">
            <div className="flex items-center mb-2">
              <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <h3 className="text-md font-semibold text-green-700">Live Data Mode</h3>
            </div>
            <p className="text-green-600">
              Displaying real-time prediction data. Predictions are updated regularly based on the latest statistics.
            </p>
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
          <div className="flex mt-4 space-x-4">
            <button 
              onClick={retry} 
              className="px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
            >
              Try Again
            </button>
            <button 
              onClick={() => window.location.reload()} 
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      ) : (
        <PredictionsList predictions={predictions} />
      )}
    </Layout>
  );
}

export default App;