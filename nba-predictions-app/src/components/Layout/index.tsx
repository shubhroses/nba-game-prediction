import React from 'react';
import { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white shadow-md">
        <div className="container mx-auto py-6 px-4">
          <h1 className="text-3xl font-bold">NBA Game Predictions</h1>
          <div className="flex items-center mt-2">
            <div className="h-1 w-10 bg-blue-400 rounded mr-2"></div>
            <p className="text-blue-100">AI-Powered Basketball Insights</p>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto py-8 px-4">
        {children}
      </main>
      
      <footer className="bg-gray-800 text-gray-300">
        <div className="container mx-auto py-6 px-4">
          <div className="text-center mb-4">
            <p className="text-sm bg-gray-700 inline-block px-4 py-2 rounded-full">
              Disclaimer: These predictions are based on statistical analysis and are for entertainment purposes only.
            </p>
          </div>
          <div className="flex justify-between items-center border-t border-gray-700 pt-4">
            <p className="text-sm">© {new Date().getFullYear()} NBA Predictions App</p>
            <div className="flex space-x-4">
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                Terms
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                Privacy
              </a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors">
                About
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}