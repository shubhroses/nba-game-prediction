import React, { Component, ErrorInfo, ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div style={{ 
          padding: '20px', 
          maxWidth: '800px', 
          margin: '0 auto', 
          fontFamily: 'system-ui, sans-serif' 
        }}>
          <h1>Something went wrong</h1>
          <p>The application encountered an error. Here are the details:</p>
          <div style={{ 
            backgroundColor: '#f8f8f8', 
            padding: '15px', 
            borderRadius: '4px',
            marginBottom: '20px',
            border: '1px solid #ddd'
          }}>
            <h3>Error: {this.state.error?.message}</h3>
            <details style={{ whiteSpace: 'pre-wrap' }}>
              <summary>Stack trace</summary>
              <p>{this.state.error?.stack}</p>
              <p>{this.state.errorInfo?.componentStack}</p>
            </details>
          </div>
          <p>Please check the console for more information.</p>
          <div>
            <h3>Environment information:</h3>
            <pre style={{ 
              backgroundColor: '#f8f8f8', 
              padding: '10px', 
              borderRadius: '4px', 
              overflowX: 'auto',
              border: '1px solid #ddd'
            }}>
              {JSON.stringify({
                hostname: window.location.hostname,
                pathname: window.location.pathname,
                userAgent: navigator.userAgent,
                timeStamp: new Date().toISOString(),
                mode: import.meta.env?.MODE || 'unknown',
                isProduction: import.meta.env?.PROD || false
              }, null, 2)}
            </pre>
          </div>
          <button 
            onClick={() => window.location.reload()} 
            style={{
              backgroundColor: '#4CAF50',
              border: 'none',
              color: 'white',
              padding: '10px 20px',
              textAlign: 'center',
              textDecoration: 'none',
              display: 'inline-block',
              fontSize: '16px',
              margin: '20px 0',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
) 