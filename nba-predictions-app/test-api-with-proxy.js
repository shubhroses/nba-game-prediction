// Testing API with CORS proxy
import fetch from 'node-fetch';

// API key from your .env file
const API_KEY = 'eb30a1aa3f880bae6cc92595d7b9660c';

// Using the same CORS proxy as your app
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const baseUrl = 'https://api.the-odds-api.com/v4/sports/basketball_nba/odds/';
const params = `?apiKey=${API_KEY}&regions=us&markets=h2h&oddsFormat=decimal`;
const apiUrl = baseUrl + params;

// Encode the URL for the proxy
const proxyUrl = CORS_PROXY + encodeURIComponent(apiUrl);

console.log('Testing API via CORS proxy...');
console.log('Sending request to:', proxyUrl.replace(API_KEY, 'API_KEY_HIDDEN'));

const options = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/json'
  },
  timeout: 30000 // 30 second timeout for proxy
};

async function testApiWithProxy() {
  try {
    console.log('Starting fetch request via proxy...');
    const response = await fetch(proxyUrl, options);
    console.log('Response received from proxy!');
    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    
    // Log headers
    console.log('Response Headers:');
    for (const [key, value] of response.headers.entries()) {
      console.log(`${key}: ${value}`);
    }
    
    if (response.ok) {
      const data = await response.json();
      console.log('API Response Summary:');
      console.log('Number of games:', data.length);
      if (data.length > 0) {
        console.log('First game teams:', data[0].home_team, 'vs', data[0].away_team);
      }
    } else {
      const errorText = await response.text();
      console.log('Error response:', errorText);
      
      // Try to parse JSON error if available
      try {
        const errorJson = JSON.parse(errorText);
        console.log('Error details:', errorJson);
      } catch (e) {
        // Not JSON, already displayed as text
      }
    }
  } catch (error) {
    console.error('Fetch error details:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
  }
}

testApiWithProxy(); 