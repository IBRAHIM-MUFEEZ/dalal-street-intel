const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { ETFS, BONDS } = require('./etf-bonds-data');

// ─── Yahoo Finance (free, real NSE/BSE data, no subscription needed) ──────────
const YahooFinanceModule = require('yahoo-finance2');
const YahooFinanceClass  = YahooFinanceModule.default || YahooFinanceModule;
const yf = typeof YahooFinanceClass === 'function'
  ? new YahooFinanceClass({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })
  : YahooFinanceClass;

// NSE ticker map: our symbol → Yahoo Finance symbol
const YF_SYMBOL_MAP = {
  // Stocks (NSE)
  RELIANCE:'RELIANCE.NS', TCS:'TCS.NS', HDFCBANK:'HDFCBANK.NS', INFY:'INFY.NS',
  ICICIBANK:'ICICIBANK.NS', HINDUNILVR:'HINDUNILVR.NS', ITC:'ITC.NS', SBIN:'SBIN.NS',
  BHARTIARTL:'BHARTIARTL.NS', KOTAKBANK:'KOTAKBANK.NS', LT:'LT.NS', AXISBANK:'AXISBANK.NS',
  BAJFINANCE:'BAJFINANCE.NS', ASIANPAINT:'ASIANPAINT.NS', MARUTI:'MARUTI.NS',
  WIPRO:'WIPRO.NS', HCLTECH:'HCLTECH.NS', SUNPHARMA:'SUNPHARMA.NS', TITAN:'TITAN.NS',
  TATAMOTORS:'TATAMOTORS.NS', TATASTEEL:'TATASTEEL.NS', NTPC:'NTPC.NS',
  ADANIENT:'ADANIENT.NS', ONGC:'ONGC.NS', ZOMATO:'ZOMATO.NS', IRCTC:'IRCTC.NS',
  HAL:'HAL.NS', BEL:'BEL.NS', CIPLA:'CIPLA.NS', DLF:'DLF.NS', COALINDIA:'COALINDIA.NS',
  // ETFs (NSE)
  NIFTYBEES:'NIFTYBEES.NS', JUNIORBEES:'JUNIORBEES.NS', MOM100:'MOM100.NS',
  SETFNIF50:'SETFNIF50.NS', ICICIB22:'ICICIB22.NS', BANKBEES:'BANKBEES.NS',
  ITBEES:'ITBEES.NS', PHARMABEES:'PHARMABEES.NS', GOLDBEES:'GOLDBEES.NS',
  HDFCMFGETF:'HDFCMFGETF.NS', MAFANG:'MAFANG.NS', N100:'N100.NS',
  // Indices
  'NIFTY50':'^NSEI', 'SENSEX':'^BSESN', 'BANKNIFTY':'^NSEBANK',
  'NIFTYIT':'NIFTYIT.NS', 'NIFTYMIDCAP100':'NIFTYMIDCAP100.NS',
};

// Yahoo Finance live quote helper
async function yfQuote(ticker) {
  const yfSym = YF_SYMBOL_MAP[ticker] || (ticker + '.NS');
  try {
    const q = await yf.quote(yfSym);
    if (!q || !q.regularMarketPrice) return null;
    return {
      ticker,
      price:        q.regularMarketPrice,
      change:       q.regularMarketChange || 0,
      change_pct:   q.regularMarketChangePercent || 0,
      open:         q.regularMarketOpen,
      high:         q.regularMarketDayHigh,
      low:          q.regularMarketDayLow,
      prev_close:   q.regularMarketPreviousClose,
      volume:       q.regularMarketVolume || 0,
      week_52_high: q.fiftyTwoWeekHigh,
      week_52_low:  q.fiftyTwoWeekLow,
      market_cap:   q.marketCap,
      latest_day:   new Date().toISOString().split('T')[0],
      source:       'yahoo_finance_live'
    };
  } catch(e) { return null; }
}

// Yahoo Finance historical candles helper
async function yfHistory(ticker, period1, period2) {
  const yfSym = YF_SYMBOL_MAP[ticker] || (ticker + '.NS');
  try {
    const data = await yf.chart(yfSym, {
      period1, period2, interval: '1d'
    });
    if (!data || !data.quotes || !data.quotes.length) return null;
    return data.quotes
      .filter(q => q.close != null)
      .map(q => ({
        date:   new Date(q.date).toISOString().split('T')[0],
        open:   +q.open?.toFixed(2),
        high:   +q.high?.toFixed(2),
        low:    +q.low?.toFixed(2),
        close:  +q.close?.toFixed(2),
        volume: q.volume || 0
      }));
  } catch(e) { return null; }
}

const app = express();
const PORT = 3000;

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

// ─── Cache helper ─────────────────────────────────────────────────────────────
function getCache(key, ttlMs) {
  const entry = db.cache[key];
  if (!entry) return null;
  const ttl = ttlMs || (key.startsWith('fund_') ? 60 * 60 * 1000 : 15 * 60 * 1000);
  if (Date.now() - entry.ts > ttl) return null;
  return entry.data;
}
function setCache(key, data) {
  db.cache[key] = { ts: Date.now(), data };
  try { writeDB(db); } catch(e) {}
}

// ─── Indian Stocks Master List ────────────────────────────────────────────────
const INDIAN_STOCKS = require('./stocks-data');
const MUTUAL_FUNDS  = require('./mf-data');

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  data_source: 'yahoo_finance_live',
  yahoo_finance: 'active — real NSE/BSE data, free, no subscription needed'
}));

// ─── Search ───────────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();

  // Return all if no query (for screener)
  if (!q) {
    const allStocks = INDIAN_STOCKS.map(s => ({ ...s, type: 'stock' }));
    const allMFs = MUTUAL_FUNDS.map(m => ({ ...m, type: 'mf' }));
    const allETFs = ETFS.map(e => ({ ...e, type: 'etf' }));
    const allBonds = BONDS.map(b => ({ ...b, type: 'bond' }));
    return res.json([...allStocks, ...allMFs, ...allETFs, ...allBonds]);
  }

  const stocks = INDIAN_STOCKS.filter(s =>
    s.ticker.toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q) ||
    (s.sector && s.sector.toLowerCase().includes(q))
  ).slice(0, 8).map(s => ({ ...s, type: 'stock' }));

  const mfs = MUTUAL_FUNDS.filter(m =>
    m.ticker.toLowerCase().includes(q) ||
    m.name.toLowerCase().includes(q) ||
    (m.category && m.category.toLowerCase().includes(q)) ||
    (m.amc && m.amc.toLowerCase().includes(q))
  ).slice(0, 5).map(m => ({ ...m, type: 'mf' }));

  const etfs = ETFS.filter(e =>
    e.ticker.toLowerCase().includes(q) ||
    e.name.toLowerCase().includes(q) ||
    (e.category && e.category.toLowerCase().includes(q))
  ).slice(0, 4).map(e => ({ ...e, type: 'etf' }));

  const bonds = BONDS.filter(b =>
    b.ticker.toLowerCase().includes(q) ||
    b.name.toLowerCase().includes(q) ||
    (b.category && b.category.toLowerCase().includes(q))
  ).slice(0, 3).map(b => ({ ...b, type: 'bond' }));

  res.json([...stocks, ...mfs, ...etfs, ...bonds]);
});

// ─── Quote (Yahoo Finance live → static fallback) ────────────────────────────
app.get('/api/quote/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const cacheKey = `quote_${ticker}`;
  const cached = getCache(cacheKey, 60 * 1000); // 1-min cache
  if (cached) return res.json(cached);

  // Bond — static only
  const bond = BONDS.find(b => b.ticker === ticker);
  if (bond) {
    const quote = { ticker, price: bond.min_investment, change: 0, change_pct: 0,
      yield: bond.yield_to_maturity, coupon: bond.coupon_rate,
      latest_day: new Date().toISOString().split('T')[0], source: 'static' };
    setCache(cacheKey, quote); return res.json(quote);
  }

  // Yahoo Finance live (stocks + ETFs + indices)
  const liveQuote = await yfQuote(ticker);
  if (liveQuote) { setCache(cacheKey, liveQuote); return res.json(liveQuote); }

  // Static fallback
  const stock = INDIAN_STOCKS.find(s => s.ticker === ticker);
  const etf   = ETFS.find(e => e.ticker === ticker);
  const base  = stock ? stock.base_price : (etf ? etf.nav : null);
  if (base) {
    const variance = (Math.random() - 0.48) * base * 0.015;
    const quote = {
      ticker, price: +(base + variance).toFixed(2), change: +variance.toFixed(2),
      change_pct: +((variance / base) * 100).toFixed(2),
      open: +(base * (1 + (Math.random()-0.5)*0.01)).toFixed(2),
      high: +(base * (1 + Math.random()*0.015)).toFixed(2),
      low:  +(base * (1 - Math.random()*0.015)).toFixed(2),
      prev_close: +base.toFixed(2), volume: Math.floor(Math.random()*5000000+500000),
      latest_day: new Date().toISOString().split('T')[0], source: 'static_fallback'
    };
    setCache(cacheKey, quote); return res.json(quote);
  }
  res.json({ error: 'Quote not found', ticker });
});

// ─── Historical Data (Yahoo Finance → synthetic fallback) ────────────────────
app.get('/api/history/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const period = req.query.period || '3m';
  const cacheKey = `hist_${ticker}_${period}`;
  const cached = getCache(cacheKey, 30 * 60 * 1000);
  if (cached) return res.json(cached);

  const days = period === '1m' ? 30 : period === '3m' ? 90 : period === '6m' ? 180 : 365;
  const now = new Date();
  const startDate = new Date(now); startDate.setDate(startDate.getDate() - days);
  const period1 = startDate.toISOString().split('T')[0];
  const period2 = now.toISOString().split('T')[0];

  let history = await yfHistory(ticker, period1, period2);

  // Synthetic fallback
  if (!history || !history.length) {
    const stock = INDIAN_STOCKS.find(s => s.ticker === ticker);
    const etf   = ETFS.find(e => e.ticker === ticker);
    const base  = stock ? stock.base_price : (etf ? etf.nav : 1000);
    history = [];
    let price = base * 0.85;
    for (let i = days; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const chg = (Math.random() - 0.47) * price * 0.018;
      price = Math.max(price + chg, base * 0.3);
      history.push({
        date:   d.toISOString().split('T')[0],
        open:   +(price * (1 - Math.random()*0.005)).toFixed(2),
        high:   +(price * (1 + Math.random()*0.01)).toFixed(2),
        low:    +(price * (1 - Math.random()*0.01)).toFixed(2),
        close:  +price.toFixed(2),
        volume: Math.floor(Math.random()*3000000 + 200000)
      });
    }
  }

  setCache(cacheKey, history);
  res.json(history);
});

// ─── Fundamentals (static DB + live 52w/market cap from Yahoo Finance) ───────
app.get('/api/fundamentals/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const cacheKey = `fund_${ticker}`;
  const cached = getCache(cacheKey, 60 * 60 * 1000);
  if (cached) return res.json(cached);

  // ETF
  const etf = ETFS.find(e => e.ticker === ticker);
  if (etf) {
    const fundamentals = {
      nav: etf.nav, aum_cr: etf.aum_cr, expense_ratio: etf.expense_ratio,
      returns_1y: etf.returns_1y, returns_3y: etf.returns_3y, returns_5y: etf.returns_5y,
      tracking_error: etf.tracking_error, liquidity: etf.liquidity,
      benchmark: etf.benchmark, category: etf.category, amc: etf.amc,
      description: etf.description, exchange: etf.exchange, source: 'static'
    };
    setCache(cacheKey, fundamentals);
    return res.json(fundamentals);
  }

  // Bond
  const bond = BONDS.find(b => b.ticker === ticker);
  if (bond) {
    const fundamentals = {
      coupon_rate: bond.coupon_rate, yield_to_maturity: bond.yield_to_maturity,
      maturity: bond.maturity, credit_rating: bond.credit_rating,
      min_investment: bond.min_investment, liquidity: bond.liquidity,
      returns_1y: bond.returns_1y, returns_3y: bond.returns_3y,
      category: bond.category, issuer: bond.issuer,
      description: bond.description, source: 'static'
    };
    setCache(cacheKey, fundamentals);
    return res.json(fundamentals);
  }

  // Stock — use static fundamentals, enrich with live Yahoo Finance data
  const stock = INDIAN_STOCKS.find(s => s.ticker === ticker);
  let fundamentals = null;
  if (stock && stock.fundamentals) {
    fundamentals = { ...stock.fundamentals, source: 'static' };
    // Enrich with live 52w range and market cap from Yahoo Finance
    const liveQ = await yfQuote(ticker);
    if (liveQ) {
      if (liveQ.week_52_high) fundamentals['52w_high'] = liveQ.week_52_high;
      if (liveQ.week_52_low)  fundamentals['52w_low']  = liveQ.week_52_low;
      if (liveQ.market_cap)   fundamentals.market_cap  = liveQ.market_cap;
      fundamentals.source = 'static+yahoo_live';
    }
  }

  if (fundamentals) setCache(cacheKey, fundamentals);
  res.json(fundamentals || { error: 'Fundamentals not found' });
});

// ─── Top Gainers / Losers (Yahoo Finance live → static fallback) ─────────────
app.get('/api/market/movers', async (req, res) => {
  const top25 = INDIAN_STOCKS.slice(0, 25);
  const movers = [];

  // Fetch live quotes in parallel batches of 5 (Yahoo Finance rate-friendly)
  const batchSize = 5;
  for (let i = 0; i < top25.length; i += batchSize) {
    const batch = top25.slice(i, i + batchSize);
    const quotes = await Promise.all(batch.map(s => yfQuote(s.ticker)));
    batch.forEach((s, j) => {
      const q = quotes[j];
      if (q && q.price) {
        movers.push({ ticker: s.ticker, name: s.name, sector: s.sector,
          price: +q.price.toFixed(2), change_pct: +q.change_pct.toFixed(2), source: 'yahoo_live' });
      } else {
        const chg = (Math.random() - 0.45) * s.base_price * 0.04;
        movers.push({ ticker: s.ticker, name: s.name, sector: s.sector,
          price: +(s.base_price + chg).toFixed(2),
          change_pct: +((chg / s.base_price) * 100).toFixed(2), source: 'static_fallback' });
      }
    });
  }

  movers.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
  res.json({
    gainers: movers.filter(m => m.change_pct > 0).slice(0, 5),
    losers:  movers.filter(m => m.change_pct < 0).slice(0, 5)
  });
});

// ─── Top 10 Picks (Expert-curated, scored by fundamentals) ───────────────────
app.get('/api/market/top10', (req, res) => {
  const cacheKey = 'top10';
  const cached = getCache(cacheKey, 60 * 60 * 1000);
  if (cached) return res.json(cached);

  // Score stocks using multi-factor model (Buffett + Graham + Lynch criteria)
  function scoreStock(s) {
    const f = s.fundamentals || {};
    let score = 0;
    // Quality (ROE > 15% = Buffett criterion)
    if (f.roe >= 20) score += 25; else if (f.roe >= 15) score += 18; else if (f.roe >= 10) score += 10;
    // Value (P/E < 25 = reasonable)
    if (f.pe_ratio > 0 && f.pe_ratio < 15) score += 25; else if (f.pe_ratio < 25) score += 18; else if (f.pe_ratio < 35) score += 10;
    // Growth (earnings growth > 15%)
    if (f.earnings_growth >= 20) score += 20; else if (f.earnings_growth >= 12) score += 14; else if (f.earnings_growth >= 8) score += 8;
    // Safety (low debt)
    if (f.debt_to_equity <= 0.3) score += 15; else if (f.debt_to_equity <= 1) score += 10; else if (f.debt_to_equity <= 2) score += 5;
    // Dividend (income)
    if (f.dividend_yield >= 2) score += 10; else if (f.dividend_yield >= 1) score += 6; else if (f.dividend_yield > 0) score += 3;
    // Margin of safety (Graham Number vs price)
    if (f.eps > 0 && f.book_value > 0) {
      const graham = Math.sqrt(22.5 * f.eps * f.book_value);
      const mos = (graham - s.base_price) / s.base_price * 100;
      if (mos > 30) score += 5; else if (mos > 10) score += 3;
    }
    return score;
  }

  const scoredStocks = INDIAN_STOCKS.map(s => ({
    ...s, type: 'stock',
    score: scoreStock(s),
    price: s.base_price,
    change_pct: +((Math.random() - 0.48) * 3).toFixed(2)
  })).sort((a, b) => b.score - a.score).slice(0, 10);

  // Top 10 MFs by 3Y CAGR + rating + low expense
  const scoredMFs = MUTUAL_FUNDS.map(m => ({
    ...m, type: 'mf',
    score: (m.returns_3y * 2) + (m.rating * 5) - (m.expense_ratio * 10),
    price: m.nav,
    change_pct: +((Math.random() - 0.48) * 1.5).toFixed(2)
  })).sort((a, b) => b.score - a.score).slice(0, 10);

  // Top 10 ETFs by returns + low expense + liquidity
  const liquidityScore = { 'Very High': 5, 'High': 4, 'Medium': 3, 'Low': 1 };
  const scoredETFs = ETFS.map(e => ({
    ...e, type: 'etf',
    score: (e.returns_3y * 1.5) + (e.rating * 4) - (e.expense_ratio * 20) + (liquidityScore[e.liquidity] || 2),
    price: e.nav,
    change_pct: +((Math.random() - 0.48) * 1.2).toFixed(2)
  })).sort((a, b) => b.score - a.score).slice(0, 10);

  // Top 10 Bonds by yield + safety
  const riskScore = { 'Very Low': 5, 'Low': 4, 'Low-Medium': 3, 'Medium': 2 };
  const scoredBonds = BONDS.map(b => ({
    ...b, type: 'bond',
    score: (b.yield_to_maturity * 8) + (riskScore[b.risk] || 2) * 5,
    price: b.min_investment,
    change_pct: 0
  })).sort((a, b) => b.score - a.score).slice(0, 10);

  const result = {
    stocks: scoredStocks,
    mutual_funds: scoredMFs,
    etfs: scoredETFs,
    bonds: scoredBonds,
    generated_at: new Date().toISOString(),
    methodology: 'Multi-factor scoring: ROE (Buffett), P/E (Graham), Earnings Growth (Lynch), Debt Safety, Dividend Yield, Margin of Safety'
  };

  setCache(cacheKey, result);
  res.json(result);
});

// ─── Nifty Index snapshot (Yahoo Finance live → static fallback) ─────────────
app.get('/api/market/indices', async (req, res) => {
  const cacheKey = 'indices';
  const cached = getCache(cacheKey, 60 * 1000); // 1-min cache
  if (cached) return res.json(cached);

  const INDEX_DEFS = [
    { name: 'NIFTY 50',     yfSym: '^NSEI',    fallback: 22500 },
    { name: 'SENSEX',       yfSym: '^BSESN',   fallback: 74000 },
    { name: 'NIFTY BANK',   yfSym: '^NSEBANK', fallback: 47500 },
    { name: 'NIFTY IT',     yfSym: 'NIFTYIT.NS', fallback: 33500 },
    { name: 'NIFTY MIDCAP', yfSym: 'NIFTYMIDCAP100.NS', fallback: 46000 },
  ];

  const quotes = await Promise.all(INDEX_DEFS.map(async def => {
    try {
      const q = await yf.quote(def.yfSym);
      if (q && q.regularMarketPrice) {
        return {
          name: def.name, index: def.name,
          value: +q.regularMarketPrice.toFixed(2),
          change: +(q.regularMarketChange || 0).toFixed(2),
          change_pct: +(q.regularMarketChangePercent || 0).toFixed(2),
          source: 'yahoo_live'
        };
      }
    } catch(e) {}
    const v = def.fallback + (Math.random()-0.48)*def.fallback*0.008;
    return { name: def.name, index: def.name, value: +v.toFixed(2),
      change: +(v-def.fallback).toFixed(2), change_pct: +((v-def.fallback)/def.fallback*100).toFixed(2), source: 'static_fallback' };
  }));

  setCache('indices', quotes);
  res.json(quotes);
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

// ─── Quant Engines ───────────────────────────────────────────────────────────
const Q = require('./quant-engines');

// ─── Shared candle builder (Yahoo Finance live → synthetic fallback) ──────────
async function buildCandles(ticker) {
  const histKey = `hist_${ticker}_1y`;
  let candles = getCache(histKey, 30 * 60 * 1000);
  if (candles) return candles;

  const now = new Date();
  const startDate = new Date(now); startDate.setDate(startDate.getDate() - 365);
  const period1 = startDate.toISOString().split('T')[0];
  const period2 = now.toISOString().split('T')[0];

  candles = await yfHistory(ticker, period1, period2);

  if (!candles || !candles.length) {
    // Synthetic fallback
    const stock = INDIAN_STOCKS.find(s => s.ticker === ticker);
    const etf   = ETFS.find(e => e.ticker === ticker);
    const base  = stock ? stock.base_price : (etf ? etf.nav : 1000);
    candles = [];
    let price = base * 0.82;
    for (let i = 365; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const chg = (Math.random() - 0.47) * price * 0.018;
      price = Math.max(price + chg, base * 0.3);
      candles.push({
        date:   d.toISOString().split('T')[0],
        open:   +(price * (1 - Math.random()*0.005)).toFixed(2),
        high:   +(price * (1 + Math.random()*0.012)).toFixed(2),
        low:    +(price * (1 - Math.random()*0.012)).toFixed(2),
        close:  +price.toFixed(2),
        volume: Math.floor(Math.random()*3000000 + 200000)
      });
    }
  }
  setCache(histKey, candles);
  return candles;
}

// ─── /api/quant/analyze/:ticker — Full 30-formula hybrid signal ───────────────
app.get('/api/quant/analyze/:ticker', async (req, res) => {
  const { ticker }  = req.params;
  const headlines   = (req.query.news || '').split('|').filter(Boolean);
  const cacheKey    = `hybrid_${ticker}`;
  const cached      = getCache(cacheKey, 3 * 60 * 1000);
  if (cached) return res.json(cached);

  const candles = await buildCandles(ticker);

  // Live price overlay from Yahoo Finance
  let livePrice = null;
  const liveQ = await yfQuote(ticker);
  if (liveQ && liveQ.price) livePrice = liveQ.price;

  const result = Q.analyzeSymbol(candles, ticker, livePrice, headlines);
  if (!result) return res.json({ error: 'Insufficient data' });

  result.candles = candles.slice(-120);
  setCache(cacheKey, result);
  res.json(result);
});

// ─── /api/quant/batch — Analyze multiple symbols (top 10 ranking) ─────────────
app.post('/api/quant/batch', async (req, res) => {
  const { symbols } = req.body;
  if (!symbols || !Array.isArray(symbols)) return res.status(400).json({ error: 'symbols array required' });

  const results = [];
  for (const ticker of symbols.slice(0, 30)) {
    const cacheKey = `hybrid_${ticker}`;
    let result = getCache(cacheKey, 3 * 60 * 1000);
    if (!result) {
      const candles = await buildCandles(ticker);
      result = Q.analyzeSymbol(candles, ticker, null, []);
      if (result) {
        const slim = { ...result };
        delete slim.candles; delete slim.returns;
        setCache(cacheKey, slim);
        result = slim;
      }
    }
    if (result) {
      const r = { ...result }; delete r.candles; delete r.returns;
      results.push(r);
    }
  }
  results.sort((a, b) => b.score - a.score);
  res.json(results);
});

// ─── /api/quant/options — Black-Scholes pricing + Greeks ─────────────────────
app.post('/api/quant/options', (req, res) => {
  const { S, K, T_days, r, sigma, type='call', q=0 } = req.body;
  if (!S||!K||!T_days||!sigma) return res.status(400).json({ error: 'S, K, T_days, sigma required' });
  const T = T_days/365;
  const price = Q.bsPrice(S,K,T,r||0.065,sigma,type,q);
  const greeks = Q.bsGreeks(S,K,T,r||0.065,sigma,type,q);
  const intrinsic = Math.max(0, type==='call'?S-K:K-S);
  const timeValue = Math.max(0, price-intrinsic);
  const breakeven = type==='call'?S+price:S-price;
  const moneyness = (type==='call'&&S>K)||(type==='put'&&S<K)?'ITM':Math.abs(S-K)/K<0.01?'ATM':'OTM';
  const curve = Q.ivCurve(S,K,T,r||0.065,type,q);
  res.json({ price:+price.toFixed(4), intrinsic:+intrinsic.toFixed(4),
    timeValue:+timeValue.toFixed(4), breakeven:+breakeven.toFixed(2),
    moneyness, greeks, ivCurve:curve });
});

// ─── /api/quant/payoff — Options strategy payoff diagram ─────────────────────
app.post('/api/quant/payoff', (req, res) => {
  const { strategy, S, K1, K2, prem } = req.body;
  if (!strategy||!S||!K1) return res.status(400).json({ error: 'strategy, S, K1 required' });
  const data = Q.payoffData(strategy, S, K1||S, K2||S*1.05, prem||0);
  res.json(data);
});

// ─── /api/quant/dcf — Three-stage DCF + CAPM + WACC ─────────────────────────
app.post('/api/quant/dcf', (req, res) => {
  const { fcfe0, g_high, g_stable, n_high=5, n_trans=5, rf=0.07, beta=1.2,
          erp=0.055, E_val, D_val, kd=0.08, tax_rate=0.25, shares, cmp } = req.body;
  if (!fcfe0||!g_high) return res.status(400).json({ error: 'fcfe0, g_high required' });
  const ke = Q.capmKe(rf, beta, erp);
  const E = E_val||50000, D = D_val||10000;
  let wacc = Q.calcWACC(E, D, ke, kd, tax_rate);
  let gStable = g_stable||0.06;
  if (gStable >= wacc) gStable = wacc - 0.01;
  const dcf = Q.dcfThreeStage(fcfe0, g_high, gStable, n_high, n_trans, wacc);
  const ivps = shares ? dcf.totalPV*100/shares : null;
  const mos  = ivps && cmp ? (ivps-cmp)/cmp*100 : null;
  const verdict = mos==null?null : mos>30?'STRONG BUY':mos>15?'BUY':mos>-10?'HOLD':'AVOID';
  res.json({ ke:+ke.toFixed(4), wacc:+wacc.toFixed(4), ...dcf,
    ivps:ivps?+ivps.toFixed(2):null, mos:mos?+mos.toFixed(2):null, verdict });
});

// ─── /api/quant/mpt — Efficient Frontier ─────────────────────────────────────
app.post('/api/quant/mpt', async (req, res) => {
  const { symbols, n_sim=2000, rf=0.065 } = req.body;
  if (!symbols||symbols.length<2) return res.status(400).json({ error: 'At least 2 symbols required' });

  const returnsMatrix = [];
  const validSymbols  = [];
  for (const ticker of symbols.slice(0,8)) {
    const candles = await buildCandles(ticker);
    const closes  = candles.map(c => c.close);
    const rets    = Q.pctChange(closes);
    if (rets.length > 50) { returnsMatrix.push(rets); validSymbols.push(ticker); }
  }
  if (validSymbols.length < 2) return res.status(400).json({ error: 'Insufficient data for MPT' });
  const frontier = Q.efficientFrontier(returnsMatrix, validSymbols, n_sim, rf);
  const step = Math.max(1, Math.floor(frontier.portfolios.length/500));
  frontier.portfolios = frontier.portfolios.filter((_,i) => i%step===0);
  res.json(frontier);
});

// ─── /api/quant/var — Value at Risk ──────────────────────────────────────────
app.post('/api/quant/var', async (req, res) => {
  const { ticker, portfolio_value=1000000, confidence=0.95, horizon=1 } = req.body;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  const candles = await buildCandles(ticker);
  const closes  = candles.map(c => c.close);
  const rets    = Q.pctChange(closes);
  if (rets.length < 30) return res.status(400).json({ error: 'Insufficient data' });

  const vc = Q.varVC(rets, confidence, horizon);
  const hs = Q.varHS(rets, confidence, horizon);
  const mc = Q.varMC(rets, confidence, horizon);
  const rolling = Q.rollingVaR(rets, 60, confidence);

  res.json({
    ticker, confidence, horizon, portfolio_value,
    var_vc:  { pct:+(vc*100).toFixed(4), amount:+(vc*portfolio_value).toFixed(0) },
    var_hs:  { pct:+(hs*100).toFixed(4), amount:+(hs*portfolio_value).toFixed(0) },
    var_mc:  { pct:+(mc*100).toFixed(4), amount:+(mc*portfolio_value).toFixed(0) },
    rolling_var: rolling,
    return_distribution: rets.map(r => +(r*100).toFixed(4))
  });
});

// ─── /api/quant/tax — Tax calculation ────────────────────────────────────────
app.post('/api/quant/tax', (req, res) => {
  const { asset='listed_equity', buy_price, sell_price, qty, hold_days, slab=30 } = req.body;
  if (!buy_price||!sell_price||!qty) return res.status(400).json({ error: 'buy_price, sell_price, qty required' });
  res.json(Q.calcTax(asset, buy_price, sell_price, qty, hold_days||400, slab));
});

app.post('/api/quant/tax/harvest', (req, res) => {
  const { realised_gain, unrealised_loss } = req.body;
  res.json(Q.taxHarvesting(realised_gain||0, unrealised_loss||0));
});

// ─── /api/quant/mf — Mutual fund NAV from MFAPI ──────────────────────────────
app.get('/api/quant/mf/:scheme_code', async (req, res) => {
  const { scheme_code } = req.params;
  const cacheKey = `mf_${scheme_code}`;
  const cached = getCache(cacheKey, 60*60*1000);
  if (cached) return res.json(cached);
  try {
    const r = await axios.get(`https://api.mfapi.in/mf/${scheme_code}`, { timeout: 10000 });
    const dat = r.data;
    const rows = (dat.data||[]).map(d=>({
      date: d.date, nav: parseFloat(d.nav)||0
    })).filter(d=>d.nav>0).reverse(); // oldest first
    if (!rows.length) return res.json({ error: 'No NAV data' });
    const navs = rows.map(d=>d.nav);
    const latest = navs[navs.length-1];
    const prev   = navs[navs.length-2]||latest;
    const ret = (d) => navs.length>=d ? +((latest-navs[navs.length-d])/navs[navs.length-d]*100).toFixed(2) : null;
    const rets = Q.pctChange(navs);
    const r1m=ret(21),r3m=ret(63),r6m=ret(126),r1y=ret(252);
    const sc = Math.min(100,
      Math.min(40,Math.max(0,(r1y||0)*2))+
      Math.min(30,Math.max(0,(r6m||0)*3))+
      Math.min(20,Math.max(0,(r3m||0)*4))+
      ((r1m||0)>0?10:0));
    const signal = sc>=65?'STRONG BUY':sc>=45?'BUY':sc>=30?'HOLD':'AVOID';
    const result = {
      scheme_code, name: dat.meta?.scheme_name||'',
      fund_house: dat.meta?.fund_house||'',
      nav: +latest.toFixed(4),
      change_pct: +((latest-prev)/prev*100).toFixed(2),
      return_1m:r1m, return_3m:r3m, return_6m:r6m, return_1y:r1y,
      score:+sc.toFixed(2), signal,
      sharpe: Q.calcSharpe(rets), sortino: Q.calcSortino(rets),
      vol_ann: +(Math.sqrt(rets.reduce((a,b)=>a+(b-(rets.reduce((x,y)=>x+y,0)/rets.length))**2,0)/rets.length)*Math.sqrt(252)*100).toFixed(2),
      history: rows.slice(-365) // last 1 year for chart
    };
    setCache(cacheKey, result);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: 'MFAPI fetch failed', detail: e.message });
  }
});

// ─── /api/quant/formulas — Full formula reference ─────────────────────────────
app.get('/api/quant/formulas', (req, res) => {
  res.json([
    // Original 30
    { id:'F1',  name:'Percentage Return',          formula:'Rt = (Pt - Pt-1) / Pt-1',                                    category:'Returns',    source:'Original' },
    { id:'F2',  name:'Moving Average (SMA)',        formula:'MA(n) = (P1+P2+...+Pn) / n',                                 category:'Technical',  source:'Original' },
    { id:'F3',  name:'Exponential Moving Average',  formula:'EMA(t) = Pt×k + EMA(t-1)×(1-k),  k=2/(n+1)',                category:'Technical',  source:'Original' },
    { id:'F4',  name:'MACD',                        formula:'MACD=EMA12-EMA26, Signal=EMA9(MACD)',                        category:'Technical',  source:'Original' },
    { id:'F5',  name:'RSI',                         formula:'RSI=100-100/(1+RS),  RS=AvgGain/AvgLoss',                    category:'Technical',  source:'Original' },
    { id:'F6',  name:'Momentum',                    formula:'Momentum = (Pt / Pt-n) - 1',                                 category:'Technical',  source:'Original' },
    { id:'F7',  name:'Volatility (σ)',              formula:'σ = √(Σ(Ri-μ)² / N)',                                        category:'Risk',       source:'Original' },
    { id:'F8',  name:'Expected Return',             formula:'μ = ΣRi/N,  Annualised = μ×252',                             category:'Returns',    source:'Original' },
    { id:'F9',  name:'Sharpe Ratio',                formula:'Sharpe = (Rp-Rf) / σp × √252',                               category:'Risk-Adj',   source:'Original' },
    { id:'F10', name:'Drawdown',                    formula:'DD = (Pt - Peak) / Peak',                                    category:'Risk',       source:'Original' },
    { id:'F11', name:'CAGR',                        formula:'CAGR = (Vf/Vi)^(1/n) - 1',                                  category:'Returns',    source:'Original' },
    { id:'F12', name:'Portfolio Return',            formula:'Rp = Σ(wi × Ri)',                                            category:'Portfolio',  source:'Original' },
    { id:'F13', name:'Portfolio Risk',              formula:'σp = √(wᵀ × Σ × w)',                                         category:'Portfolio',  source:'Original' },
    { id:'F14', name:'Sigmoid Function',            formula:'σ(x) = 1 / (1 + e^-x)',                                     category:'ML',         source:'Original' },
    { id:'F15', name:'NLP Sentiment Score',         formula:'Sentiment = (TextBlobScore + KeywordScore) / 2',             category:'NLP',        source:'Original' },
    { id:'F16', name:'NLP Impact Score',            formula:'Impact = AvgSentiment × (1 + |AvgSentiment|) × 5',          category:'NLP',        source:'Original' },
    { id:'F17', name:'Confidence Score',            formula:'Confidence = 1 - Variance',                                  category:'ML',         source:'Original' },
    { id:'F18', name:'Kelly Position Sizing',       formula:'f* = (b×p - q) / b',                                        category:'Sizing',     source:'Original' },
    { id:'F19', name:'Covariance',                  formula:'Cov(X,Y) = Σ[(Xi-μx)(Yi-μy)] / N',                          category:'Portfolio',  source:'Original' },
    { id:'F20', name:'Linear Regression (OLS)',     formula:'y = β0 + β1x,  β1=Σ(xi-x̄)(yi-ȳ)/Σ(xi-x̄)²',               category:'ML',         source:'Original' },
    { id:'F21', name:'FinBERT Sentiment Logic',     formula:'Positive→+score, Negative→-score, Neutral→0',               category:'NLP',        source:'Original' },
    { id:'F22', name:'AI Signal Score',             formula:'FinalScore = TechnicalScore + MLScore + NewsImpactScore',    category:'Signal',     source:'Original' },
    { id:'F23', name:'Equal Portfolio Weights',     formula:'weights = 1 / n',                                            category:'Portfolio',  source:'Original' },
    { id:'F24', name:'Portfolio Expected Return',   formula:'PortReturn = weights · mean_returns',                        category:'Portfolio',  source:'Original' },
    { id:'F25', name:'Portfolio Risk',              formula:'PortRisk = √(wᵀ × Σ × w)',                                   category:'Portfolio',  source:'Original' },
    { id:'F26', name:'ML Prediction (OLS)',         formula:'PredictedReturn = model.predict(features)',                  category:'ML',         source:'Original' },
    { id:'F27', name:'NLP Confidence',              formula:'Confidence = 1 - sentiment_variance',                        category:'NLP',        source:'Original' },
    { id:'F28', name:'Batch Sentiment Average',     formula:'AvgSentiment = Σsentiments / n',                             category:'NLP',        source:'Original' },
    { id:'F29', name:'Non-linear Impact',           formula:'Impact = avg × (1 + |avg|)',                                  category:'NLP',        source:'Original' },
    { id:'F30', name:'Trading Signal Logic',        formula:'≥4→STRONG BUY, ≥2→BUY, ≤-4→STRONG SELL, ≤-2→SELL, else HOLD', category:'Signal', source:'Original' },
    // New from document
    { id:'N1',  name:'Stochastic Oscillator %K',   formula:'%K = (C - L14) / (H14 - L14) × 100',                        category:'Technical',  source:'Document — Wilder' },
    { id:'N2',  name:'Stochastic %D Signal',        formula:'%D = 3-period SMA of %K',                                   category:'Technical',  source:'Document — Wilder' },
    { id:'N3',  name:'ADX (Trend Strength)',        formula:'ADX = Smoothed(|+DI - -DI| / (+DI + -DI)) × 100',           category:'Technical',  source:'Document — Wilder' },
    { id:'N4',  name:'OBV (On-Balance Volume)',     formula:'OBV += Vol (up day), OBV -= Vol (down day)',                 category:'Volume',     source:'Document' },
    { id:'N5',  name:'Bollinger Band Width',        formula:'BBW = (Upper - Lower) / Middle × 100',                      category:'Volatility', source:'Document — Bollinger' },
    { id:'N6',  name:'ROCE',                        formula:'ROCE = EBIT / Capital Employed × 100',                      category:'Fundamental',source:'Document' },
    { id:'N7',  name:'Treynor Ratio',               formula:'Treynor = (Rp - Rf) / Beta',                                category:'Risk-Adj',   source:'Document' },
    { id:'N8',  name:'PEG Ratio',                   formula:'PEG = P/E / Earnings Growth Rate',                          category:'Valuation',  source:'Document — Lynch' },
    { id:'N9',  name:'Times Interest Earned (TIE)', formula:'TIE = EBIT / Interest Expense',                             category:'Solvency',   source:'Document' },
    { id:'N10', name:'Defensive Interval Ratio',    formula:'DIR = Current Assets / Daily Operating Expenditure',        category:'Liquidity',  source:'Document' },
    { id:'N11', name:'ATR Trailing Stop',           formula:'Stop = Price - (ATR_multiplier × ATR)',                     category:'Risk',       source:'Document — Jones' },
    { id:'N12', name:'1% Rule Position Sizing',     formula:'Size = (Account × Risk%) / (Entry - StopLoss)',             category:'Sizing',     source:'Document — Jones' },
    { id:'N13', name:'Greenblatt Earnings Yield',   formula:'EY = EBIT / Enterprise Value × 100',                       category:'Valuation',  source:'Document — Greenblatt' },
    { id:'N14', name:'Greenblatt ROC',              formula:'ROC = EBIT / (Net Fixed Assets + Working Capital) × 100',  category:'Quality',    source:'Document — Greenblatt' },
    { id:'N15', name:'Coffee Can Screener',         formula:'MarketCap>₹100Cr, Revenue+ROCE≥10%/15% for 10yr',          category:'Indian',     source:'Document — Mukherjea' },
    { id:'N16', name:'SMILE Framework',             formula:'Small+Medium Exp+Large Asp+Extra-Large Market',             category:'Indian',     source:'Document — Kedia' },
    { id:'N17', name:'QGLP Framework',              formula:'Quality + Growth + Longevity + Price',                      category:'Indian',     source:'Document — Agrawal' },
    { id:'N18', name:'Lynch 6-Category',            formula:'Slow/Stalwart/Fast/Cyclical/Asset/Turnaround',              category:'Classification', source:'Document — Lynch' },
    { id:'N19', name:'Dalio All-Weather',           formula:'30% EQ + 40% LT Bond + 15% IT Bond + 7.5% Gold + 7.5% Comm', category:'Allocation', source:'Document — Dalio' },
    { id:'N20', name:'Soros Reflexivity Score',     formula:'Bubble: High PE + Strong Momentum + Volume Surge',          category:'Macro',      source:'Document — Soros' },
    { id:'N21', name:'Typical Price',               formula:'TP = (High + Low + Close) / 3',                             category:'Price',      source:'Document' },
    { id:'N22', name:'Weighted Close',              formula:'WC = (High + Low + Close×2) / 4',                           category:'Price',      source:'Document' },
    { id:'N23', name:'Comprehensive Fund. Score',   formula:'Graham MoS + ROE + PE + Growth + Debt + Coffee Can + SMILE + QGLP', category:'Composite', source:'Document — Synthesized' },
  ]);
});
// ─── /api/quant/fundamental/:ticker — Comprehensive fundamental score ─────────
app.get('/api/quant/fundamental/:ticker', (req, res) => {
  const { ticker } = req.params;
  const stock = INDIAN_STOCKS.find(s => s.ticker === ticker);
  if (!stock) return res.status(404).json({ error: 'Stock not found' });
  const f = stock.fundamentals || {};
  const result = Q.comprehensiveFundamentalScore(stock);
  result.coffeeCan = Q.coffeeCan(stock);
  result.smile     = Q.smileScore(stock);
  result.qglp      = Q.qglpScore(stock);
  result.lynch     = Q.lynchCategory(stock);
  result.peg       = f.pe_ratio && f.earnings_growth ? {
    value: Q.calcPEG(f.pe_ratio, f.earnings_growth),
    signal: Q.pegSignal(Q.calcPEG(f.pe_ratio, f.earnings_growth))
  } : null;
  result.ticker = ticker; result.name = stock.name; result.sector = stock.sector;
  res.json(result);
});

// ─── /api/quant/screener/magic — Greenblatt Magic Formula ────────────────────
app.get('/api/quant/screener/magic', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const scored = INDIAN_STOCKS
    .filter(s => s.fundamentals && s.fundamentals.eps > 0 && s.fundamentals.pe_ratio > 0)
    .map(s => {
      const f = s.fundamentals;
      const ev   = (f.market_cap_cr || 0) * 1e7;
      const ebit = f.eps * (f.pe_ratio || 1) * ((f.profit_margin || 10) / 100) * 1e7;
      const ey   = Q.greenblatEarningsYield(ebit, ev > 0 ? ev : 1);
      const roc  = Q.greenblatROC(ebit, (f.book_value || 100) * 1e7, (f.market_cap_cr || 1000) * 1e5);
      return { ticker: s.ticker, name: s.name, sector: s.sector, earningsYield: ey, roc, pe: f.pe_ratio, roe: f.roe };
    })
    .filter(s => s.earningsYield > 0 && s.roc > 0);
  const eyR  = [...scored].sort((a,b) => b.earningsYield - a.earningsYield);
  const rocR = [...scored].sort((a,b) => b.roc - a.roc);
  scored.forEach(s => {
    s.eyRank   = eyR.findIndex(x => x.ticker === s.ticker) + 1;
    s.rocRank  = rocR.findIndex(x => x.ticker === s.ticker) + 1;
    s.magicRank = s.eyRank + s.rocRank;
  });
  scored.sort((a,b) => a.magicRank - b.magicRank);
  res.json({ formula: 'Greenblatt Magic Formula', count: scored.length, top: scored.slice(0, limit) });
});

// ─── /api/quant/screener/coffeecan ───────────────────────────────────────────
app.get('/api/quant/screener/coffeecan', (req, res) => {
  const results = INDIAN_STOCKS
    .map(s => ({ ...Q.coffeeCan(s), ticker: s.ticker, name: s.name, sector: s.sector }))
    .filter(s => s.qualifies).sort((a,b) => b.score - a.score);
  res.json({ strategy: 'Coffee Can Portfolio (Mukherjea)', count: results.length, stocks: results });
});

// ─── /api/quant/screener/smile ────────────────────────────────────────────────
app.get('/api/quant/screener/smile', (req, res) => {
  const results = INDIAN_STOCKS
    .map(s => ({ ...Q.smileScore(s), ticker: s.ticker, name: s.name, sector: s.sector }))
    .filter(s => s.score >= 50).sort((a,b) => b.score - a.score);
  res.json({ strategy: 'SMILE Framework (Vijay Kedia)', count: results.length, stocks: results });
});

// ─── /api/quant/screener/qglp ────────────────────────────────────────────────
app.get('/api/quant/screener/qglp', (req, res) => {
  const results = INDIAN_STOCKS
    .map(s => ({ ...Q.qglpScore(s), ticker: s.ticker, name: s.name, sector: s.sector }))
    .filter(s => s.score >= 50).sort((a,b) => b.score - a.score);
  res.json({ strategy: 'QGLP Framework (Raamdeo Agrawal)', count: results.length, stocks: results });
});

// ─── /api/quant/allweather ────────────────────────────────────────────────────
app.get('/api/quant/allweather', (req, res) => res.json(Q.dalioAllWeather()));

// ─── /api/quant/ptj-risk ─────────────────────────────────────────────────────
app.post('/api/quant/ptj-risk', (req, res) => res.json(Q.ptjRiskCheck(req.body)));

// ─── /api/quant/position-size ────────────────────────────────────────────────
app.post('/api/quant/position-size', (req, res) => {
  const { account_size, risk_pct=1, entry_price, stop_loss_price, win_rate, reward_risk } = req.body;
  if (!account_size || !entry_price || !stop_loss_price)
    return res.status(400).json({ error: 'account_size, entry_price, stop_loss_price required' });
  const shares = Q.positionSize1PctRule(account_size, risk_pct, entry_price, stop_loss_price);
  const kelly  = win_rate && reward_risk ? Q.kellyEdge(win_rate, reward_risk) : null;
  res.json({
    shares, riskAmount: +(account_size*(risk_pct/100)).toFixed(2), riskPct: risk_pct,
    riskPerShare: +Math.abs(entry_price-stop_loss_price).toFixed(2),
    totalCost: +(shares*entry_price).toFixed(2),
    kellyFraction: kelly ? +(kelly*100).toFixed(2) : null,
    rule: `1% Rule: Never risk more than ${risk_pct}% of account on one trade`
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Dalal Street Intel running at http://localhost:${PORT}`);
  console.log(`📡 Data Source: ✅ Yahoo Finance — Real NSE/BSE data, FREE, no API key needed`);
  console.log(`💾 Database: ${DB_PATH}\n`);
});

module.exports = app;
