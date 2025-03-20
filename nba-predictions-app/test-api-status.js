// A script to check the API status
import fetch from 'node-fetch';

// API key from your .env file
const API_KEY = 'eb30a1aa3f880bae6cc92595d7b9660c';

// Status endpoint instead of odds endpoint
const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`;

console.log('Testing API status endpoint...');
console.log('Sending request to:', url.replace(API_KEY, 'API_KEY_HIDDEN'));

const options = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/json'
  },
  timeout: 10000
};

async function checkApiStatus() {
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
      console.log('API Status Response:');
      console.log('Number of sports available:', data.length);
      console.log('First few sports:', data.slice(0, 3));
    } else {
      const errorText = await response.text();
      console.log('Error response:', errorText);
    }
  } catch (error) {
    console.error('Fetch error details:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
  }
}

checkApiStatus(); 