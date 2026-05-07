# 🇮🇳 DALAL STREET INTEL — Groww Quant Intelligence Dashboard v3.0

**Indian Market Intelligence Terminal** — Full Stack Node.js + Vanilla JS

---

## 🚀 QUICK START

```bash
cd stockapp
node backend/server.js
# Open: http://localhost:3000
```

---

## ✅ DOES IT WORK WHEN MARKET IS CLOSED?

**YES — 100% functional 24×7.**

The entire analysis pipeline runs on **historical candles** (1-day OHLC bars) which are available round the clock. Live LTP is only a thin overlay when market is open. When closed, the last candle's close = effective current price.

All 30 formulas, DCF, MPT, VaR, Options, Tax — everything works after hours.

---

## 📡 GROWW API STATUS

Your key **"Ibrahim"** is **Approved** on the dashboard.

### Why 403 on data endpoints?

The token has `role: auth-totp` which means it was generated via TOTP flow. Groww's data endpoints (LTP, Historical, Holdings) require a **Trading API subscription** to be active on your account.

### To enable live Groww data:

1. Go to **[groww.in/trade-api](https://groww.in/trade-api)** → Purchase/Activate Trading API subscription
2. After activation, regenerate your API key at **[groww.in/trade-api/api-keys](https://groww.in/trade-api/api-keys)**
3. Set the new token:

```bash
# PowerShell
Invoke-RestMethod "http://localhost:3000/api/groww/token" `
  -Method POST -ContentType "application/json" `
  -Body '{"access_token":"YOUR_NEW_TOKEN"}'

# curl
curl -X POST http://localhost:3000/api/groww/token \
  -H "Content-Type: application/json" \
  -d '{"access_token":"YOUR_NEW_TOKEN"}'
```

4. Verify: `curl http://localhost:3000/api/health` → should show `"data_source":"groww_live"`

### Until then — static data works perfectly

All analysis, all 30 formulas, all 8 quant engines work on static data with realistic price simulation.

---

## 🔢 30 FORMULAS IMPLEMENTED

| # | Formula | Used In |
|---|---------|---------|
| F1 | `Rt = (Pt - Pt-1) / Pt-1` | Daily returns |
| F2 | `MA(n) = ΣP/n` | SMA 20/50/200 |
| F3 | `EMA(t) = Pt×k + EMA(t-1)×(1-k), k=2/(n+1)` | EMA 9/12/26 |
| F4 | `MACD = EMA12-EMA26, Signal = EMA9(MACD)` | MACD histogram |
| F5 | `RSI = 100-100/(1+RS)` | RSI(14) |
| F6 | `Momentum = (Pt/Pt-n) - 1` | 63d/21d momentum |
| F7 | `σ = √(Σ(Ri-μ)²/N)` | Annualised volatility |
| F8 | `μ = ΣRi/N × 252` | Expected return |
| F9 | `Sharpe = (Rp-Rf)/σp × √252` | Sharpe + Sortino |
| F10 | `DD = (Pt - Peak)/Peak` | Max drawdown |
| F11 | `CAGR = (Vf/Vi)^(1/n) - 1` | CAGR % |
| F12 | `Rp = Σ(wi × Ri)` | MPT portfolio return |
| F13 | `σp = √(wᵀΣw)` | MPT portfolio risk |
| F14 | `σ(x) = 1/(1+e^-x)` | Sigmoid normalisation |
| F15 | `Sentiment = (TextBlob + Keyword)/2` | NLP sentiment |
| F16 | `Impact = Avg×(1+\|Avg\|)×5` | NLP impact score |
| F17 | `Confidence = 1 - Variance` | Tech confidence |
| F18 | `Kelly = p - ((1-p)/R)` | Kelly fraction |
| F19 | `Cov(X,Y) = Σ[(Xi-μx)(Yi-μy)]/N` | MPT covariance |
| F20 | `y = β0 + β1x (OLS)` | Linear regression |
| F21 | `Positive→+score, Negative→-score` | FinBERT logic |
| F22 | `FinalScore = Tech + ML + News` | AI signal score |
| F23 | `weights = 1/n` | Equal weights |
| F24 | `PortReturn = weights · mean_returns` | Portfolio return |
| F25 | `PortRisk = √(wᵀΣw)` | Portfolio risk |
| F26 | `PredReturn = OLS.predict(features)` | ML prediction |
| F27 | `NLPConf = 1 - sentiment_variance` | NLP confidence |
| F28 | `AvgSent = Σsentiments/n` | Batch sentiment |
| F29 | `Impact = avg×(1+\|avg\|)` | Non-linear impact |
| F30 | `≥4→STRONG BUY, ≥2→BUY, ≤-4→STRONG SELL` | Trading signal |

---

## 📊 17 VIEWS

| View | Description |
|------|-------------|
| 📊 Dashboard | 5 indices, gainers/losers, watchlist, portfolio |
| 🏆 Top 10 Picks | Expert-scored top 10 Stocks/MFs/ETFs/Bonds |
| 📈 Stock Analyser | Full 30-formula hybrid analysis + chart |
| 🏷️ ETF Explorer | 12 NSE ETFs with tracking error, liquidity |
| 🏦 MF Explorer | 15 mutual funds with CAGR, expense ratio |
| 🏛️ Bond Explorer | 10 bonds/debt instruments with YTM, rating |
| 📋 Screener | Filter 31 stocks by P/E, ROE, D/E, dividend |
| 📐 DCF Valuation | CAPM + WACC + Three-Stage DCF |
| 🎯 Portfolio MPT | Monte Carlo efficient frontier |
| ⚠️ VaR Engine | Var-Cov, Historical Sim, Monte Carlo |
| 🏛️ Options/BSM | Black-Scholes + Δ Γ Θ ν ρ + payoff diagrams |
| 💸 Tax Engine | India 2024-2026 STCG/LTCG + harvesting |
| 🧮 Valuation Calc | Graham Number, DCF, Peter Lynch, EPV, PEG |
| ⭐ Watchlist | Add/remove, live prices |
| 💰 Portfolio | Holdings tracker with live P&L |
| 🔔 Alerts | Price alerts above/below |
| 📚 Glossary | 24 terms + 30 formula reference |

---

## 🔌 API ENDPOINTS

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health + Groww API status |
| `GET /api/groww/status` | Detailed Groww connection status |
| `POST /api/groww/token` | Set Groww access token |
| `GET /api/quant/analyze/:ticker?news=h1\|h2` | Full 30-formula hybrid analysis |
| `GET /api/quant/formulas` | All 30 formula reference |
| `POST /api/quant/batch` | Batch analysis for multiple symbols |
| `POST /api/quant/options` | Black-Scholes pricing + Greeks |
| `POST /api/quant/payoff` | Options strategy payoff diagram |
| `POST /api/quant/dcf` | Three-stage DCF + CAPM + WACC |
| `POST /api/quant/mpt` | Efficient frontier (Monte Carlo) |
| `POST /api/quant/var` | VaR (3 methods) |
| `POST /api/quant/tax` | Tax calculation |
| `POST /api/quant/tax/harvest` | Tax-loss harvesting |
| `GET /api/market/indices` | NIFTY/SENSEX/BANK/IT/MIDCAP |
| `GET /api/market/top10` | Expert-scored top 10 |
| `GET /api/market/movers` | Top gainers/losers |
| `GET /api/search?q=` | Search all instruments |
| `GET /api/quote/:ticker` | Live/static price quote |
| `GET /api/history/:ticker?period=3m` | Historical candles |
| `GET /api/fundamentals/:ticker` | Company fundamentals |
| `POST /api/calc/valuations` | Graham/DCF/Lynch/EPV/PEG |

---

## ⚠️ DISCLAIMER

For educational purposes only. Not SEBI-registered investment advice.
Consult a qualified financial advisor before investing.
