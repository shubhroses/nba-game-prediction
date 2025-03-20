# NBA Game Prediction App

A modern web application that provides AI-powered predictions for upcoming NBA basketball games with confidence ratings and visual statistics.

**Note:** The application is currently configured to run in demonstration mode with sample prediction data. This ensures reliable operation for demonstration purposes while avoiding API rate limits and connectivity issues.

![NBA Game Predictions App](https://github.com/shubhroses/nba-game-prediction/raw/main/screenshot.png)

## Features

- **Real-time Game Predictions**: View predictions for upcoming NBA games with confidence ratings
- **Team Logo Integration**: Official NBA team logos with intelligent fallback mechanism 
- **Responsive Design**: Works seamlessly on mobile, tablet, and desktop devices
- **Confidence Indicators**: Color-coded confidence ratings for each prediction
- **Sorting Algorithm**: Games sorted by confidence level and start time
- **Fallback Mechanism**: Sample data display when API is unavailable
- **Error Handling**: User-friendly error states with recovery options

## Technologies Used

- **Frontend**:
  - React with TypeScript
  - Tailwind CSS for styling
  - Vite for fast builds and development
  
- **Data Processing**:
  - Custom prediction algorithm based on statistical analysis
  - Dynamic confidence calculation
  - Data normalization pipeline
  
- **Deployment**:
  - Vercel for hosting and CI/CD
  - Environment variable management

## Implementation Details

### Prediction Algorithm

The application uses a sophisticated prediction system that:
1. Processes statistical data for NBA teams
2. Calculates implied probabilities 
3. Normalizes probabilities to account for margins
4. Determines confidence levels based on probability differentials

### UI Components

- **GameCard**: Displays matchup details with team logos, odds, and prediction
- **TeamLogo**: Handles official NBA logos with algorithmic color generation for fallbacks
- **PredictionsList**: Manages the display and sorting of game predictions
- **Layout**: Provides consistent structure with header and disclaimer footer

### Error Handling & Resilience

- Enhanced error states with detailed messages
- Automatic fallback to sample data when API is unavailable
- Timeout handling for network requests
- Visual indicators when using fallback data

## Setup and Development

### Prerequisites
- Node.js 14+ and npm/yarn

### Installation
1. Clone the repository
```bash
git clone https://github.com/shubhroses/nba-game-prediction.git
cd nba-predictions-app
```

2. Install dependencies
```bash
npm install
# or
yarn
```

3. Set up environment variables
Create a `.env` file in the root directory:
```
VITE_SPORTS_API_KEY=your_api_key
```

4. Start the development server
```bash
npm run dev
# or
yarn dev
```

## Deployment

This application is deployed on Vercel. To deploy your own instance:

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Configure the environment variables in the Vercel dashboard
4. Deploy!

Alternatively, use the Vercel CLI:
```bash
npm install -g vercel
vercel
```

## Future Improvements

- Add user authentication for personalized predictions
- Implement historical accuracy tracking
- Add more detailed statistical breakdowns
- Create a mobile app version

## License

MIT

## Author

Shubhrose Singh - [GitHub](https://github.com/shubhroses) | [LinkedIn](https://linkedin.com/in/yourprofile)
