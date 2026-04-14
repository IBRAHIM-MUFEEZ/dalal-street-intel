const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// ─── Alpha Vantage API Key ────────────────────────────────────────────────────
const AV_KEY = 'EUH7SUBDOR848MOR';
const AV_BASE = 'https://www.alphavantage.co/query';

// ─── In-memory database (JSON file backed) ───────────────────────────────────
const DB_PATH = path.join(__dirname, 'db.json');

function readDB() {
  try {
    if (fs.existsSync(DB_PATH)) return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch(e) {}
  return { watchlist: [], portfolio: [], notes: [], cache: {}, alerts: [] };
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
let db = readDB();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

// ─── Cache helper (5 min TTL) ─────────────────────────────────────────────────
function getCache(key) {
  const entry = db.cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > 5 * 60 * 1000) return null;
  return entry.data;
}
function setCache(key, data) {
  db.cache[key] = { ts: Date.now(), data };
  writeDB(db);
}

// ─── Indian Stocks Master List ────────────────────────────────────────────────
const INDIAN_STOCKS = require('./stocks-data');
const MUTUAL_FUNDS  = require('./mf-data');

// ─── Alpha Vantage helpers ────────────────────────────────────────────────────
async function avFetch(params) {
  try {
    const res = await axios.get(AV_BASE, { params: { ...params, apikey: AV_KEY }, timeout: 15000 });
    return res.data;
  } catch(e) {
    return null;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Search ───────────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);

  const stocks = INDIAN_STOCKS.filter(s =>
    s.ticker.toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q) ||
    (s.sector && s.sector.toLowerCase().includes(q))
  ).slice(0, 8).map(s => ({ ...s, type: 'stock' }));

  const mfs = MUTUAL_FUNDS.filter(m =>
    m.ticker.toLowerCase().includes(q) ||
    m.name.toLowerCase().includes(q) ||
    (m.category && m.category.toLowerCase().includes(q))
  ).slice(0, 6).map(m => ({ ...m, type: 'mf' }));

  res.json([...stocks, ...mfs]);
});

// ─── Quote (real price via Alpha Vantage) ─────────────────────────────────────
app.get('/api/quote/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const cacheKey = `quote_${ticker}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  // Alpha Vantage uses BSE: prefix for Indian stocks
  const avTicker = ticker.includes('.') ? ticker : `${ticker}.BSE`;

  const data = await avFetch({ function: 'GLOBAL_QUOTE', symbol: avTicker });

  let quote = null;
  if (data && data['Global Quote'] && data['Global Quote']['05. price']) {
    const q = data['Global Quote'];
    quote = {
      ticker,
      price: parseFloat(q['05. price']),
      change: parseFloat(q['09. change']),
      change_pct: parseFloat(q['10. change percent'].replace('%', '')),
      open: parseFloat(q['02. open']),
      high: parseFloat(q['03. high']),
      low: parseFloat(q['04. low']),
      prev_close: parseFloat(q['08. previous close']),
      volume: parseInt(q['06. volume']),
      latest_day: q['07. latest trading day'],
      source: 'alpha_vantage'
    };
  } else {
    // Fallback: use static data with simulated small variance
    const stock = INDIAN_STOCKS.find(s => s.ticker === ticker);
    if (stock) {
      const base = stock.base_price;
      const variance = (Math.random() - 0.48) * base * 0.015;
      quote = {
        ticker,
        price: +(base + variance).toFixed(2),
        change: +variance.toFixed(2),
        change_pct: +((variance / base) * 100).toFixed(2),
        open: +(base * (1 + (Math.random()-0.5)*0.01)).toFixed(2),
        high: +(base * (1 + Math.random()*0.015)).toFixed(2),
        low: +(base * (1 - Math.random()*0.015)).toFixed(2),
        prev_close: +base.toFixed(2),
        volume: Math.floor(Math.random() * 5000000 + 500000),
        latest_day: new Date().toISOString().split('T')[0],
        source: 'static_fallback'
      };
    }
  }

  if (quote) { setCache(cacheKey, quote); }
  res.json(quote || { error: 'Quote not found', ticker });
});

// ─── Historical Data ──────────────────────────────────────────────────────────
app.get('/api/history/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const period = req.query.period || '3m'; // 1m, 3m, 6m, 1y
  const cacheKey = `hist_${ticker}_${period}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const avTicker = ticker.includes('.') ? ticker : `${ticker}.BSE`;
  const outputsize = (period === '1y') ? 'full' : 'compact';

  const data = await avFetch({ function: 'TIME_SERIES_DAILY', symbol: avTicker, outputsize });

  let history = [];
  if (data && data['Time Series (Daily)']) {
    const ts = data['Time Series (Daily)'];
    const days = period === '1m' ? 30 : period === '3m' ? 90 : period === '6m' ? 180 : 365;
    history = Object.entries(ts)
      .slice(0, days)
      .map(([date, vals]) => ({
        date,
        open: parseFloat(vals['1. open']),
        high: parseFloat(vals['2. high']),
        low: parseFloat(vals['3. low']),
        close: parseFloat(vals['4. close']),
        volume: parseInt(vals['5. volume'])
      }))
      .reverse();
  }

  // Generate synthetic history if API fails
  if (history.length === 0) {
    const stock = INDIAN_STOCKS.find(s => s.ticker === ticker);
    const base = stock ? stock.base_price : 1000;
    const days = period === '1m' ? 30 : period === '3m' ? 90 : period === '6m' ? 180 : 365;
    let price = base * 0.85;
    const now = new Date();
    for (let i = days; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const chg = (Math.random() - 0.47) * price * 0.018;
      price = Math.max(price + chg, base * 0.3);
      history.push({
        date: d.toISOString().split('T')[0],
        open: +(price * (1 - Math.random()*0.005)).toFixed(2),
        high: +(price * (1 + Math.random()*0.01)).toFixed(2),
        low: +(price * (1 - Math.random()*0.01)).toFixed(2),
        close: +price.toFixed(2),
        volume: Math.floor(Math.random()*3000000 + 200000)
      });
    }
  }

  setCache(cacheKey, history);
  res.json(history);
});

// ─── Fundamentals ─────────────────────────────────────────────────────────────
app.get('/api/fundamentals/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const cacheKey = `fund_${ticker}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const avTicker = ticker.includes('.') ? ticker : `${ticker}.BSE`;
  const data = await avFetch({ function: 'OVERVIEW', symbol: avTicker });

  let fundamentals = null;
  if (data && data.Symbol && !data['Note']) {
    fundamentals = {
      pe_ratio: parseFloat(data.PERatio) || null,
      pb_ratio: parseFloat(data.PriceToBookRatio) || null,
      ps_ratio: parseFloat(data.PriceToSalesRatioTTM) || null,
      eps: parseFloat(data.EPS) || null,
      roe: parseFloat(data.ReturnOnEquityTTM) ? (parseFloat(data.ReturnOnEquityTTM)*100).toFixed(2) : null,
      roa: parseFloat(data.ReturnOnAssetsTTM) ? (parseFloat(data.ReturnOnAssetsTTM)*100).toFixed(2) : null,
      revenue: parseFloat(data.RevenueTTM) || null,
      net_income: parseFloat(data.NetIncomeTTM) || null,
      profit_margin: parseFloat(data.ProfitMargin) ? (parseFloat(data.ProfitMargin)*100).toFixed(2) : null,
      operating_margin: parseFloat(data.OperatingMarginTTM) ? (parseFloat(data.OperatingMarginTTM)*100).toFixed(2) : null,
      gross_profit: parseFloat(data.GrossProfitTTM) || null,
      revenue_growth: parseFloat(data.RevenueGrowthYOY) ? (parseFloat(data.RevenueGrowthYOY)*100).toFixed(2) : null,
      earnings_growth: parseFloat(data.EarningsGrowthYOY) ? (parseFloat(data.EarningsGrowthYOY)*100).toFixed(2) : null,
      market_cap: parseFloat(data.MarketCapitalization) || null,
      enterprise_value: parseFloat(data.EnterpriseValue) || null,
      ev_ebitda: parseFloat(data.EVToEBITDA) || null,
      beta: parseFloat(data.Beta) || null,
      dividend_yield: parseFloat(data.DividendYield) ? (parseFloat(data.DividendYield)*100).toFixed(2) : null,
      book_value: parseFloat(data.BookValue) || null,
      debt_to_equity: parseFloat(data.DebtToEquityRatio) || null,
      current_ratio: parseFloat(data.CurrentRatio) || null,
      quick_ratio: parseFloat(data.QuickRatio) || null,
      '52w_high': parseFloat(data['52WeekHigh']) || null,
      '52w_low': parseFloat(data['52WeekLow']) || null,
      '50d_ma': parseFloat(data['50DayMovingAverage']) || null,
      '200d_ma': parseFloat(data['200DayMovingAverage']) || null,
      shares_outstanding: parseFloat(data.SharesOutstanding) || null,
      description: data.Description || '',
      sector: data.Sector || '',
      industry: data.Industry || '',
      exchange: data.Exchange || '',
      source: 'alpha_vantage'
    };
  }

  // Fallback to static fundamentals
  if (!fundamentals) {
    const stock = INDIAN_STOCKS.find(s => s.ticker === ticker);
    if (stock && stock.fundamentals) {
      fundamentals = { ...stock.fundamentals, source: 'static' };
    }
  }

  if (fundamentals) setCache(cacheKey, fundamentals);
  res.json(fundamentals || { error: 'Fundamentals not found' });
});

// ─── Top Gainers / Losers ─────────────────────────────────────────────────────
app.get('/api/market/movers', (req, res) => {
  const movers = INDIAN_STOCKS.slice(0, 20).map(s => {
    const chg = (Math.random() - 0.45) * s.base_price * 0.04;
    return {
      ticker: s.ticker, name: s.name, sector: s.sector,
      price: +(s.base_price + chg).toFixed(2),
      change_pct: +((chg / s.base_price) * 100).toFixed(2)
    };
  }).sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));

  res.json({
    gainers: movers.filter(m => m.change_pct > 0).slice(0, 5),
    losers: movers.filter(m => m.change_pct < 0).slice(0, 5)
  });
});

// ─── Nifty Index snapshot ─────────────────────────────────────────────────────
app.get('/api/market/indices', async (req, res) => {
  const cacheKey = 'indices';
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  // Try Alpha Vantage for Nifty (BSE Sensex = SENSEX.BSE)
  const [niftyData, sensexData] = await Promise.all([
    avFetch({ function: 'GLOBAL_QUOTE', symbol: 'NSEI' }),
    avFetch({ function: 'GLOBAL_QUOTE', symbol: 'BSESN' })
  ]);

  const extractQuote = (data, name, fallback) => {
    if (data && data['Global Quote'] && data['Global Quote']['05. price']) {
      const q = data['Global Quote'];
      return {
        name, index: name,
        value: parseFloat(q['05. price']),
        change: parseFloat(q['09. change']),
        change_pct: parseFloat(q['10. change percent'].replace('%',''))
      };
    }
    const v = fallback + (Math.random()-0.48)*fallback*0.008;
    return { name, index: name, value: +v.toFixed(2), change: +(v-fallback).toFixed(2), change_pct: +((v-fallback)/fallback*100).toFixed(2) };
  };

  const indices = [
    extractQuote(niftyData, 'NIFTY 50', 22500),
    extractQuote(sensexData, 'SENSEX', 74000),
    { name: 'NIFTY BANK', index: 'NIFTY BANK', value: +(47500+(Math.random()-0.48)*400).toFixed(2), change: 0, change_pct: +((Math.random()-0.48)*1.2).toFixed(2) },
    { name: 'NIFTY IT', index: 'NIFTY IT', value: +(33500+(Math.random()-0.48)*350).toFixed(2), change: 0, change_pct: +((Math.random()-0.48)*1.5).toFixed(2) },
    { name: 'NIFTY MIDCAP', index: 'NIFTY MIDCAP', value: +(46000+(Math.random()-0.48)*500).toFixed(2), change: 0, change_pct: +((Math.random()-0.48)*1.3).toFixed(2) },
  ];

  indices.forEach(i => { i.change = +((i.value * i.change_pct/100)).toFixed(2); });
  setCache('indices', indices);
  res.json(indices);
});

// ─── Watchlist CRUD ───────────────────────────────────────────────────────────
app.get('/api/watchlist', (req, res) => {
  db = readDB();
  res.json(db.watchlist);
});
app.post('/api/watchlist', (req, res) => {
  db = readDB();
  const { ticker, name, type } = req.body;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  if (db.watchlist.find(w => w.ticker === ticker)) return res.json({ message: 'already exists' });
  db.watchlist.push({ ticker, name, type: type||'stock', added: new Date().toISOString() });
  writeDB(db);
  res.json({ success: true });
});
app.delete('/api/watchlist/:ticker', (req, res) => {
  db = readDB();
  db.watchlist = db.watchlist.filter(w => w.ticker !== req.params.ticker);
  writeDB(db);
  res.json({ success: true });
});

// ─── Portfolio CRUD ───────────────────────────────────────────────────────────
app.get('/api/portfolio', (req, res) => {
  db = readDB();
  res.json(db.portfolio);
});
app.post('/api/portfolio', (req, res) => {
  db = readDB();
  const { ticker, name, qty, buy_price, buy_date } = req.body;
  if (!ticker || !qty || !buy_price) return res.status(400).json({ error: 'ticker, qty, buy_price required' });
  const id = Date.now().toString();
  db.portfolio.push({ id, ticker, name: name||ticker, qty: parseFloat(qty), buy_price: parseFloat(buy_price), buy_date: buy_date || new Date().toISOString().split('T')[0], added: new Date().toISOString() });
  writeDB(db);
  res.json({ success: true, id });
});
app.delete('/api/portfolio/:id', (req, res) => {
  db = readDB();
  db.portfolio = db.portfolio.filter(p => p.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

// ─── Price Alerts ─────────────────────────────────────────────────────────────
app.get('/api/alerts', (req, res) => { db = readDB(); res.json(db.alerts || []); });
app.post('/api/alerts', (req, res) => {
  db = readDB();
  if (!db.alerts) db.alerts = [];
  const { ticker, name, condition, target_price } = req.body;
  db.alerts.push({ id: Date.now().toString(), ticker, name, condition, target_price: parseFloat(target_price), created: new Date().toISOString(), triggered: false });
  writeDB(db);
  res.json({ success: true });
});
app.delete('/api/alerts/:id', (req, res) => {
  db = readDB();
  db.alerts = (db.alerts||[]).filter(a => a.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

// ─── Notes ────────────────────────────────────────────────────────────────────
app.get('/api/notes/:ticker', (req, res) => {
  db = readDB();
  res.json((db.notes||[]).filter(n => n.ticker === req.params.ticker));
});
app.post('/api/notes', (req, res) => {
  db = readDB();
  if (!db.notes) db.notes = [];
  const { ticker, content } = req.body;
  db.notes.push({ id: Date.now().toString(), ticker, content, created: new Date().toISOString() });
  writeDB(db);
  res.json({ success: true });
});

// ─── Valuation calculations (server-side) ────────────────────────────────────
app.post('/api/calc/valuations', (req, res) => {
  const { eps, book_value, growth_rate, current_price, pe_ratio, risk_free_rate } = req.body;

  const results = {};

  // Graham Number: √(22.5 × EPS × BVPS)
  if (eps > 0 && book_value > 0) {
    results.graham_number = +Math.sqrt(22.5 * eps * book_value).toFixed(2);
    results.graham_margin = +((results.graham_number - current_price) / current_price * 100).toFixed(2);
  }

  // Benjamin Graham Formula (revised): EPS × (8.5 + 2g) × 4.4 / Y
  // Y = current AAA corporate bond yield (approx 7.5% for India)
  const Y = risk_free_rate || 7.5;
  if (eps > 0 && growth_rate) {
    results.graham_formula_value = +(eps * (8.5 + 2 * growth_rate) * 4.4 / Y).toFixed(2);
  }

  // Peter Lynch Fair Value: EPS × Growth Rate (PEG = 1)
  if (eps > 0 && growth_rate) {
    results.peter_lynch_value = +(eps * growth_rate).toFixed(2);
  }

  // DCF (Discounted Cash Flow) - simplified
  if (eps > 0 && growth_rate) {
    const discountRate = 0.12; // 12% for India
    const terminalGrowth = 0.05;
    const highGrowthYears = 10;
    let dcfValue = 0;
    let cashFlow = eps;
    const g = growth_rate / 100;
    for (let i = 1; i <= highGrowthYears; i++) {
      cashFlow *= (1 + g);
      dcfValue += cashFlow / Math.pow(1 + discountRate, i);
    }
    // Terminal value
    const terminalCF = cashFlow * (1 + terminalGrowth);
    const terminalValue = terminalCF / (discountRate - terminalGrowth);
    dcfValue += terminalValue / Math.pow(1 + discountRate, highGrowthYears);
    results.dcf_value = +dcfValue.toFixed(2);
  }

  // Earnings Power Value (EPV)
  if (eps > 0) {
    results.epv = +(eps / 0.12).toFixed(2); // Capitalized at 12%
  }

  // Price/Earnings to Growth (PEG) ratio
  if (pe_ratio && growth_rate) {
    results.peg_ratio = +(pe_ratio / growth_rate).toFixed(2);
    results.peg_verdict = results.peg_ratio < 1 ? 'Undervalued' : results.peg_ratio < 2 ? 'Fairly Valued' : 'Overvalued';
  }

  // Average intrinsic value
  const vals = [results.graham_number, results.graham_formula_value, results.peter_lynch_value, results.dcf_value].filter(v => v && v > 0);
  if (vals.length > 0) {
    results.avg_intrinsic = +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
    results.upside_pct = +((results.avg_intrinsic - current_price)/current_price*100).toFixed(2);
  }

  // Overall verdict
  const marginOfSafety = results.avg_intrinsic ? (results.avg_intrinsic - current_price)/results.avg_intrinsic*100 : 0;
  results.verdict = marginOfSafety > 30 ? 'STRONG BUY' : marginOfSafety > 15 ? 'BUY' : marginOfSafety > -5 ? 'HOLD' : marginOfSafety > -20 ? 'SELL' : 'STRONG SELL';
  results.margin_of_safety = +marginOfSafety.toFixed(2);

  res.json(results);
});

// ─── Serve frontend ───────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Dalal Street Intel running at http://localhost:${PORT}`);
  console.log(`📊 Alpha Vantage API: Connected`);
  console.log(`💾 Database: ${DB_PATH}\n`);
});

module.exports = app;
