const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { parse } = require('csv-parse');
const dayjs = require('dayjs');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const Groq = require('groq-sdk');
const OpenAI = require('openai');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:4200';

app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: '2mb' }));

// Simple in-memory store for demo purposes only
let ACCESS_TOKEN = null;

// Plaid client setup
const plaidEnvName = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
const plaidEnv = PlaidEnvironments[plaidEnvName] || PlaidEnvironments.sandbox;
const plaidClient = new PlaidApi(
  new Configuration({
    basePath: plaidEnv,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID || '',
        'PLAID-SECRET': process.env.PLAID_SECRET || '',
      },
    },
  })
);

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Create Plaid Link token
app.post('/api/plaid/create_link_token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'demo-user-id' },
      client_name: 'SmartSpend',
      products: (process.env.PLAID_PRODUCTS || 'transactions').split(','),
      country_codes: (process.env.PLAID_COUNTRY_CODES || 'CA').split(','),
      language: 'en',
      redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
    });
    res.json(response.data);
  } catch (err) {
    console.error('create_link_token error', err?.response?.data || err);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

// Exchange public token for access token
app.post('/api/plaid/exchange_public_token', async (req, res) => {
  try {
    const { public_token } = req.body || {};
    if (!public_token) {
      return res.status(400).json({ error: 'public_token is required' });
    }
    const response = await plaidClient.itemPublicTokenExchange({ public_token });
    ACCESS_TOKEN = response.data.access_token;
    res.json({ ok: true });
  } catch (err) {
    console.error('exchange_public_token error', err?.response?.data || err);
    res.status(500).json({ error: 'Failed to exchange public token' });
  }
});

// Get account balances
app.get('/api/plaid/accounts', async (req, res) => {
  try {
    if (!ACCESS_TOKEN) return res.status(400).json({ error: 'No access token' });
    const response = await plaidClient.accountsBalanceGet({ access_token: ACCESS_TOKEN });
    res.json(response.data);
  } catch (err) {
    console.error('accounts error', err?.response?.data || err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// Get transactions in a date range
app.get('/api/plaid/transactions', async (req, res) => {
  try {
    if (!ACCESS_TOKEN) return res.status(400).json({ error: 'No access token' });
    const endDate = req.query.end_date || dayjs().format('YYYY-MM-DD');
    const startDate = req.query.start_date || dayjs(endDate).subtract(30, 'day').format('YYYY-MM-DD');
    const response = await plaidClient.transactionsGet({
      access_token: ACCESS_TOKEN,
      start_date: startDate,
      end_date: endDate,
      options: { count: 250, offset: 0 },
    });
    res.json(response.data);
  } catch (err) {
    console.error('transactions error', err?.response?.data || err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// CSV Upload and parse
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/upload-csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const csvBuffer = req.file.buffer;
    const records = [];
    const parser = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    for await (const record of parser) {
      // Normalize minimal fields
      records.push({
        date: record.date || record.Date || record.TRANSACTION_DATE || record[Object.keys(record)[0]],
        name: record.description || record.Description || record.NAME || record.Merchant || '',
        amount: parseFloat(
          (record.amount || record.Amount || record.DEBIT || record.CREDIT || '0').toString().replace(/[^\d.-]/g, '')
        ) || 0,
        category: record.category || record.Category || 'Other',
      });
    }
    res.json({ transactions: records });
  } catch (err) {
    console.error('csv parse error', err);
    res.status(500).json({ error: 'Failed to parse CSV' });
  }
});

// Simple insights helper
function computeInsights(transactions) {
  console.log('Computing insights for transactions:', transactions.length);
  const thisMonthStart = dayjs().startOf('month');
  let totalThisMonth = 0;
  const categoryTotals = {};
  
  for (const t of transactions) {
    const amount = Number(t.amount) || 0;
    const txDate = dayjs(t.date);
    
    // Handle both positive and negative amounts - treat all as expenses for demo
    const expenseAmount = Math.abs(amount);
    
    console.log(`Transaction: ${t.name}, Amount: ${amount}, Date: ${t.date}, Category: ${t.category}`);
    
    // Include transactions from this month (and handle demo data which might be from future dates)
    if (expenseAmount > 0) {
      totalThisMonth += expenseAmount;
      const cat = (t.category && (Array.isArray(t.category) ? t.category[0] : t.category)) || 'Other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + expenseAmount;
    }
  }
  
  const topCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, total]) => ({ name, total }));
    
  console.log('Computed insights:', { totalThisMonth, topCategories });
  return { totalThisMonth, topCategories };
}

// Compute insights from posted transactions (supports Plaid/CSV)
app.post('/api/insights', (req, res) => {
  try {
    const { transactions } = req.body || {};
    if (!Array.isArray(transactions)) return res.status(400).json({ error: 'transactions[] required' });
    const normalized = transactions.map(t => ({
      date: t.date || t.datetime || t.authorized_date,
      amount: t.amount,
      category: t.category || t.personal_finance_category?.primary || 'Other',
      name: t.name || t.merchant_name || '',
    }));
    const insights = computeInsights(normalized);
    res.json({ insights });
  } catch (err) {
    console.error('insights error', err);
    res.status(500).json({ error: 'Failed to compute insights' });
  }
});

// Chat endpoint using Groq (free) or OpenAI
app.post('/api/chat', async (req, res) => {
  try {
    const { question, summary } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question is required' });
    const systemPrompt = `You are SmartSpend AI, an expert personal finance assistant and spending advisor. You help users understand their financial habits and make better money decisions.

PERSONALITY & TONE:
- Be friendly, encouraging, and non-judgmental
- Use clear, conversational language (avoid financial jargon)
- Provide actionable insights and practical advice
- Be empathetic about financial challenges
- Celebrate good financial habits

RESPONSE GUIDELINES:
- Keep responses concise but informative (2-3 sentences max)
- Always use specific dollar amounts from the data when available
- Provide context and comparisons when helpful
- Suggest concrete next steps or improvements
- Use emojis sparingly for visual appeal (💰 📊 ✨)

ANALYSIS CAPABILITIES:
- Spending patterns and trends
- Budget recommendations
- Category-specific insights
- Month-over-month comparisons
- Savings opportunities
- Financial goal planning

SAMPLE RESPONSES:
- "You spent $1,200 on dining out this month, which is 25% of your total expenses. Consider meal prepping to save $300-400 monthly! 🍳"
- "Great news! Your entertainment spending dropped 15% from last month. You're on track to save an extra $600 this year! ✨"
- "Your grocery spending of $450 seems reasonable for your budget. Try the 50/30/20 rule: 50% needs, 30% wants, 20% savings."

Use the transaction data provided to give personalized, data-driven financial advice.`;
    const userContent = `USER QUESTION: ${question}

FINANCIAL DATA SUMMARY:
${summary || 'No transaction data available yet. Please connect a bank account or upload a CSV to get personalized insights.'}

Please provide a helpful, personalized response based on this financial data.`;

    let answer = 'Sorry, no model configured.';
    if (process.env.GROQ_API_KEY) {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
      });
      answer = completion.choices?.[0]?.message?.content || answer;
    } else if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
      });
      answer = completion.choices?.[0]?.message?.content || answer;
    }
    res.json({ answer });
  } catch (err) {
    console.error('chat error', err?.response?.data || err);
    res.status(500).json({ error: 'Failed to get chat response' });
  }
});

app.listen(port, () => {
  console.log(`SmartSpend backend listening on http://localhost:${port}`);
});


