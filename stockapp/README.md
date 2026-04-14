# 🇮🇳 DALAL STREET INTEL
## Indian Market Intelligence Terminal — Full Stack

A complete stock analysis web application for Indian markets (NSE/BSE) with real-time data via Alpha Vantage API.

---

## 🚀 QUICK START

### Prerequisites
- Node.js v16+ installed

### Installation & Run

```bash
# 1. Navigate to the backend folder
cd backend

# 2. Install dependencies (first time only)
npm install

# 3. Start the server
node server.js

# 4. Open browser at:
http://localhost:3000
```

---

## 📁 FOLDER STRUCTURE

```
stockapp/
├── backend/
│   ├── server.js        ← Express server + all API routes
│   ├── stocks-data.js   ← NSE/BSE stocks master database (30+ stocks)
│   ├── mf-data.js       ← Mutual funds database (15 popular funds)
│   ├── db.json          ← Auto-created: watchlist, portfolio, alerts
│   └── package.json
└── frontend/
    └── public/
        └── index.html   ← Complete single-page frontend
```

---

## ✨ FEATURES

### 📊 Dashboard
- Live Nifty 50, Sensex, Bank Nifty, Nifty IT index cards
- Top Gainers & Losers
- Quick watchlist & portfolio summary

### 🔍 Stock / MF Analyser
- **Real-time data** via Alpha Vantage API (BSE quotes)
- **Autocomplete search** with 80+ stocks and 15 mutual funds
- Price history chart (1M / 3M / 6M / 1Y)
- **Valuation Models:**
  - Graham Number: √(22.5 × EPS × Book Value)
  - Benjamin Graham Revised Formula: EPS × (8.5 + 2g) × 4.4 / Y
  - Peter Lynch Fair Value: EPS × Growth Rate
  - DCF (10yr + Terminal, WACC 12%)
  - Earnings Power Value
  - PEG Ratio
- Fundamental ratios (P/E, P/B, ROE, D/E, margins...)
- Technical levels (50d MA, 200d MA, 52-week range)
- AI-computed overall score + BUY/HOLD/SELL verdict

### 📋 Stock Screener
- Filter by sector, P/E, ROE, Dividend Yield, Debt/Equity, Market Cap
- Click any result to analyse instantly

### 💼 Mutual Fund Explorer
- Filter by category, 3Y CAGR, expense ratio
- Detailed fund cards with NAV, AUM, returns, Sharpe ratio

### 🧮 Valuation Calculator
- Manual input of EPS, Book Value, Growth Rate
- Server-side computation of all 5 valuation models
- Margin of Safety calculation

### ⭐ Watchlist (Persisted)
- Add/remove stocks and funds
- Live prices shown

### 💰 Portfolio Tracker (Persisted)
- Track holdings with buy price and quantity
- Live P&L calculation
- Total invested vs current value

### 🔔 Price Alerts (Persisted)
- Set above/below alerts for any ticker

### 📚 Glossary
- 16 key investment terms explained

---

## 🔌 API ENDPOINTS

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Server health check |
| GET | /api/search?q=QUERY | Search stocks/MFs |
| GET | /api/quote/:ticker | Real-time quote (Alpha Vantage) |
| GET | /api/history/:ticker?period=3m | Price history |
| GET | /api/fundamentals/:ticker | Company fundamentals |
| GET | /api/market/indices | Nifty/Sensex data |
| GET | /api/market/movers | Top gainers/losers |
| POST | /api/calc/valuations | Server-side valuation calc |
| GET/POST/DELETE | /api/watchlist | Watchlist CRUD |
| GET/POST/DELETE | /api/portfolio | Portfolio CRUD |
| GET/POST/DELETE | /api/alerts | Price alerts CRUD |

---

## 📡 DATA SOURCES

| Source | Type | Used For |
|--------|------|---------|
| **Alpha Vantage** (free API) | Real-time | Live quotes, fundamentals, price history |
| **Static DB** (built-in) | Fallback | 30+ NSE/BSE stocks with fundamentals |
| **AMFI data** (built-in) | Static | 15 major mutual funds |
| **Server calculations** | Computed | Graham Number, DCF, Peter Lynch, PEG |

**Alpha Vantage Free Tier:** 25 requests/day, 5 requests/minute.
When limit is hit, app seamlessly falls back to static data with simulated price variance.

---

## 🔑 API KEY

Alpha Vantage key is pre-configured: `EUH7SUBDOR848MOR`

To change it, edit line 8 in `backend/server.js`:
```js
const AV_KEY = 'YOUR_NEW_KEY';
```

---

## ⚠️ DISCLAIMER

For educational purposes only. Not SEBI-registered investment advice.
Consult a qualified financial advisor before investing.
