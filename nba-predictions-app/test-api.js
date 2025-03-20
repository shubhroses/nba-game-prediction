// A simple Node.js script to test the API directly without CORS issues
import fetch from 'node-fetch';

// API key from your .env file
const API_KEY = 'eb30a1aa3f880bae6cc92595d7b9660c';

// Make the API request with full debugging
const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${API_KEY}&regions=us&markets=h2h&oddsFormat=decimal`;

console.log('Testing API connection...');
console.log('Sending request to:', url.replace(API_KEY, 'API_KEY_HIDDEN'));

// Try using a different user agent to avoid potential blocking
const options = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/json'
  },
  timeout: 10000 // 10 second timeout
};

async function testApi() {
  try {
    console.log('Starting fetch request...');
    const response = await fetch(url, options);
    console.log('Response received!');
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
    }
  } catch (error) {
    console.error('Fetch error details:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.cause) {
      console.error('Error cause:', error.cause);
    }
  }
}

testApi(); 