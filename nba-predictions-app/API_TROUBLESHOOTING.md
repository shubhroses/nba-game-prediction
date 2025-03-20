# API Connectivity Troubleshooting Guide

If you're encountering issues with the API connection in the NBA Predictions App, follow these steps to diagnose and resolve the problem:

## Common Issues

### 1. API Key Issues

- **Invalid API Key**: Ensure your API key is valid and active
- **Missing API Key**: Make sure the `.env` file contains `VITE_SPORTS_API_KEY=your_api_key`
- **API Key Quota**: Check if you've exceeded your daily quota limit

### 2. CORS (Cross-Origin Resource Sharing) Issues

The browser may block API requests due to CORS restrictions. This is common when making requests directly from the browser to APIs that don't explicitly allow your domain.

**Solutions:**
- Use the built-in CORS proxy (already implemented)
- For production, consider setting up a backend proxy server

### 3. Network Connectivity Problems

- Check your internet connection
- Verify the API service is up and running
- Check if any firewall or security software is blocking requests

## Specific Troubleshooting Steps

### Check Browser Console

1. Open your browser's developer tools (F12 or right-click > Inspect)
2. Go to the Console tab
3. Look for error messages related to the API call
4. Note any specific HTTP status codes or error messages

### Verify Environment Variables

Make sure your `.env` file is correctly set up:

```
VITE_SPORTS_API_KEY=your_api_key
```

The file should be in the root of your project, and you need to restart the development server after making changes.

### Try Enabling Fallback Mode

For testing purposes, you can enable fallback mode:

1. Open `src/hooks/usePredictions.ts`
2. Change `USE_FALLBACK_MODE` to `true` in the CONFIG object
3. Restart the development server

### Testing the API Directly

You can test the API endpoint directly in a tool like Postman or with curl:

```bash
curl -X GET "https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=YOUR_API_KEY&regions=us&markets=h2h&oddsFormat=decimal"
```

Replace `YOUR_API_KEY` with your actual API key.

## Production Deployment Considerations

When deploying to production:

1. Make sure to set the environment variable in your hosting platform's configuration
2. Consider implementing a server-side proxy if CORS issues persist
3. Implement appropriate error handling and fallbacks in production

## Need More Help?

If you're still encountering issues:

1. Check the API provider's documentation and status page
2. Look for any recent changes to the API that might affect compatibility
3. Consider implementing a more robust server-side solution

# Direct API Testing Instructions

If you're experiencing issues connecting to the API, you can test it directly using curl or an API testing tool like Postman. This helps determine if the issue is with your API key, the API service itself, or CORS restrictions.

## Using curl

```bash
curl -X GET "https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=YOUR_API_KEY&regions=us&markets=h2h&oddsFormat=decimal"
```

Replace `YOUR_API_KEY` with your actual API key from your .env file.

## Interpreting Results

### Successful Response
If you receive JSON data back, the API is working correctly. The issue is likely related to CORS restrictions when calling from a browser.

### Error Responses

1. **401 Unauthorized**: Your API key is invalid or expired
2. **429 Too Many Requests**: You've exceeded your API rate limits
3. **404 Not Found**: The API endpoint has changed or is incorrect
4. **Connection timeout**: The API service might be down or there's a network issue

## Alternative CORS Proxies

If the current CORS proxy isn't working, try one of these alternatives by editing `src/services/api.ts`:

1. `https://corsproxy.io/?`
2. `https://cors-anywhere.herokuapp.com/`
3. `https://api.allorigins.win/raw?url=`

## Backend Proxy Solution

For a production app, the best solution is to create a simple backend server that makes the API requests on behalf of your frontend. This eliminates CORS issues entirely.

### Simple Node.js Proxy Example

```javascript
// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

app.get('/api/odds', async (req, res) => {
  try {
    const apiKey = process.env.SPORTS_API_KEY;
    const response = await axios.get(
      `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=decimal`
    );
    res.json(response.data);
  } catch (error) {
    console.error('API error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || 'Failed to fetch odds'
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
``` 