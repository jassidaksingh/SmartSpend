# SmartSpend 💰

A modern personal finance management application that helps you track spending, analyze patterns, and get AI-powered financial insights.

## Features ✨

- **Bank Account Integration**: Connect your bank accounts securely via Plaid
- **CSV Upload**: Import transaction data from CSV files
- **Smart Insights**: AI-powered spending analysis and recommendations
- **Visual Analytics**: Interactive charts and spending breakdowns
- **Real-time Chat**: Ask questions about your finances and get personalized advice

## Tech Stack 🛠️

### Frontend
- **Angular 17** - Modern frontend framework
- **Chart.js** - Interactive data visualization
- **TypeScript** - Type-safe development

### Backend
- **Node.js** - Server runtime
- **Express.js** - Web framework
- **Plaid API** - Bank account integration
- **Groq/OpenAI** - AI-powered insights
- **Multer** - File upload handling
- **CSV Parse** - Data processing

## Getting Started 🚀

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Plaid account (for bank integration)
- Groq or OpenAI API key (for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd SmartSpend
   ```

2. **Install dependencies**
   ```bash
   # Install backend dependencies
   cd backend
   npm install
   
   # Install frontend dependencies
   cd ../frontend
   npm install
   ```

3. **Environment Setup**
   ```bash
   # Create environment file in backend directory
   cd ../backend
   cp .env.example .env
   ```
   
   Add your API keys to `backend/.env`:
   ```env
   PORT=3000
   PLAID_CLIENT_ID=your_plaid_client_id
   PLAID_SECRET=your_plaid_secret
   GROQ_API_KEY=your_groq_api_key
   OPENAI_API_KEY=your_openai_api_key
   ```

4. **Start the development servers**
   ```bash
   # Start backend (from backend directory)
   npm run dev
   
   # Start frontend (from frontend directory)
   npm start
   ```

5. **Access the application**
   - Frontend: http://localhost:4200
   - Backend API: http://localhost:3000

## Usage 📖

1. **Connect Bank Account**: Click "Add Account" to securely connect your bank via Plaid
2. **Upload CSV**: Alternatively, upload transaction CSV files for analysis
3. **View Insights**: See spending breakdowns, top categories, and monthly totals
4. **Ask AI**: Use the chat feature to get personalized financial advice
