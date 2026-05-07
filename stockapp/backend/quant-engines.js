'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// QUANTITATIVE ENGINES — Hybrid AI Signal Engine v3.0
// ALL 30 ORIGINAL FORMULAS + NEW FROM COMPREHENSIVE ANALYSIS DOCUMENT:
//
// ORIGINAL (F1-F30): Percentage Return, SMA, EMA, MACD, RSI, Momentum,
//   Volatility, Expected Return, Sharpe, Drawdown, CAGR, Portfolio Return/Risk,
//   Sigmoid, NLP Sentiment/Impact/Confidence, Kelly, Covariance, OLS Regression,
//   FinBERT, AI Signal Score, Equal Weights, ML Prediction, Trading Signal
//
// NEW FROM DOCUMENT:
//   Stochastic Oscillator (%K/%D)    ADX (Average Directional Index)
//   OBV (On-Balance Volume)          ROCE = EBIT/Capital Employed
//   Treynor Ratio                    PEG Ratio
//   Times Interest Earned (TIE)      Defensive Interval Ratio (DIR)
//   Greenblatt Magic Formula         Coffee Can Portfolio Screener (Mukherjea)
//   SMILE Framework (Kedia)          QGLP Framework (Agrawal)
//   Lynch 6-Category Classifier      Dalio All-Weather Allocation
//   Soros Reflexivity Score          ATR Trailing Stop
//   1% Rule Position Sizing          Paul Tudor Jones Risk Rules
//   Typical Price / Weighted Close   Bollinger Band Width (Squeeze)
//
// Plus: Black-Scholes+Greeks, Three-Stage DCF+CAPM+WACC, MPT, VaR(3), Tax
// ══════════════════════════════════════════════════════════════════════════════

// ─── Normal Distribution helpers (replaces scipy.stats.norm) ─────────────────
function erf(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1.0/(1.0+p*x);
  const y = 1.0-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}
function normCDF(x) { return 0.5*(1+erf(x/Math.SQRT2)); }
function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function normPPF(p) {
  // Rational approximation (Beasley-Springer-Moro)
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a=[2.50662823884,-18.61500062529,41.39119773534,-25.44106049637];
  const b=[-8.47351093090,23.08336743743,-21.06224101826,3.13082909833];
  const c=[0.3374754822726147,0.9761690190917186,0.1607979714918209,0.0276438810333863,0.0038405729373609,0.0003951896511349,0.0000321767881768,0.0000002888167364,0.0000003960315187];
  let r, q = p - 0.5;
  if (Math.abs(q) <= 0.42) {
    r = q*q;
    return q*(((a[3]*r+a[2])*r+a[1])*r+a[0])/((((b[3]*r+b[2])*r+b[1])*r+b[0])*r+1);
  }
  r = q < 0 ? p : 1-p;
  r = Math.log(-Math.log(r));
  let x = c[0]+r*(c[1]+r*(c[2]+r*(c[3]+r*(c[4]+r*(c[5]+r*(c[6]+r*(c[7]+r*c[8])))))));
  return q < 0 ? -x : x;
}

// ─── TECHNICAL INDICATORS ────────────────────────────────────────────────────

function calcRSI(closes, period=14) {
  if (closes.length < period+1) return null;
  let gains=0, losses=0;
  for (let i=1; i<=period; i++) {
    const d = closes[i]-closes[i-1];
    if (d>0) gains+=d; else losses+=Math.abs(d);
  }
  let avgGain=gains/period, avgLoss=losses/period;
  for (let i=period+1; i<closes.length; i++) {
    const d = closes[i]-closes[i-1];
    avgGain = (avgGain*(period-1)+(d>0?d:0))/period;
    avgLoss = (avgLoss*(period-1)+(d<0?Math.abs(d):0))/period;
  }
  if (avgLoss===0) return 100;
  return +(100 - 100/(1+avgGain/avgLoss)).toFixed(2);
}

function calcEMA(closes, span) {
  if (closes.length < span) return null;
  const k = 2/(span+1);
  let ema = closes.slice(0,span).reduce((a,b)=>a+b,0)/span;
  for (let i=span; i<closes.length; i++) ema = closes[i]*k + ema*(1-k);
  return +ema.toFixed(4);
}

function calcSMA(closes, window) {
  if (closes.length < window) return null;
  return +(closes.slice(-window).reduce((a,b)=>a+b,0)/window).toFixed(2);
}

function calcMACD(closes) {
  if (closes.length < 35) return { macd: null, signal: null, hist: null };
  const k12=2/13, k26=2/27, k9=2/10;
  let ema12=closes.slice(0,12).reduce((a,b)=>a+b,0)/12;
  let ema26=closes.slice(0,26).reduce((a,b)=>a+b,0)/26;
  for (let i=12; i<closes.length; i++) ema12=closes[i]*k12+ema12*(1-k12);
  for (let i=26; i<closes.length; i++) ema26=closes[i]*k26+ema26*(1-k26);
  // Build MACD line for signal
  const macdLine=[];
  let e12=closes.slice(0,12).reduce((a,b)=>a+b,0)/12;
  let e26=closes.slice(0,26).reduce((a,b)=>a+b,0)/26;
  for (let i=12; i<closes.length; i++) e12=closes[i]*k12+e12*(1-k12);
  for (let i=26; i<closes.length; i++) { e26=closes[i]*k26+e26*(1-k26); if(i>=26) macdLine.push(e12-e26); }
  // Recalculate properly
  const macdArr=[];
  let em12=closes[0], em26=closes[0];
  for (let i=1; i<closes.length; i++) {
    em12=closes[i]*k12+em12*(1-k12);
    em26=closes[i]*k26+em26*(1-k26);
    if (i>=25) macdArr.push(em12-em26);
  }
  let sig=macdArr[0];
  for (let i=1; i<macdArr.length; i++) sig=macdArr[i]*k9+sig*(1-k9);
  const macdVal=macdArr[macdArr.length-1];
  return { macd:+macdVal.toFixed(4), signal:+sig.toFixed(4), hist:+(macdVal-sig).toFixed(4) };
}

function calcBollinger(closes, window=20) {
  if (closes.length < window) return { upper:null, mid:null, lower:null };
  const slice = closes.slice(-window);
  const mid = slice.reduce((a,b)=>a+b,0)/window;
  const sd = Math.sqrt(slice.reduce((a,b)=>a+(b-mid)**2,0)/window);
  return { upper:+(mid+2*sd).toFixed(2), mid:+mid.toFixed(2), lower:+(mid-2*sd).toFixed(2) };
}

function calcATR(highs, lows, closes, period=14) {
  if (closes.length < period+1) return null;
  const trs=[];
  for (let i=1; i<closes.length; i++) {
    trs.push(Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1])));
  }
  return +(trs.slice(-period).reduce((a,b)=>a+b,0)/period).toFixed(2);
}

function calcVWAP(highs, lows, closes, volumes) {
  let tpv=0, tv=0;
  for (let i=0; i<closes.length; i++) {
    const tp=(highs[i]+lows[i]+closes[i])/3;
    const v=volumes[i]||0;
    tpv+=tp*v; tv+=v;
  }
  return tv>0 ? +(tpv/tv).toFixed(2) : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW INDICATORS FROM COMPREHENSIVE ANALYSIS DOCUMENT
// ══════════════════════════════════════════════════════════════════════════════

// ─── Typical Price & Weighted Close (advanced price inputs) ──────────────────
function typicalPrice(high, low, close) { return (high + low + close) / 3; }
function weightedClose(high, low, close) { return (high + low + close * 2) / 4; }

// ─── Stochastic Oscillator %K/%D ─────────────────────────────────────────────
// %K = (C - L14) / (H14 - L14) × 100
// %D = 3-period SMA of %K
function calcStochastic(highs, lows, closes, period=14, smoothK=3) {
  if (closes.length < period) return { k: null, d: null };
  const kValues = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice_h = highs.slice(i - period + 1, i + 1);
    const slice_l = lows.slice(i - period + 1, i + 1);
    const H14 = Math.max(...slice_h);
    const L14 = Math.min(...slice_l);
    const k = H14 !== L14 ? ((closes[i] - L14) / (H14 - L14)) * 100 : 50;
    kValues.push(+k.toFixed(2));
  }
  const lastK = kValues[kValues.length - 1];
  // %D = smoothK-period SMA of %K
  const dSlice = kValues.slice(-smoothK);
  const lastD = dSlice.length >= smoothK
    ? +(dSlice.reduce((a,b)=>a+b,0)/smoothK).toFixed(2)
    : null;
  return { k: lastK, d: lastD, kValues };
}

// ─── ADX — Average Directional Index (trend strength, 0-100) ─────────────────
// ADX > 25 = strong trend, < 20 = weak/ranging
function calcADX(highs, lows, closes, period=14) {
  if (closes.length < period + 1) return { adx: null, pdi: null, mdi: null };
  const trArr=[], pdmArr=[], mdmArr=[];
  for (let i=1; i<closes.length; i++) {
    const tr = Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
    const upMove   = highs[i]  - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    trArr.push(tr);
    pdmArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
    mdmArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  // Wilder smoothing
  const smooth = (arr, p) => {
    let s = arr.slice(0,p).reduce((a,b)=>a+b,0);
    const out = [s];
    for (let i=p; i<arr.length; i++) { s = s - s/p + arr[i]; out.push(s); }
    return out;
  };
  const sTR  = smooth(trArr,  period);
  const sPDM = smooth(pdmArr, period);
  const sMDM = smooth(mdmArr, period);
  const pdiArr = sTR.map((tr,i) => tr>0 ? (sPDM[i]/tr)*100 : 0);
  const mdiArr = sTR.map((tr,i) => tr>0 ? (sMDM[i]/tr)*100 : 0);
  const dxArr  = pdiArr.map((p,i) => {
    const sum = p + mdiArr[i];
    return sum > 0 ? Math.abs(p - mdiArr[i]) / sum * 100 : 0;
  });
  // ADX = Wilder smooth of DX
  const adxArr = smooth(dxArr, period);
  return {
    adx: +adxArr[adxArr.length-1].toFixed(2),
    pdi: +pdiArr[pdiArr.length-1].toFixed(2),
    mdi: +mdiArr[mdiArr.length-1].toFixed(2)
  };
}

// ─── OBV — On-Balance Volume ──────────────────────────────────────────────────
// Cumulative: add volume on up days, subtract on down days
function calcOBV(closes, volumes) {
  if (closes.length < 2) return null;
  let obv = 0;
  for (let i=1; i<closes.length; i++) {
    if (closes[i] > closes[i-1])      obv += (volumes[i]||0);
    else if (closes[i] < closes[i-1]) obv -= (volumes[i]||0);
  }
  return obv;
}

// OBV trend: rising OBV with flat price = accumulation (bullish divergence)
function obvTrend(closes, volumes, lookback=20) {
  if (closes.length < lookback + 1) return 'neutral';
  const recentCloses  = closes.slice(-lookback);
  const recentVolumes = volumes.slice(-lookback);
  let obv = 0;
  const obvSeries = [0];
  for (let i=1; i<recentCloses.length; i++) {
    if (recentCloses[i] > recentCloses[i-1])      obv += (recentVolumes[i]||0);
    else if (recentCloses[i] < recentCloses[i-1]) obv -= (recentVolumes[i]||0);
    obvSeries.push(obv);
  }
  const priceChange = (recentCloses[recentCloses.length-1] - recentCloses[0]) / recentCloses[0];
  const obvChange   = obvSeries[obvSeries.length-1] / (Math.abs(obvSeries[0])||1);
  // Bullish divergence: OBV rising, price flat/falling
  if (obvChange > 0.05 && priceChange < 0.02) return 'accumulation';
  // Bearish divergence: OBV falling, price flat/rising
  if (obvChange < -0.05 && priceChange > -0.02) return 'distribution';
  return 'neutral';
}

// ─── Bollinger Band Width (Squeeze detector) ──────────────────────────────────
// Narrow bands = volatility contraction → explosive breakout imminent
function bollingerBandWidth(closes, window=20) {
  if (closes.length < window) return null;
  const slice = closes.slice(-window);
  const mid = slice.reduce((a,b)=>a+b,0)/window;
  const sd  = Math.sqrt(slice.reduce((a,b)=>a+(b-mid)**2,0)/window);
  return +((4*sd/mid)*100).toFixed(4); // % width relative to mid
}

// ─── ROCE — Return on Capital Employed ───────────────────────────────────────
// ROCE = EBIT / Capital Employed  (Capital Employed = Total Assets - Current Liabilities)
function calcROCE(ebit, totalAssets, currentLiabilities) {
  const capitalEmployed = totalAssets - currentLiabilities;
  return capitalEmployed > 0 ? +(ebit / capitalEmployed * 100).toFixed(2) : null;
}

// ─── Treynor Ratio ────────────────────────────────────────────────────────────
// Treynor = (Rp - Rf) / Beta  — risk premium per unit of SYSTEMATIC risk
function calcTreynor(portfolioReturn, riskFreeRate, beta) {
  return beta > 0 ? +((portfolioReturn - riskFreeRate) / beta).toFixed(4) : null;
}

// ─── PEG Ratio ────────────────────────────────────────────────────────────────
// PEG = P/E / Earnings Growth Rate
// PEG < 1 = undervalued growth (Peter Lynch), PEG > 2 = expensive
function calcPEG(peRatio, earningsGrowthRate) {
  return earningsGrowthRate > 0 ? +(peRatio / earningsGrowthRate).toFixed(3) : null;
}
function pegSignal(peg) {
  if (peg == null) return 'N/A';
  if (peg < 0.5)  return 'STRONG BUY (deeply undervalued growth)';
  if (peg < 1.0)  return 'BUY (undervalued growth — Lynch sweet spot)';
  if (peg < 1.5)  return 'HOLD (fairly valued)';
  if (peg < 2.0)  return 'CAUTION (slightly expensive)';
  return 'AVOID (overvalued relative to growth)';
}

// ─── Times Interest Earned (TIE) ─────────────────────────────────────────────
// TIE = EBIT / Interest Expense  — debt serviceability
// TIE > 3 = safe, TIE < 1.5 = distress risk
function calcTIE(ebit, interestExpense) {
  return interestExpense > 0 ? +(ebit / interestExpense).toFixed(2) : null;
}

// ─── Defensive Interval Ratio (DIR) ──────────────────────────────────────────
// DIR = Current Assets / Daily Operating Expenditure
// How many days can company operate without external capital
function calcDIR(currentAssets, annualOperatingExpenses, nonCashCharges=0) {
  const dailyExp = (annualOperatingExpenses - nonCashCharges) / 365;
  return dailyExp > 0 ? +Math.round(currentAssets / dailyExp) : null;
}

// ─── ATR Trailing Stop ────────────────────────────────────────────────────────
// Trailing stop = Current Price - (ATR multiplier × ATR)
// Standard: 2× ATR for swing, 3× ATR for position trading
function atrTrailingStop(currentPrice, atr, multiplier=2) {
  return +(currentPrice - multiplier * atr).toFixed(2);
}

// ─── 1% Rule Position Sizing (Paul Tudor Jones / standard risk mgmt) ─────────
// Position Size = (Account × Risk%) / (Entry - StopLoss)
function positionSize1PctRule(accountSize, riskPct, entryPrice, stopLossPrice) {
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);
  if (riskPerShare === 0) return 0;
  const maxRisk = accountSize * (riskPct / 100);
  return Math.floor(maxRisk / riskPerShare);
}

// ─── Greenblatt Magic Formula ─────────────────────────────────────────────────
// Ranks stocks by: (1) Earnings Yield = EBIT/EV  (2) ROC = EBIT/(NFA+WC)
// Combined rank = best cheap + best quality businesses
function greenblatEarningsYield(ebit, enterpriseValue) {
  return enterpriseValue > 0 ? +(ebit / enterpriseValue * 100).toFixed(2) : null;
}
function greenblatROC(ebit, netFixedAssets, workingCapital) {
  const capital = netFixedAssets + workingCapital;
  return capital > 0 ? +(ebit / capital * 100).toFixed(2) : null;
}
function magicFormulaScore(earningsYield, roc, allStocks) {
  // Rank each metric, combine ranks (lower = better)
  const eyRanks  = [...allStocks].sort((a,b) => b.earningsYield - a.earningsYield);
  const rocRanks = [...allStocks].sort((a,b) => b.roc - a.roc);
  const eyRank   = eyRanks.findIndex(s => s === allStocks.find(x=>x.earningsYield===earningsYield)) + 1;
  const rocRank  = rocRanks.findIndex(s => s === allStocks.find(x=>x.roc===roc)) + 1;
  return eyRank + rocRank; // lower combined rank = better Magic Formula stock
}

// ─── Coffee Can Portfolio Screener (Saurabh Mukherjea) ───────────────────────
// Criteria: Market Cap > ₹100Cr, Revenue growth ≥10% EVERY year for 10yr,
//           ROCE ≥15% EVERY year for 10yr, Operational history ≥10yr
function coffeeCan(stock) {
  const f = stock.fundamentals || {};
  const checks = {
    marketCap:      (f.market_cap_cr || 0) >= 100,
    revenueGrowth:  (f.revenue_growth || 0) >= 10,   // proxy: current year
    roce:           (f.roe || 0) >= 15,               // using ROE as ROCE proxy
    debtSafety:     (f.debt_to_equity || 99) < 1,
    profitMargin:   (f.profit_margin || 0) >= 10,
    earningsGrowth: (f.earnings_growth || 0) >= 10,
  };
  const score = Object.values(checks).filter(Boolean).length;
  return {
    qualifies: score >= 5,
    score,
    checks,
    verdict: score >= 5 ? 'COFFEE CAN QUALITY' : score >= 3 ? 'WATCHLIST' : 'DOES NOT QUALIFY'
  };
}

// ─── SMILE Framework (Vijay Kedia) ────────────────────────────────────────────
// S=Small in size (growth runway), M=Medium experience, I/L=Large aspirations,
// E=Extra-large market potential
// Proxy scoring using available fundamentals
function smileScore(stock) {
  const f = stock.fundamentals || {};
  let score = 0;
  const details = {};
  // S — Small in size (market cap < ₹50,000 Cr = room to grow)
  details.S_smallSize = (f.market_cap_cr || 999999) < 50000;
  if (details.S_smallSize) score += 25;
  // M — Medium experience (earnings growth 15-40% = not too early, not mature)
  details.M_mediumExp = (f.earnings_growth || 0) >= 15 && (f.earnings_growth || 0) <= 50;
  if (details.M_mediumExp) score += 25;
  // I/L — Large aspirations (high revenue growth = expanding aggressively)
  details.IL_largeAsp = (f.revenue_growth || 0) >= 15;
  if (details.IL_largeAsp) score += 25;
  // E — Extra-large market (high ROE = efficient player in growing market)
  details.E_marketPot = (f.roe || 0) >= 20 && (f.debt_to_equity || 99) < 0.5;
  if (details.E_marketPot) score += 25;
  return {
    score,
    details,
    verdict: score >= 75 ? 'STRONG SMILE' : score >= 50 ? 'PARTIAL SMILE' : 'WEAK SMILE'
  };
}

// ─── QGLP Framework (Raamdeo Agrawal) ────────────────────────────────────────
// Quality + Growth + Longevity + Price
function qglpScore(stock) {
  const f = stock.fundamentals || {};
  let score = 0;
  const details = {};
  // Quality: ROE > 20%, low debt, high margins
  details.quality = (f.roe||0) >= 20 && (f.debt_to_equity||99) < 1 && (f.profit_margin||0) >= 15;
  if (details.quality) score += 25;
  // Growth: earnings growth > 15%
  details.growth = (f.earnings_growth||0) >= 15;
  if (details.growth) score += 25;
  // Longevity: consistent business (proxy: low debt + positive margins)
  details.longevity = (f.debt_to_equity||99) < 0.5 && (f.operating_margin||0) >= 15;
  if (details.longevity) score += 25;
  // Price: reasonable P/E (< 40 for growth, < 25 for value)
  details.price = (f.pe_ratio||999) < 40 && (f.pe_ratio||0) > 0;
  if (details.price) score += 25;
  return {
    score,
    details,
    verdict: score >= 75 ? 'QGLP CHAMPION' : score >= 50 ? 'QGLP CANDIDATE' : 'BELOW QGLP THRESHOLD'
  };
}

// ─── Lynch 6-Category Classifier ─────────────────────────────────────────────
function lynchCategory(stock) {
  const f = stock.fundamentals || {};
  const eg = f.earnings_growth || 0;
  const pe = f.pe_ratio || 0;
  const dy = f.dividend_yield || 0;
  const de = f.debt_to_equity || 0;
  const mc = f.market_cap_cr || 0;

  if (eg < 5 && dy > 2)                          return { category: 'Slow Grower',   strategy: 'Hold for dividends, exit if dividend cut' };
  if (eg >= 5 && eg < 12 && mc > 50000)          return { category: 'Stalwart',      strategy: 'Buy on dips, sell 30-50% gain, portfolio anchor' };
  if (eg >= 15 && eg <= 50 && pe < 40)           return { category: 'Fast Grower',   strategy: 'Highest conviction, 10x-100x potential, monitor PEG' };
  if (de > 1.5 && eg > 20)                       return { category: 'Cyclical',      strategy: 'Time the cycle, buy at P/E peak, sell at P/E trough' };
  if (eg < 0 && de > 2)                          return { category: 'Turnaround',    strategy: 'High risk/reward, zero market correlation, catalyst needed' };
  return { category: 'Asset Play', strategy: 'Look for hidden assets, sum-of-parts valuation' };
}

// ─── Dalio All-Weather Allocation ─────────────────────────────────────────────
// 30% equities, 40% LT bonds, 15% IT bonds, 7.5% gold, 7.5% commodities
// Risk Parity: each asset contributes equal volatility
function dalioAllWeather() {
  return {
    equities:       { weight: 0.30, rationale: 'Rising growth environment' },
    ltBonds:        { weight: 0.40, rationale: 'Falling growth / deflation hedge' },
    itBonds:        { weight: 0.15, rationale: 'Intermediate duration buffer' },
    gold:           { weight: 0.075, rationale: 'Rising inflation hedge' },
    commodities:    { weight: 0.075, rationale: 'Rising inflation / supply shocks' },
    philosophy:     'Risk Parity: equal volatility contribution per asset class',
    indianProxy:    { nifty50: 0.30, gsec10y: 0.40, gsec5y: 0.15, goldbees: 0.075, commodityETF: 0.075 }
  };
}

// ─── Soros Reflexivity Score ──────────────────────────────────────────────────
// Detects self-reinforcing bubble/bust cycles
// High momentum + high valuation + rising volume = reflexive bubble forming
// Negative momentum + high valuation = reflexive bust risk
function sorosReflexivityScore(priceChange30d, peRatio, volumeChange, marketPeAvg=22) {
  let score = 0;
  const peBubble = peRatio > marketPeAvg * 1.5;  // 50% above market avg
  const momentumStrong = priceChange30d > 0.15;   // >15% in 30 days
  const volumeSurge = volumeChange > 0.5;          // >50% volume increase
  if (peBubble && momentumStrong && volumeSurge) {
    score = 8;  // Reflexive bubble — ride up, prepare to reverse
    return { score, signal: 'REFLEXIVE BUBBLE', action: 'Ride trend, set tight trailing stop, prepare short' };
  }
  if (peBubble && priceChange30d < -0.10) {
    score = -8; // Reflexive bust — self-reinforcing sell-off
    return { score, signal: 'REFLEXIVE BUST', action: 'Avoid, wait for capitulation, then buy' };
  }
  if (momentumStrong && !peBubble) {
    score = 4;
    return { score, signal: 'HEALTHY MOMENTUM', action: 'Buy with trailing stop' };
  }
  return { score: 0, signal: 'NEUTRAL', action: 'Wait for clearer signal' };
}

// ─── Paul Tudor Jones Risk Rules ─────────────────────────────────────────────
function ptjRiskCheck(position) {
  const warnings = [];
  if (position.isAveragingDown)    warnings.push('VIOLATION: Never average losers — exit or hold, never add');
  if (position.daysHeld > position.timeStopDays && position.pnlPct < 0.02)
    warnings.push('TIME STOP: Position stagnant — liquidate, redeploy capital');
  if (position.drawdownPct > 0.10) warnings.push('SCALE DOWN: Reduce size 50% during drawdown');
  if (position.dailyLossPct > 0.02) warnings.push('DAILY LIMIT: Stop trading today — circuit breaker triggered');
  if (position.stopMovedAway)      warnings.push('VIOLATION: Never move stop further away from entry');
  return {
    safe: warnings.length === 0,
    warnings,
    recommendation: warnings.length === 0 ? 'Position within risk parameters' : warnings[0]
  };
}

// ─── Comprehensive Fundamental Score (document-based) ────────────────────────
// Combines: Graham Number MoS, ROCE, TIE, PEG, Coffee Can, SMILE, QGLP
function comprehensiveFundamentalScore(stock) {
  const f = stock.fundamentals || {};
  let score = 0;
  const breakdown = {};

  // Graham Number Margin of Safety
  if (f.eps > 0 && f.book_value > 0) {
    const gn = Math.sqrt(22.5 * f.eps * f.book_value);
    const mos = (gn - (stock.base_price||0)) / (stock.base_price||1) * 100;
    breakdown.grahamMoS = +mos.toFixed(1);
    if (mos > 30) score += 20;
    else if (mos > 15) score += 12;
    else if (mos > 0) score += 6;
    else score -= 5;
  }

  // ROE (Buffett criterion: >15%)
  if (f.roe != null) {
    breakdown.roe = f.roe;
    if (f.roe >= 25) score += 20;
    else if (f.roe >= 15) score += 14;
    else if (f.roe >= 10) score += 7;
    else score -= 5;
  }

  // P/E (Graham criterion: <15 ideal, <25 acceptable)
  if (f.pe_ratio > 0) {
    breakdown.pe = f.pe_ratio;
    if (f.pe_ratio < 15) score += 20;
    else if (f.pe_ratio < 25) score += 12;
    else if (f.pe_ratio < 40) score += 5;
    else score -= 8;
  }

  // Earnings Growth (Lynch: >15% for Fast Grower)
  if (f.earnings_growth != null) {
    breakdown.earningsGrowth = f.earnings_growth;
    if (f.earnings_growth >= 25) score += 15;
    else if (f.earnings_growth >= 15) score += 10;
    else if (f.earnings_growth >= 8) score += 5;
    else score -= 3;
  }

  // Debt Safety (Graham: D/E < 0.5 ideal)
  if (f.debt_to_equity != null) {
    breakdown.debtToEquity = f.debt_to_equity;
    if (f.debt_to_equity <= 0.3) score += 15;
    else if (f.debt_to_equity <= 1.0) score += 8;
    else if (f.debt_to_equity <= 2.0) score += 3;
    else score -= 10;
  }

  // Dividend Yield (income component)
  if (f.dividend_yield != null) {
    breakdown.dividendYield = f.dividend_yield;
    if (f.dividend_yield >= 3) score += 10;
    else if (f.dividend_yield >= 1) score += 5;
  }

  // Coffee Can check
  const cc = coffeeCan(stock);
  breakdown.coffeeCan = cc.verdict;
  if (cc.qualifies) score += 10;

  // SMILE check
  const smile = smileScore(stock);
  breakdown.smile = smile.verdict;
  score += Math.round(smile.score * 0.1);

  // QGLP check
  const qglp = qglpScore(stock);
  breakdown.qglp = qglp.verdict;
  score += Math.round(qglp.score * 0.1);

  // Lynch category
  const lynch = lynchCategory(stock);
  breakdown.lynchCategory = lynch.category;
  if (lynch.category === 'Fast Grower') score += 5;
  if (lynch.category === 'Stalwart')    score += 3;

  const finalScore = Math.max(0, Math.min(100, score));
  const verdict = finalScore >= 75 ? 'STRONG BUY'
    : finalScore >= 60 ? 'BUY'
    : finalScore >= 45 ? 'HOLD'
    : finalScore >= 30 ? 'SELL'
    : 'STRONG SELL';

  return { score: finalScore, verdict, breakdown };
}

function calcSharpe(returns, rf=0.065) {
  if (returns.length < 2) return null;
  const mean = returns.reduce((a,b)=>a+b,0)/returns.length;
  const annRet = mean*252;
  const sd = Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/returns.length)*Math.sqrt(252);
  return sd>0 ? +((annRet-rf)/sd).toFixed(3) : null;
}

function calcSortino(returns, rf=0.065) {
  if (returns.length < 2) return null;
  const mean = returns.reduce((a,b)=>a+b,0)/returns.length;
  const annRet = mean*252;
  const downside = returns.filter(r=>r<0);
  if (!downside.length) return null;
  const dMean = downside.reduce((a,b)=>a+b,0)/downside.length;
  const dd = Math.sqrt(downside.reduce((a,b)=>a+(b-dMean)**2,0)/downside.length)*Math.sqrt(252);
  return dd>0 ? +((annRet-rf)/dd).toFixed(3) : null;
}

function pctChange(arr) {
  const out=[];
  for (let i=1; i<arr.length; i++) out.push((arr[i]-arr[i-1])/arr[i-1]);
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// ALL 30 FORMULAS — Standalone implementations
// ══════════════════════════════════════════════════════════════════════════════

// F1 — Percentage Return
function percentageReturn(pt, pt1) { return pt1 !== 0 ? (pt - pt1) / pt1 : 0; }

// F2 — Moving Average (already calcSMA above)
function movingAverage(prices, n) {
  if (prices.length < n) return null;
  return prices.slice(-n).reduce((a, b) => a + b, 0) / n;
}

// F3 — EMA (already calcEMA above, explicit version)
function ema(prices, n) {
  if (prices.length < n) return null;
  const k = 2 / (n + 1);
  let e = prices.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
}

// F4 — MACD (already calcMACD above)

// F5 — RSI (already calcRSI above)

// F6 — Momentum: (Pt / Pt-n) - 1
function momentum(prices, n = 63) {
  if (prices.length < n + 1) return null;
  const pt = prices[prices.length - 1];
  const ptn = prices[prices.length - 1 - n];
  return ptn !== 0 ? (pt / ptn) - 1 : 0;
}

// F7 — Volatility σ = √(Σ(Ri-μ)²/N)
function volatility(returns) {
  if (returns.length < 2) return null;
  const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mu) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

// F8 — Expected Return μ = ΣRi/N, annualised = μ×252
function expectedReturn(returns, annualise = true) {
  if (!returns.length) return null;
  const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
  return annualise ? mu * 252 : mu;
}

// F9 — Sharpe Ratio = (Rp - Rf) / σp  (already calcSharpe, explicit version)
function sharpeRatio(returns, rf = 0.065) {
  const mu = expectedReturn(returns, true);
  const sig = volatility(returns) * Math.sqrt(252);
  return sig > 0 ? (mu - rf) / sig : null;
}

// F10 — Drawdown = (Pt - Peak) / Peak
function maxDrawdown(prices) {
  let peak = prices[0], maxDD = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = peak > 0 ? (p - peak) / peak : 0;
    if (dd < maxDD) maxDD = dd;
  }
  return +maxDD.toFixed(6); // negative number
}

// F11 — CAGR = (Vf/Vi)^(1/n) - 1
function cagr(vi, vf, years) {
  if (vi <= 0 || years <= 0) return null;
  return Math.pow(vf / vi, 1 / years) - 1;
}

// F12 — Portfolio Return Rp = Σ(wi × Ri)
function portfolioReturn(weights, returns) {
  return weights.reduce((sum, w, i) => sum + w * (returns[i] || 0), 0);
}

// F13 — Portfolio Risk σp = √(wᵀΣw)
function portfolioRisk(weights, covMatrix) {
  const n = weights.length;
  let variance = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      variance += weights[i] * weights[j] * covMatrix[i][j];
  return Math.sqrt(Math.max(0, variance));
}

// F14 — Sigmoid σ(x) = 1 / (1 + e^-x)
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// F15 — NLP Sentiment Score = (TextBlobScore + KeywordScore) / 2
// Simulated: keyword-based scoring on news headlines
function nlpSentimentScore(text) {
  if (!text) return 0;
  const t = text.toLowerCase();
  const pos = ['buy','bullish','surge','rally','growth','profit','beat','strong','upgrade','positive','gain','record','high','outperform'];
  const neg = ['sell','bearish','crash','fall','loss','miss','weak','downgrade','negative','decline','low','underperform','risk','concern'];
  let textBlob = 0, keyword = 0;
  pos.forEach(w => { if (t.includes(w)) { textBlob += 0.1; keyword += 1; } });
  neg.forEach(w => { if (t.includes(w)) { textBlob -= 0.1; keyword -= 1; } });
  textBlob = Math.max(-1, Math.min(1, textBlob));
  keyword  = Math.max(-1, Math.min(1, keyword / 5));
  return (textBlob + keyword) / 2;
}

// F16 — NLP Impact Score = AvgSentiment × (1 + |AvgSentiment|) × 5
function nlpImpactScore(avgSentiment) {
  return avgSentiment * (1 + Math.abs(avgSentiment)) * 5;
}

// F17 — Confidence Score = 1 - Variance
function confidenceScore(values) {
  if (!values.length) return 0;
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mu) ** 2, 0) / values.length;
  return Math.max(0, Math.min(1, 1 - variance));
}

// F18 — Kelly Position Sizing: Edge = p - ((1-p)/R)
function kellyEdge(p, R) {
  if (R <= 0) return 0;
  return Math.max(0, p - (1 - p) / R);
}

// F19 — Covariance Cov(X,Y) = Σ[(Xi-μx)(Yi-μy)] / N
function covariance(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  return x.slice(0, n).reduce((sum, xi, i) => sum + (xi - mx) * (y[i] - my), 0) / n;
}

// F20 — Linear Regression y = β0 + β1x (OLS, single variable)
function linearRegression(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { beta0: 0, beta1: 0, r2: 0 };
  const mx = x.slice(0,n).reduce((a,b)=>a+b,0)/n;
  const my = y.slice(0,n).reduce((a,b)=>a+b,0)/n;
  let ssxy = 0, ssxx = 0, ssyy = 0;
  for (let i = 0; i < n; i++) {
    ssxy += (x[i]-mx)*(y[i]-my);
    ssxx += (x[i]-mx)**2;
    ssyy += (y[i]-my)**2;
  }
  const beta1 = ssxx !== 0 ? ssxy / ssxx : 0;
  const beta0 = my - beta1 * mx;
  const r2    = ssyy !== 0 ? (ssxy**2) / (ssxx * ssyy) : 0;
  return { beta0: +beta0.toFixed(6), beta1: +beta1.toFixed(6), r2: +r2.toFixed(4) };
}

// F21 — FinBERT Sentiment Logic: Positive→+score, Negative→-score, Neutral→0
function finbertSentiment(label, score) {
  if (label === 'positive') return +score;
  if (label === 'negative') return -score;
  return 0; // neutral
}

// F22 — AI Signal Score = TechnicalScore + MLScore + NewsImpactScore
function aiSignalScore(technicalScore, mlScore, newsImpactScore) {
  return technicalScore + mlScore + newsImpactScore;
}

// F23 — Equal Portfolio Weights = 1/n
function equalWeights(n) { return Array(n).fill(1 / n); }

// F24 — Portfolio Expected Return = weights · mean_returns
function portfolioExpectedReturn(weights, meanReturns) {
  return weights.reduce((sum, w, i) => sum + w * (meanReturns[i] || 0), 0);
}

// F25 — Portfolio Risk (same as F13, explicit)
function portfolioRiskF25(weights, covMatrix) { return portfolioRisk(weights, covMatrix); }

// F26 — ML Prediction = OLS regression predict on time-series
function mlPredict(closes, horizon = 5) {
  const n = closes.length;
  if (n < 10) return null;
  const x = Array.from({ length: n }, (_, i) => i);
  const reg = linearRegression(x, closes);
  const predicted = reg.beta0 + reg.beta1 * (n - 1 + horizon);
  const current = closes[n - 1];
  return {
    predicted: +predicted.toFixed(2),
    current: +current.toFixed(2),
    predictedReturn: +((predicted - current) / current * 100).toFixed(2),
    r2: reg.r2,
    trend: reg.beta1 > 0 ? 'UP' : 'DOWN'
  };
}

// F27 — NLP Confidence = 1 - sentiment_variance
function nlpConfidence(sentiments) {
  if (!sentiments.length) return 0;
  const mu = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
  const variance = sentiments.reduce((a, s) => a + (s - mu) ** 2, 0) / sentiments.length;
  return Math.max(0, Math.min(1, 1 - variance));
}

// F28 — Batch Sentiment Average = Σsentiments / n
function batchSentimentAvg(sentiments) {
  if (!sentiments.length) return 0;
  return sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
}

// F29 — Non-linear Impact Amplification = avg × (1 + |avg|)
function nonLinearImpact(avg) { return avg * (1 + Math.abs(avg)); }

// F30 — Trading Signal Logic
function tradingSignal(score) {
  if (score >= 4)  return 'STRONG BUY';
  if (score >= 2)  return 'BUY';
  if (score <= -4) return 'STRONG SELL';
  if (score <= -2) return 'SELL';
  return 'HOLD';
}

// ══════════════════════════════════════════════════════════════════════════════
// HYBRID AI SIGNAL ENGINE — Combines all 30 formulas into one unified score
// Output: score (-10 to +10), signal (F30), confidence (F17/F27), breakdown
// ══════════════════════════════════════════════════════════════════════════════
function hybridSignalEngine(candles, fundamentals = {}, newsHeadlines = []) {
  if (!candles || candles.length < 30) return null;

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume || 0);
  const n       = closes.length;
  const price   = closes[n - 1];
  const prev    = closes[n - 2] || price;

  // ── F1: Percentage Return ──────────────────────────────────────────────────
  const dailyRet = percentageReturn(price, prev);
  const returns  = pctChange(closes);                    // array of F1 values

  // ── F2/F3: SMA & EMA ──────────────────────────────────────────────────────
  const sma20  = movingAverage(closes, 20);
  const sma50  = movingAverage(closes, 50);
  const sma200 = movingAverage(closes, 200);
  const ema9   = ema(closes, 9);
  const ema12  = ema(closes, 12);
  const ema26  = ema(closes, 26);

  // ── F4: MACD ──────────────────────────────────────────────────────────────
  const macdR  = calcMACD(closes);

  // ── F5: RSI ───────────────────────────────────────────────────────────────
  const rsi    = calcRSI(closes);

  // ── F6: Momentum (63-day = ~3 months) ────────────────────────────────────
  const mom63  = momentum(closes, 63);
  const mom21  = momentum(closes, 21);

  // ── F7: Volatility ────────────────────────────────────────────────────────
  const vol    = volatility(returns);
  const volAnn = vol ? +(vol * Math.sqrt(252) * 100).toFixed(2) : null;

  // ── F8: Expected Return ───────────────────────────────────────────────────
  const expRet = expectedReturn(returns, true);

  // ── F9: Sharpe ────────────────────────────────────────────────────────────
  const sharpe = sharpeRatio(returns);

  // ── F10: Max Drawdown ─────────────────────────────────────────────────────
  const mdd    = maxDrawdown(closes);

  // ── F11: CAGR (using available history) ──────────────────────────────────
  const years  = n / 252;
  const cagrVal = years > 0.1 ? cagr(closes[0], price, years) : null;

  // ── F19: Covariance with itself (variance) ────────────────────────────────
  const selfCov = covariance(returns, returns);

  // ── NEW: Stochastic Oscillator ────────────────────────────────────────────
  const stoch = calcStochastic(highs, lows, closes);

  // ── NEW: ADX (trend strength) ─────────────────────────────────────────────
  const adxR = calcADX(highs, lows, closes);

  // ── NEW: OBV ──────────────────────────────────────────────────────────────
  const obvVal   = calcOBV(closes, volumes);
  const obvTrendR = obvTrend(closes, volumes);

  // ── NEW: Bollinger Band Width (squeeze) ───────────────────────────────────
  const bbWidth = bollingerBandWidth(closes);

  // ── NEW: ATR Trailing Stop ────────────────────────────────────────────────
  const atrVal  = calcATR(highs, lows, closes);
  const atrStop = atrVal ? atrTrailingStop(price, atrVal, 2) : null;

  // ── F20 / F26: Linear Regression ML Prediction ───────────────────────────
  const mlPred = mlPredict(closes, 5);

  // ── F15/F28: NLP Sentiment from news headlines ────────────────────────────
  const sentiments = newsHeadlines.map(h => nlpSentimentScore(h));
  const avgSentiment = sentiments.length ? batchSentimentAvg(sentiments) : 0; // F28

  // ── F16/F29: NLP Impact ───────────────────────────────────────────────────
  const nlpImpact = nlpImpactScore(avgSentiment);                              // F16
  const nlpAmpImpact = nonLinearImpact(avgSentiment);                          // F29

  // ── F17/F27: Confidence ───────────────────────────────────────────────────
  const nlpConf = nlpConfidence(sentiments.length ? sentiments : [0]);         // F27
  const techConf = confidenceScore([                                            // F17
    rsi != null ? rsi / 100 : 0.5,
    macdR.hist != null ? sigmoid(macdR.hist) : 0.5,
    sma20 ? (price > sma20 ? 0.8 : 0.2) : 0.5
  ]);

  // ── F14: Sigmoid normalisation for sub-scores ─────────────────────────────
  const sigRSI  = rsi != null ? sigmoid((rsi - 50) / 10) : 0.5;
  const sigMACD = macdR.hist != null ? sigmoid(macdR.hist * 10) : 0.5;
  const sigMom  = mom63 != null ? sigmoid(mom63 * 5) : 0.5;

  // ══════════════════════════════════════════════════════════════════════════
  // TECHNICAL SCORE (F22 component 1) — range -5 to +5
  // ══════════════════════════════════════════════════════════════════════════
  let techScore = 0;

  // RSI signal (F5)
  if (rsi != null) {
    if (rsi < 30)       techScore += 1.5;   // oversold → buy
    else if (rsi < 40)  techScore += 0.8;
    else if (rsi > 70)  techScore -= 1.5;   // overbought → sell
    else if (rsi > 60)  techScore -= 0.5;
    else                techScore += 0.3;   // neutral zone
  }

  // MACD signal (F4)
  if (macdR.macd != null && macdR.signal != null) {
    if (macdR.macd > macdR.signal && macdR.hist > 0) techScore += 1.5;
    else if (macdR.macd > macdR.signal)              techScore += 0.8;
    else if (macdR.macd < macdR.signal && macdR.hist < 0) techScore -= 1.5;
    else                                              techScore -= 0.5;
  }

  // MA alignment (F2/F3)
  if (sma20 && price > sma20)  techScore += 0.5;
  if (sma50 && price > sma50)  techScore += 0.5;
  if (sma200 && price > sma200) techScore += 0.8;  // golden cross zone
  if (sma50 && sma200 && sma50 > sma200) techScore += 0.5; // golden cross

  // Bollinger position
  const bollR = calcBollinger(closes);
  if (bollR.upper && bollR.lower && (bollR.upper - bollR.lower) > 0) {
    const pos = (price - bollR.lower) / (bollR.upper - bollR.lower);
    if (pos < 0.2)      techScore += 1.0;   // near lower band = oversold
    else if (pos < 0.4) techScore += 0.5;
    else if (pos > 0.8) techScore -= 1.0;   // near upper band = overbought
    else if (pos > 0.6) techScore -= 0.3;
  }

  // Momentum (F6)
  if (mom63 != null) {
    if (mom63 > 0.15)       techScore += 0.5;
    else if (mom63 > 0.05)  techScore += 0.8;
    else if (mom63 > 0)     techScore += 0.3;
    else if (mom63 < -0.15) techScore -= 0.8;
    else if (mom63 < 0)     techScore -= 0.3;
  }

  // Sharpe quality (F9)
  if (sharpe != null) {
    if (sharpe > 2)      techScore += 0.5;
    else if (sharpe > 1) techScore += 0.3;
    else if (sharpe < 0) techScore -= 0.3;
  }

  // Drawdown penalty (F10)
  if (mdd < -0.3)      techScore -= 0.5;
  else if (mdd < -0.2) techScore -= 0.2;

  // ── NEW: Stochastic Oscillator ────────────────────────────────────────────
  if (stoch.k != null) {
    if (stoch.k < 20)       techScore += 0.8;  // oversold
    else if (stoch.k < 30)  techScore += 0.4;
    else if (stoch.k > 80)  techScore -= 0.8;  // overbought
    else if (stoch.k > 70)  techScore -= 0.4;
    // %K crossing above %D = bullish signal
    if (stoch.k != null && stoch.d != null && stoch.k > stoch.d && stoch.k < 50) techScore += 0.5;
  }

  // ── NEW: ADX (trend strength confirmation) ────────────────────────────────
  if (adxR.adx != null) {
    if (adxR.adx > 25 && adxR.pdi > adxR.mdi) techScore += 0.8;  // strong uptrend
    if (adxR.adx > 25 && adxR.mdi > adxR.pdi) techScore -= 0.8;  // strong downtrend
    if (adxR.adx < 20) techScore *= 0.85; // weak trend — reduce confidence
  }

  // ── NEW: OBV divergence ───────────────────────────────────────────────────
  if (obvTrendR === 'accumulation') techScore += 0.6;
  if (obvTrendR === 'distribution') techScore -= 0.6;

  // ── NEW: Bollinger Band Width (squeeze = breakout imminent) ───────────────
  if (bbWidth != null && bbWidth < 2) techScore += 0.3; // squeeze = potential breakout

  techScore = Math.max(-5, Math.min(5, techScore));

  // ══════════════════════════════════════════════════════════════════════════
  // ML SCORE (F22 component 2, F26) — range -2 to +2
  // ══════════════════════════════════════════════════════════════════════════
  let mlScore = 0;

  // F26: Linear regression prediction
  if (mlPred) {
    const predRet = mlPred.predictedReturn;
    if (predRet > 3)       mlScore += 1.5;
    else if (predRet > 1)  mlScore += 0.8;
    else if (predRet > 0)  mlScore += 0.3;
    else if (predRet < -3) mlScore -= 1.5;
    else if (predRet < -1) mlScore -= 0.8;
    else                   mlScore -= 0.2;
    // R² quality weight
    mlScore *= (0.5 + mlPred.r2 * 0.5);
  }

  // F8: Expected return signal
  if (expRet != null) {
    if (expRet > 0.20)      mlScore += 0.5;
    else if (expRet > 0.10) mlScore += 0.3;
    else if (expRet < -0.10) mlScore -= 0.3;
  }

  // F11: CAGR signal
  if (cagrVal != null) {
    if (cagrVal > 0.20)      mlScore += 0.3;
    else if (cagrVal > 0.10) mlScore += 0.1;
    else if (cagrVal < 0)    mlScore -= 0.2;
  }

  mlScore = Math.max(-2, Math.min(2, mlScore));

  // ══════════════════════════════════════════════════════════════════════════
  // NEWS IMPACT SCORE (F22 component 3, F15/F16/F21/F29) — range -3 to +3
  // ══════════════════════════════════════════════════════════════════════════
  // F29 non-linear amplification, capped at ±3
  const newsImpactScore = Math.max(-3, Math.min(3, nlpAmpImpact * 3));

  // ══════════════════════════════════════════════════════════════════════════
  // F22: FINAL AI SIGNAL SCORE = TechnicalScore + MLScore + NewsImpactScore
  // ══════════════════════════════════════════════════════════════════════════
  const finalScore = +(techScore + mlScore + newsImpactScore).toFixed(3);

  // ── F30: Trading Signal ───────────────────────────────────────────────────
  const signal = tradingSignal(finalScore);

  // ── F18: Kelly Position Sizing ────────────────────────────────────────────
  // p = probability of win (sigmoid of finalScore), R = reward/risk ratio
  const pWin = sigmoid(finalScore);
  const rewardRisk = sharpe != null && sharpe > 0 ? Math.abs(sharpe) : 1;
  const kellyFraction = kellyEdge(pWin, rewardRisk);

  // ── Composite 0-100 score (for UI compatibility) ──────────────────────────
  // Map finalScore (-10 to +10) → (0 to 100)
  const score0to100 = Math.round(Math.max(0, Math.min(100, (finalScore + 10) / 20 * 100)));

  // ── F17: Overall confidence ───────────────────────────────────────────────
  const overallConfidence = +((techConf * 0.6 + nlpConf * 0.4)).toFixed(3);

  return {
    // Core signal
    finalScore,
    signal,
    score: score0to100,
    confidence: overallConfidence,
    kellyFraction: +kellyFraction.toFixed(4),

    // Technical breakdown
    techScore: +techScore.toFixed(3),
    mlScore:   +mlScore.toFixed(3),
    newsImpactScore: +newsImpactScore.toFixed(3),

    // F1-F11 values
    dailyReturn:    +(dailyRet * 100).toFixed(4),
    expectedReturn: expRet != null ? +(expRet * 100).toFixed(2) : null,
    volatilityAnn:  volAnn,
    sharpe,
    maxDrawdown:    +(mdd * 100).toFixed(2),
    cagrPct:        cagrVal != null ? +(cagrVal * 100).toFixed(2) : null,
    momentum63d:    mom63 != null ? +(mom63 * 100).toFixed(2) : null,
    momentum21d:    mom21 != null ? +(mom21 * 100).toFixed(2) : null,

    // Technical indicators
    rsi, sma20, sma50, sma200, ema9,
    macd: macdR.macd, macdSignal: macdR.signal, macdHist: macdR.hist,
    bollUpper: bollR.upper, bollMid: bollR.mid, bollLower: bollR.lower,
    atr: calcATR(highs, lows, closes),
    vwap: calcVWAP(highs, lows, closes, volumes),

    // NEW indicators from document
    stochK:   stoch.k,
    stochD:   stoch.d,
    adx:      adxR.adx,
    adxPDI:   adxR.pdi,
    adxMDI:   adxR.mdi,
    adxTrend: adxR.adx != null ? (adxR.adx > 25 ? (adxR.pdi > adxR.mdi ? 'UPTREND' : 'DOWNTREND') : 'RANGING') : null,
    obv:      obvVal,
    obvTrend: obvTrendR,
    bbWidth:  bbWidth,
    atrStop:  atrStop,

    // ML prediction (F26)
    mlPrediction: mlPred,

    // NLP (F15/F16/F17/F27/F28/F29)
    nlpSentiment:   +avgSentiment.toFixed(4),
    nlpImpact:      +nlpImpact.toFixed(4),
    nlpConfidence:  +nlpConf.toFixed(4),
    techConfidence: +techConf.toFixed(4),

    // 52W
    w52_high: +Math.max(...closes.slice(-252)).toFixed(2),
    w52_low:  +Math.min(...closes.slice(-252)).toFixed(2),
    from_52w_high_pct: +(((price - Math.max(...closes.slice(-252))) / Math.max(...closes.slice(-252))) * 100).toFixed(2),

    // Sortino
    sortino: calcSortino(returns),
    returns
  };
}

// ─── COMPOSITE SCORE (max 100) — legacy wrapper for backward compat ───────────
function compositeScore(ind) {
  // Uses F5/F4/F2/Bollinger/F6 sub-scores mapped to 0-100
  let sc = 0;
  const r = ind.rsi;
  if (r != null) sc += r >= 40 && r <= 60 ? 20 : r >= 30 && r < 40 ? 15 : r < 30 ? 12 : r <= 70 ? 10 : 3;
  const { macd: ml, signal: ms, hist: mh } = ind;
  if (ml != null && ms != null && mh != null) sc += ml > ms && mh > 0 ? 20 : ml > ms ? 14 : mh > 0 ? 8 : 0;
  const p = ind.price;
  for (const key of ['sma20', 'sma50', 'sma200']) {
    const v = ind[key]; if (p != null && v != null && p > v) sc += 10;
  }
  const { boll_upper: bu, boll_lower: bl } = ind;
  if (p != null && bu != null && bl != null && (bu - bl) > 0) {
    const pos = (p - bl) / (bu - bl);
    sc += pos <= 0.4 ? 15 : pos <= 0.6 ? 10 : 5;
  }
  const mom = ind.momentum_pct;
  if (mom != null) sc += mom >= 2 && mom <= 15 ? 15 : mom >= 0 && mom < 2 ? 10 : mom > 15 ? 5 : 3;
  return +Math.min(100, sc).toFixed(2);
}

function signalLabel(sc) {
  return sc >= 70 ? 'STRONG BUY' : sc >= 55 ? 'BUY' : sc >= 40 ? 'HOLD' : sc >= 30 ? 'NEUTRAL' : 'AVOID';
}

// ─── FULL SYMBOL ANALYSIS — uses Hybrid Engine (all 30 formulas) ──────────────
function analyzeSymbol(candles, symbol, livePrice = null, newsHeadlines = []) {
  if (!candles || candles.length < 30) return null;

  // Apply live price override to last candle
  if (livePrice && livePrice > 0) {
    candles = [...candles];
    candles[candles.length - 1] = { ...candles[candles.length - 1], close: livePrice };
  }

  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high  || c.close);
  const lows    = candles.map(c => c.low   || c.close);
  const volumes = candles.map(c => c.volume || 0);
  const price   = closes[closes.length - 1];
  const prev    = closes[closes.length - 2] || price;
  const chg     = (price - prev) / prev * 100;

  // Run the full 30-formula hybrid engine
  const hybrid = hybridSignalEngine(candles, {}, newsHeadlines);
  if (!hybrid) return null;

  // Build the full result object — all fields the frontend expects
  return {
    symbol,
    price:            +price.toFixed(2),
    prev_close:       +prev.toFixed(2),
    change_pct:       +chg.toFixed(2),

    // ── Hybrid engine outputs ──────────────────────────────────────────────
    finalScore:       hybrid.finalScore,
    signal:           hybrid.signal,
    score:            hybrid.score,           // 0-100 for UI bars
    confidence:       hybrid.confidence,
    kellyFraction:    hybrid.kellyFraction,

    // Score breakdown (F22 components)
    techScore:        hybrid.techScore,
    mlScore:          hybrid.mlScore,
    newsImpactScore:  hybrid.newsImpactScore,

    // ── F1-F11 ────────────────────────────────────────────────────────────
    dailyReturn:      hybrid.dailyReturn,
    expectedReturn:   hybrid.expectedReturn,
    vol_ann:          hybrid.volatilityAnn,
    sharpe:           hybrid.sharpe,
    sortino:          hybrid.sortino,
    maxDrawdown:      hybrid.maxDrawdown,
    cagrPct:          hybrid.cagrPct,
    momentum_pct:     hybrid.momentum63d,
    momentum21d:      hybrid.momentum21d,

    // ── Technical indicators ──────────────────────────────────────────────
    rsi:              hybrid.rsi,
    macd:             hybrid.macd,
    signal_line:      hybrid.macdSignal,
    hist:             hybrid.macdHist,
    sma20:            hybrid.sma20,
    sma50:            hybrid.sma50,
    sma200:           hybrid.sma200,
    ema9:             hybrid.ema9,
    boll_upper:       hybrid.bollUpper,
    boll_mid:         hybrid.bollMid,
    boll_lower:       hybrid.bollLower,
    atr:              calcATR(highs, lows, closes),
    vwap:             calcVWAP(highs, lows, closes, volumes),

    // ── ML prediction (F26) ───────────────────────────────────────────────
    mlPrediction:     hybrid.mlPrediction,

    // ── NLP (F15-F17, F27-F29) ────────────────────────────────────────────
    nlpSentiment:     hybrid.nlpSentiment,
    nlpImpact:        hybrid.nlpImpact,
    nlpConfidence:    hybrid.nlpConfidence,
    techConfidence:   hybrid.techConfidence,

    // ── 52W range ─────────────────────────────────────────────────────────
    w52_high:         hybrid.w52_high,
    w52_low:          hybrid.w52_low,
    from_52w_high_pct: hybrid.from_52w_high_pct,

    // ── NEW indicators from document ──────────────────────────────────────
    stochK:    hybrid.stochK,
    stochD:    hybrid.stochD,
    adx:       hybrid.adx,
    adxPDI:    hybrid.adxPDI,
    adxMDI:    hybrid.adxMDI,
    adxTrend:  hybrid.adxTrend,
    obv:       hybrid.obv,
    obvTrend:  hybrid.obvTrend,
    bbWidth:   hybrid.bbWidth,
    atrStop:   hybrid.atrStop,

    // ── Raw returns for MPT/VaR ───────────────────────────────────────────
    returns: hybrid.returns
  };
}

// ─── BLACK-SCHOLES + GREEKS ───────────────────────────────────────────────────
function bsPrice(S, K, T, r, sigma, type='call', q=0) {
  if (T<=0||sigma<=0) return Math.max(0, type==='call'?S-K:K-S);
  const Sa = S*Math.exp(-q*T);
  const d1 = (Math.log(Sa/K)+(r+0.5*sigma**2)*T)/(sigma*Math.sqrt(T));
  const d2 = d1-sigma*Math.sqrt(T);
  if (type==='call') return Sa*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2);
  return K*Math.exp(-r*T)*normCDF(-d2)-Sa*normCDF(-d1);
}

function bsGreeks(S, K, T, r, sigma, type='call', q=0) {
  if (T<=0) return {delta:0,gamma:0,theta:0,vega:0,rho:0};
  const Sa = S*Math.exp(-q*T);
  const d1 = (Math.log(Sa/K)+(r+0.5*sigma**2)*T)/(sigma*Math.sqrt(T));
  const d2 = d1-sigma*Math.sqrt(T);
  const nd1 = normPDF(d1);
  const gamma = nd1/(S*sigma*Math.sqrt(T));
  const vega  = Sa*nd1*Math.sqrt(T)/100;
  let delta, theta, rho;
  if (type==='call') {
    delta = Math.exp(-q*T)*normCDF(d1);
    theta = (-(Sa*nd1*sigma)/(2*Math.sqrt(T))-r*K*Math.exp(-r*T)*normCDF(d2)+q*Sa*normCDF(d1))/365;
    rho   = K*T*Math.exp(-r*T)*normCDF(d2)/100;
  } else {
    delta = Math.exp(-q*T)*(normCDF(d1)-1);
    theta = (-(Sa*nd1*sigma)/(2*Math.sqrt(T))+r*K*Math.exp(-r*T)*normCDF(-d2)-q*Sa*normCDF(-d1))/365;
    rho   = -K*T*Math.exp(-r*T)*normCDF(-d2)/100;
  }
  return {
    delta:+delta.toFixed(6), gamma:+gamma.toFixed(8),
    theta:+theta.toFixed(6), vega:+vega.toFixed(6), rho:+rho.toFixed(6)
  };
}

// IV sensitivity curve
function ivCurve(S, K, T, r, type, q, points=60) {
  const vols=[], prices=[];
  for (let i=0; i<=points; i++) {
    const v=0.05+i*(0.80-0.05)/points;
    vols.push(+(v*100).toFixed(1));
    prices.push(+bsPrice(S,K,T,r,v,type,q).toFixed(4));
  }
  return {vols,prices};
}

// Payoff diagrams
function payoffData(strategy, S, K1, K2, prem, points=200) {
  const xs=[], ys=[];
  for (let i=0; i<=points; i++) {
    const x = S*0.7 + i*(S*0.6)/points;
    let y;
    if (strategy==='Long Straddle')  y = Math.abs(x-K1)-prem;
    else if (strategy==='Long Strangle') y = Math.max(x-K2,0)+Math.max(K1-x,0)-prem;
    else if (strategy==='Iron Condor') {
      const gap=(K2-K1)/4, sp=K1+gap, bp=K1, sc=K2-gap, bc=K2;
      y = prem+(-Math.max(sp-x,0)+Math.max(bp-x,0)-Math.max(x-sc,0)+Math.max(x-bc,0));
    } else { // Butterfly
      const Km=(K1+K2)/2;
      y = (Math.max(x-K1,0)-2*Math.max(x-Km,0)+Math.max(x-K2,0))-prem;
    }
    xs.push(+x.toFixed(2)); ys.push(+y.toFixed(2));
  }
  return {xs,ys};
}

// ─── THREE-STAGE DCF + CAPM + WACC ───────────────────────────────────────────
function capmKe(rf, beta, erp) { return rf+beta*erp; }
function calcWACC(E, D, ke, kd, tax) { return (E/(E+D))*ke+(D/(E+D))*kd*(1-tax); }

function dcfThreeStage(fcfe0, gHigh, gStable, nHigh, nTrans, discount) {
  let pv=0, t=0, fcfe=fcfe0;
  const cashflows=[];
  for (let yr=1; yr<=nHigh; yr++) {
    fcfe*=(1+gHigh); t=yr;
    const pvYr=fcfe/Math.pow(1+discount,yr);
    pv+=pvYr;
    cashflows.push({year:yr,stage:'High Growth',g:+(gHigh*100).toFixed(1),fcfe:+fcfe.toFixed(2),pv:+pvYr.toFixed(2)});
  }
  for (let yt=1; yt<=nTrans; yt++) {
    const g=gHigh+(yt/nTrans)*(gStable-gHigh);
    fcfe*=(1+g); t+=1;
    const pvYr=fcfe/Math.pow(1+discount,t);
    pv+=pvYr;
    cashflows.push({year:t,stage:'Transition',g:+(g*100).toFixed(1),fcfe:+fcfe.toFixed(2),pv:+pvYr.toFixed(2)});
  }
  let tv=0;
  if (discount>gStable) {
    const termCF=fcfe*(1+gStable);
    tv=termCF/(discount-gStable);
    const pvTv=tv/Math.pow(1+discount,t);
    pv+=pvTv;
    cashflows.push({year:'TV',stage:'Terminal Value',g:+(gStable*100).toFixed(1),fcfe:+tv.toFixed(2),pv:+pvTv.toFixed(2)});
  }
  return {totalPV:+pv.toFixed(2), terminalValue:+tv.toFixed(2), cashflows};
}

// ─── MPT — EFFICIENT FRONTIER (Monte Carlo) ───────────────────────────────────
function efficientFrontier(returnsMatrix, symbols, nSim=3000, rf=0.065) {
  // returnsMatrix: array of arrays, each inner = daily returns for one stock
  const n = symbols.length;
  if (n<2) return {portfolios:[],optimal:null};

  // Annualised returns and covariance
  const annRet = returnsMatrix.map(r => {
    const mean=r.reduce((a,b)=>a+b,0)/r.length;
    return mean*252;
  });

  // Covariance matrix
  const means = returnsMatrix.map(r=>r.reduce((a,b)=>a+b,0)/r.length);
  const cov = Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>{
    const ri=returnsMatrix[i], rj=returnsMatrix[j];
    const len=Math.min(ri.length,rj.length);
    let c=0;
    for (let k=0;k<len;k++) c+=(ri[k]-means[i])*(rj[k]-means[j]);
    return (c/len)*252;
  }));

  const portfolios=[];
  let bestSharpe=-Infinity, optimal=null;

  // Dirichlet-like random weights
  for (let s=0; s<nSim; s++) {
    const raw=Array.from({length:n},()=>-Math.log(Math.random()+1e-10));
    const sum=raw.reduce((a,b)=>a+b,0);
    const w=raw.map(x=>x/sum);
    const ret=w.reduce((a,wi,i)=>a+wi*annRet[i],0);
    let variance=0;
    for (let i=0;i<n;i++) for (let j=0;j<n;j++) variance+=w[i]*w[j]*cov[i][j];
    const vol=Math.sqrt(Math.max(0,variance));
    const sharpe=vol>0?(ret-rf)/vol:0;
    const p={ret:+ret.toFixed(4),vol:+vol.toFixed(4),sharpe:+sharpe.toFixed(4),weights:w.map(x=>+x.toFixed(4))};
    portfolios.push(p);
    if (sharpe>bestSharpe) { bestSharpe=sharpe; optimal=p; }
  }

  // Per-stock stats
  const stockStats=symbols.map((sym,i)=>{
    const r=returnsMatrix[i];
    const mean=r.reduce((a,b)=>a+b,0)/r.length;
    const annR=mean*252;
    const sd=Math.sqrt(r.reduce((a,b)=>a+(b-mean)**2,0)/r.length)*Math.sqrt(252);
    return {symbol:sym,annRet:+(annR*100).toFixed(2),annVol:+(sd*100).toFixed(2),
      sharpe:calcSharpe(r,rf),sortino:calcSortino(r,rf),
      optimalWeight:optimal?+(optimal.weights[i]*100).toFixed(2):0};
  });

  // Correlation matrix
  const corr=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>{
    const ri=returnsMatrix[i],rj=returnsMatrix[j];
    const len=Math.min(ri.length,rj.length);
    const mi=ri.reduce((a,b)=>a+b,0)/ri.length;
    const mj=rj.reduce((a,b)=>a+b,0)/rj.length;
    let num=0,di=0,dj=0;
    for (let k=0;k<len;k++){num+=(ri[k]-mi)*(rj[k]-mj);di+=(ri[k]-mi)**2;dj+=(rj[k]-mj)**2;}
    const denom=Math.sqrt(di*dj);
    return denom>0?+(num/denom).toFixed(3):0;
  }));

  return {portfolios,optimal,stockStats,symbols,corr};
}

// ─── VaR — THREE METHODS ──────────────────────────────────────────────────────
function varVC(returns, conf=0.95, h=1) {
  const n=returns.length;
  const mean=returns.reduce((a,b)=>a+b,0)/n*h;
  const sd=Math.sqrt(returns.reduce((a,b)=>a+(b-mean/h)**2,0)/n)*Math.sqrt(h);
  return +(-(mean+normPPF(1-conf)*sd)).toFixed(6);
}

function varHS(returns, conf=0.95, h=1) {
  const sorted=[...returns].sort((a,b)=>a-b);
  const idx=Math.floor((1-conf)*sorted.length);
  return +(-sorted[idx]*Math.sqrt(h)).toFixed(6);
}

function varMC(returns, conf=0.95, h=1, n=10000) {
  const mean=returns.reduce((a,b)=>a+b,0)/returns.length*h;
  const sd=Math.sqrt(returns.reduce((a,b)=>a+(b-mean/h)**2,0)/returns.length)*Math.sqrt(h);
  const sims=Array.from({length:n},()=>{
    // Box-Muller
    const u1=Math.random()||1e-10, u2=Math.random();
    const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
    return mean+sd*z;
  }).sort((a,b)=>a-b);
  return +(-sims[Math.floor((1-conf)*n)]).toFixed(6);
}

function rollingVaR(returns, window=60, conf=0.95) {
  const out=[];
  for (let i=window; i<=returns.length; i++) {
    out.push(+(varHS(returns.slice(i-window,i),conf)*100).toFixed(4));
  }
  return out;
}

// ─── TAX ENGINE (India 2024-2026) ─────────────────────────────────────────────
function calcTax(asset, buyPrice, sellPrice, qty, holdDays, slab=30) {
  const gross=(sellPrice-buyPrice)*qty;
  let tax=0, taxType='';
  if (asset==='listed_equity'||asset==='equity_mf') {
    if (holdDays<=365) {
      tax=gross>0?gross*0.20:0; taxType='STCG @ 20%';
    } else {
      const taxable=Math.max(0,gross-125000);
      tax=taxable*0.125; taxType='LTCG @ 12.5% (₹1.25L exempt)';
    }
  } else {
    tax=gross>0?gross*(slab/100):0; taxType=`Slab Rate @ ${slab}%`;
  }
  const stcgTax=gross>0?gross*0.20:0;
  const ltcgTax=Math.max(0,gross-125000)*0.125;
  return {
    gross:+gross.toFixed(2), tax:+tax.toFixed(2),
    net:+(gross-tax).toFixed(2), taxType,
    effTaxPct:gross>0?+(tax/gross*100).toFixed(2):0,
    stcgTax:+stcgTax.toFixed(2), ltcgTax:+ltcgTax.toFixed(2),
    holdingSaving:+(stcgTax-ltcgTax).toFixed(2)
  };
}

function taxHarvesting(realisedGain, unrealisedLoss) {
  const netGain=Math.max(0,realisedGain-unrealisedLoss);
  const before=realisedGain*0.20;
  const after=netGain*0.20;
  return {before:+before.toFixed(2),after:+after.toFixed(2),saved:+(before-after).toFixed(2),netGain:+netGain.toFixed(2)};
}

module.exports = {
  // ── All 30 original formula functions ─────────────────────────────────────
  percentageReturn, movingAverage, ema, momentum,
  volatility, expectedReturn, sharpeRatio, maxDrawdown, cagr,
  portfolioReturn, portfolioRisk, sigmoid,
  nlpSentimentScore, nlpImpactScore, confidenceScore, kellyEdge,
  covariance, linearRegression, finbertSentiment, aiSignalScore,
  equalWeights, portfolioExpectedReturn, portfolioRiskF25,
  mlPredict, nlpConfidence, batchSentimentAvg, nonLinearImpact, tradingSignal,

  // ── NEW from Comprehensive Analysis Document ───────────────────────────────
  typicalPrice, weightedClose,
  calcStochastic, calcADX, calcOBV, obvTrend, bollingerBandWidth,
  calcROCE, calcTreynor, calcPEG, pegSignal,
  calcTIE, calcDIR,
  atrTrailingStop, positionSize1PctRule,
  greenblatEarningsYield, greenblatROC, magicFormulaScore,
  coffeeCan, smileScore, qglpScore, lynchCategory,
  dalioAllWeather, sorosReflexivityScore, ptjRiskCheck,
  comprehensiveFundamentalScore,

  // ── Hybrid engine ─────────────────────────────────────────────────────────
  hybridSignalEngine,

  // ── Technical indicators ──────────────────────────────────────────────────
  calcRSI, calcEMA, calcSMA, calcMACD, calcBollinger, calcATR, calcVWAP,
  calcSharpe, calcSortino, pctChange,
  compositeScore, signalLabel, analyzeSymbol,

  // ── Options ───────────────────────────────────────────────────────────────
  bsPrice, bsGreeks, ivCurve, payoffData,

  // ── DCF ───────────────────────────────────────────────────────────────────
  capmKe, calcWACC, dcfThreeStage,

  // ── MPT ───────────────────────────────────────────────────────────────────
  efficientFrontier,

  // ── VaR ───────────────────────────────────────────────────────────────────
  varVC, varHS, varMC, rollingVaR,

  // ── Tax ───────────────────────────────────────────────────────────────────
  calcTax, taxHarvesting,

  // ── Math helpers ──────────────────────────────────────────────────────────
  normCDF, normPDF, normPPF
};
