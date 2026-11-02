// ask-engine.mjs — the BTC Rainbow Ask router. DETERMINISTIC ONLY.
// No LLM, no network, no randomness: the same words in always get the
// same kind of answer out, built from the same chart data object the
// site and the MCP tools use (rainbow-core's buildData shape).
//
// Used three ways, one source of truth:
//   1. ask.html inlines a copy of routeAsk (see SYNC NOTE in ask.html);
//      the node harness (test-ask.mjs) diffs the two so they cannot drift.
//   2. worker/ask-worker.mjs imports this file for POST /api/ask.
//   3. test-ask.mjs drives it directly against the baked snapshot.
//
// Verdict-free discipline: this engine explains and shows the past.
// It never says buy or sell, never predicts, never advises. A question
// that asks for advice or a forecast gets the "advice" answer: a plain
// no, today's measured facts, and the honesty closer.
// Every data answer ends: "That is the past. Not a promise."
//
// Counts: routeAsk returns an `intent` — one of INTENTS below. That
// word, and only that word, is what the counts store ever sees.

export const INTENTS = ["today", "dca", "explain", "buy_ways", "advice", "none", "greeting", "site", "math", "crash"];

export const CLOSER = "That is the past. Not a promise.";

export function fmtUSD(x) {
  return "$" + Math.round(x).toLocaleString("en-US");
}

export function fmtBTC(x) {
  return String(parseFloat(x.toFixed(6)));
}

function norm(q) {
  return " " + String(q || "").toLowerCase().replace(/[^a-z0-9$.\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
}

function has(q, ...words) {
  return words.some((w) => q.includes(w));
}

// --- DCA parsing -----------------------------------------------------
// Amount: first $ amount, or first bare number next to a money word.
// Cadence: "a month / monthly" converts to a weekly amount (x12/52),
// because the chart data holds weekly-buy units only.
// Span: 1, 3, or 5 years — the only spans the data holds. Any other
// span (or none) runs 3 years and says so up front.
const YEAR_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };

export function parseDca(q) {
  let amount = null;
  const m = q.match(/\$\s*(\d+(?:\.\d+)?)/) || q.match(/\b(\d+(?:\.\d+)?)\s*(?:dollars|bucks|usd)\b/);
  if (m) amount = parseFloat(m[1]);
  let perMonth = false;
  if (has(q, " a month ", " per month ", " monthly ", "/month")) perMonth = true;
  let years = null;
  const ym = q.match(/\b(\d+)\s*(?:years|year|yrs|yr)\b/) || q.match(/\b(one|two|three|four|five|ten)\s*(?:years|year)\b/);
  if (ym) years = YEAR_WORDS[ym[1]] || parseInt(ym[1], 10);
  if (amount === null) {
    const bare = q.match(/\bput in\s+(\d+(?:\.\d+)?)\b/) || q.match(/\binvest\s+(\d+(?:\.\d+)?)\b/);
    if (bare) amount = parseFloat(bare[1]);
  }
  return { amount, perMonth, years };
}

function dcaAnswer(data, q) {
  const { amount, perMonth, years } = parseDca(q);
  const notes = [];
  let weekly = amount === null ? 25 : amount;
  if (amount === null) notes.push("Here is $25 a week.");
  if (perMonth) {
    // Round to whole dollars so the words and the math agree exactly:
    // the label says $23 a week, so the sim runs $23 a week.
    weekly = Math.max(1, Math.round((weekly * 12) / 52));
    notes.push(`That is about ${fmtUSD(weekly)} a week.`);
  }
  let span = years;
  if (span !== 1 && span !== 3 && span !== 5) {
    if (years !== null) notes.push("I run 1, 3, or 5 years. Here is 3 years.");
    span = 3;
  }
  if (!(weekly > 0) || weekly > 100000) {
    return { intent: "dca", text: "Pick an amount over $0. Then I can run the past for you. " + CLOSER };
  }
  const unit = (data.dca || []).find((u) => u.years === span);
  if (!unit) return { intent: "none", text: NONE_TEXT };
  const putIn = weekly * unit.buys;
  const btc = weekly * unit.btcPerDollar;
  const worth = btc * data.spot.price;
  const amtLabel = Number.isInteger(weekly) ? `$${weekly}` : fmtUSD(weekly);
  const text =
    (notes.length ? notes.join(" ") + " " : "") +
    `${amtLabel} a week for ${span} year${span > 1 ? "s" : ""}. ` +
    `You would have put in ${fmtUSD(putIn)}. ` +
    `All those buys added up to ${fmtBTC(btc)} bitcoin. ` +
    `It would be worth ${fmtUSD(worth)} today. ` +
    CLOSER;
  return {
    intent: "dca",
    text,
    structured: { amount_per_week_usd: Math.round(weekly * 100) / 100, years: span, buys: unit.buys, put_in_usd: Math.round(putIn), worth_usd: Math.round(worth) },
  };
}

// --- Today -----------------------------------------------------------
function todayAnswer(data) {
  const t = data.today;
  const st = t.bandIndex >= 0 && t.bandIndex < data.bandStats.length ? data.bandStats[t.bandIndex] : null;
  let text = data.todayText + ` The line sits at ${fmtUSD(t.trend)} today.`;
  if (t.band) text += ` ${t.band.name}: ${t.band.kid}`;
  if (st) text += ` About ${Math.round(st.pct)} of 100 days sat in this band.`;
  text += " " + CLOSER;
  return {
    intent: "today",
    text,
    structured: {
      price_usd: Math.round(t.price),
      trend_usd: Math.round(t.trend),
      band: t.band ? t.band.name : t.bandIndex < 0 ? "Below Deep Blue" : "Above Red",
      as_of: new Date(t.ts * 1000).toISOString(),
    },
  };
}

// --- Explain ---------------------------------------------------------
const WHAT_IS_BITCOIN =
  "Bitcoin is money on the web. No bank runs it. " +
  "Only 21 million will ever be made. People trade it day and night.";

function explainAnswer(data, topic) {
  if (topic === "bitcoin") return { intent: "explain", text: WHAT_IS_BITCOIN + " " + CLOSER };
  const text = data.texts && data.texts[topic];
  if (!text) return { intent: "none", text: NONE_TEXT };
  let out = text;
  if (out.endsWith(CLOSER)) return { intent: "explain", text: out, structured: { topic } };
  if (topic === "price") out += ` Right now, it costs ${fmtUSD(data.spot.price)}.`;
  return { intent: "explain", text: out + " " + CLOSER, structured: { topic } };
}

// --- No match --------------------------------------------------------
export const NONE_TEXT =
  "I do not know that one yet. I can do three things well. " +
  "One: where bitcoin stands today. " +
  "Two: what a weekly buy did in the past. " +
  "Three: the plain words, and how people buy it. " +
  "Tap one below, or ask in new words.";

// --- Conversation basics (sweep fix, Nov 1, 2026) --------------------
// Greetings, "what is this site", and tiny sums used to fall through to
// the no-match answer. They get short, honest answers first, then the
// site's real job below still runs exactly as before.
const GREETINGS = new Set([
  "sup", "hi", "hello", "hey", "yo", "hiya", "hi there", "hello there",
  "hey there", "good morning", "good afternoon", "good evening",
  "what's up", "whats up",
]);

function mathAnswer(rawQ) {
  const m = String(rawQ || "").match(/(\d+(?:\.\d+)?)\s*([+\-*\/x×])\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[3]), op = m[2].toLowerCase();
  if (op === "/" && b === 0) {
    return { intent: "math", text: "That one divides by zero, so it has no answer. Ask me a chart question, or try a new sum." };
  }
  const r = op === "+" ? a + b : op === "-" ? a - b : op === "/" ? a / b : a * b;
  const word = op === "+" ? "plus" : op === "-" ? "minus" : op === "/" ? "divided by" : "times";
  const out = String(parseFloat(r.toFixed(6)));
  return { intent: "math", text: `${m[1]} ${word} ${m[3]} is ${out}.` };
}

function fmtDay(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// --- Past falls --------------------------------------------------------
// Grounded only in the site's own numbers: data.drawdowns when the page
// supplies it (the daily-close table the homepage lab chart draws), else
// measured from data.points, the chart's own price series.
function crashAnswer(data, q) {
  const ym = q.match(/\b(19|20)\d{2}\b/);
  const year = ym ? parseInt(ym[0], 10) : null;
  const dds = Array.isArray(data.drawdowns) ? data.drawdowns : null;
  if (dds && dds.length) {
    let d = null;
    if (year !== null) {
      d = dds.find((x) => {
        const py = parseInt(String(x.peakDate).slice(0, 4), 10);
        const ty = parseInt(String(x.troughDate).slice(0, 4), 10);
        return ty === year || py === year;
      }) || null;
    } else {
      d = dds.reduce((a, b) => (b.depthPct > a.depthPct ? b : a), dds[0]);
    }
    if (!d) return null;
    const name = year !== null ? `The ${year} fall` : "The biggest fall on this chart";
    const plainDay = (s) => fmtDay(Date.parse(s + "T00:00:00Z") / 1000);
    let text =
      `${name}: bitcoin topped at ${fmtUSD(d.peakPrice)} on ${plainDay(d.peakDate)}. ` +
      `It bottomed at ${fmtUSD(d.troughPrice)} on ${plainDay(d.troughDate)} — down ${d.depthPct}%. ` +
      (d.recoveredDate
        ? `It passed that top again on ${plainDay(d.recoveredDate)}. `
        : "It has not passed that top again yet. ") +
      CLOSER;
    return { intent: "crash", text, structured: { peak_date: d.peakDate, trough_date: d.troughDate, drop_pct: d.depthPct } };
  }
  if (year === null || !Array.isArray(data.points) || !data.points.length) return null;
  const yr = (ts) => new Date(ts * 1000).getUTCFullYear();
  const before = data.points.filter((p) => yr(p[0]) >= year - 1 && yr(p[0]) <= year);
  if (!before.length) return null;
  const peak = before.reduce((a, b) => (b[1] > a[1] ? b : a), before[0]);
  const after = data.points.filter((p) => p[0] >= peak[0] && yr(p[0]) <= year + 1);
  if (after.length < 2) return null;
  const trough = after.reduce((a, b) => (b[1] < a[1] ? b : a), after[0]);
  const drop = Math.round((1 - trough[1] / peak[1]) * 1000) / 10;
  if (!(drop > 0)) return null;
  const text =
    `The ${year} fall, measured on this chart: bitcoin topped at ${fmtUSD(peak[1])} on ${fmtDay(peak[0])}. ` +
    `It bottomed at ${fmtUSD(trough[1])} on ${fmtDay(trough[0])} — down ${drop}%. ` +
    CLOSER;
  return { intent: "crash", text, structured: { peak_date: fmtDay(peak[0]), trough_date: fmtDay(trough[0]), drop_pct: drop } };
}

// --- The router ------------------------------------------------------
// Order is the discipline:
//   1. advice / forecast asks — declined plainly, facts offered.
//   2. how people buy — before "buy" can trip anything else.
//   3. weekly-buy math — needs a $ amount, a cadence, or a span.
//   4. plain-word explainers — what / mean / explain.
//   5. where it stands today — the default fact question.
//   6. none — says so plainly, offers the three things.
export function routeAsk(data, rawQ) {
  const q = norm(rawQ);
  if (!q.trim()) return { intent: "none", text: NONE_TEXT };

  // 0. Conversation basics: greet back, say what this site is, do a
  // tiny sum. (Crash questions sit below advice, so a "should I buy
  // after the crash" ask still gets the plain no first.)
  if (GREETINGS.has(q.trim())) {
    return {
      intent: "greeting",
      text: "Hi. Good to see you. Ask me where bitcoin stands today, what a past fall looked like, or what a weekly buy did in the past.",
    };
  }
  if (
    has(q,
      " what is this site", " what is this place", " what does this site do",
      " what is this page", " what do you do", " who are you",
      " what can you do", " what can i ask")
  ) {
    return {
      intent: "site",
      text: "This site shows sixteen years of bitcoin climbs and crashes, in words anyone can read. " +
        "One chart holds every day since 2010. I can tell you where bitcoin stands today, " +
        "how big a past fall was, and what a weekly buy did in the past. " + CLOSER,
    };
  }
  const math = mathAnswer(rawQ);
  if (math) return math;

  // 1. Advice or a forecast: never answered with a verdict.
  if (
    has(q,
      " should i ", " should we ", " good time ", " bad time ", " worth buying ",
      " will it go ", " will bitcoin go ", " will the price ", " will it rise ",
      " will it fall ", " will it drop ", " predict", " forecast", " advice",
      " advise", " recommend", " tell me to buy", " tell me to sell",
      " going to go up", " going to go down", " price in 2030", " price next ",
      " make me rich", " get rich", " a good buy", " safe bet ")
  ) {
    const t = todayAnswer(data);
    return {
      intent: "advice",
      text: "I do not give advice. I show facts from the past. " + t.text,
      structured: t.structured,
    };
  }

  // 1b. A past fall, measured from the site's own data.
  if (
    /\b(19|20)\d{2}\b/.test(q) && has(q, " crash", " fall", " fell", " drop", " bear market", " drawdown") ||
    has(q, " crash", " bear market", " drawdown", " biggest fall", " worst fall")
  ) {
    const crash = crashAnswer(data, q);
    if (crash) return crash;
  }

  // 2. How people buy it (information, not advice).
  if (
    has(q,
      " how do people buy", " how can i buy", " how do i buy", " how to buy",
      " where can i buy", " where do people buy", " ways to buy", " ibit",
      " exchange app", " buy it ", " buy bitcoin", " buy some", " hold it",
      " hold bitcoin", " keep the keys", " wallet")
  ) {
    return { intent: "buy_ways", text: data.texts.ways_to_buy + " " + CLOSER, structured: { topic: "ways_to_buy" } };
  }

  // 3. Weekly-buy math.
  const looksDca =
    has(q, " a week", " per week", " weekly", " a month", " per month", " monthly",
      " put in", " dca", " dollar cost", " each week", " every week", " invest") &&
    (/\d/.test(q) || has(q, " put in", " dca", " dollar cost"));
  if (looksDca || (/\$\s*\d/.test(q) && has(q, " if "))) {
    return dcaAnswer(data, q);
  }

  // 4. Plain words.
  if (has(q, " rainbow", " growth chart")) return explainAnswer(data, "rainbow");
  if (has(q, " technical")) return explainAnswer(data, "technical");
  if (has(q, " fundamental")) return explainAnswer(data, "fundamental");
  if (has(q, " what is bitcoin", " what's bitcoin", " plain words", " plain english", " explain bitcoin", " tell me about bitcoin", " what is it", " what is btc")) {
    return explainAnswer(data, "bitcoin");
  }
  if (has(q, " what does price mean", " price mean", " what is price", " what is the price tag")) {
    return explainAnswer(data, "price");
  }
  if (has(q, " explain", " what does", " what is", " meaning of") && has(q, " chart")) {
    return explainAnswer(data, "rainbow");
  }

  // 5. Where it stands today.
  if (
    has(q,
      " today", " now", " stand", " price", " cost", " band", " chart say",
      " where is bitcoin", " where are we", " how much is", " doing")
  ) {
    return todayAnswer(data);
  }

  // 6. No match.
  return { intent: "none", text: NONE_TEXT };
}

// =====================================================================
// V2 — SNAPSHOT EXTENSION (staging, Lane B, 2026-11-01)
// routeAsk above is UNTOUCHED. routeAskV2(data, snapshot, q) adds new
// intents answered ONLY from the snapshot object (the deep technical +
// fundamental snapshot the worker serves from KV `snap:current`).
// Same discipline: deterministic only, no LLM, verdict-free, never a
// buy/sell word as a recommendation, never a prediction. Every data
// answer ends with the CLOSER. If a needed snapshot field is null or
// missing, the answer says plainly that the reading is not available
// right now — it never invents a number. Every number below comes
// from `data` or `snapshot` (or plain arithmetic on those numbers).
// Questions V2 does not claim fall through to routeAsk untouched, so
// greeting / site / math / today / dca / explain / buy_ways / advice /
// crash / none behave exactly as before.
// =====================================================================

export const INTENTS_V2 = [
  ...INTENTS,
  "rsi", "mayer", "movingavg", "drawdown", "volatility", "halving",
  "hashrate", "fees", "feargreed", "dominance", "forecast",
];

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const fmt1 = (x) => String(parseFloat(x.toFixed(1)));
const fmtInt = (x) => Math.round(x).toLocaleString("en-US");

function fmtBigUSD(x) {
  if (x >= 1e12) return "$" + parseFloat((x / 1e12).toFixed(2)) + " trillion";
  if (x >= 1e9) return "$" + parseFloat((x / 1e9).toFixed(2)) + " billion";
  return fmtUSD(x);
}

// Snapshot dates arrive as "YYYY-MM-DD" strings (or unix seconds).
// Format them in the site's plain style; pass anything else through.
function fmtSnapDate(v) {
  if (isNum(v)) return fmtDay(v);
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(v || "");
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function notAvailable(intent, what) {
  return {
    intent,
    text:
      `That reading is not available right now. The snapshot does not carry ${what} at the moment. ` +
      `Try again later, or ask where bitcoin stands today. ` + CLOSER,
    structured: { available: false },
  };
}

function snapSpot(snapshot, data) {
  if (snapshot && isNum(snapshot.spot)) return snapshot.spot;
  if (snapshot && snapshot.spot && isNum(snapshot.spot.price)) return snapshot.spot.price;
  if (data && data.spot && isNum(data.spot.price)) return data.spot.price;
  return null;
}

function snapFit(snapshot) {
  const r = snapshot && snapshot.rainbow;
  const fit = r && r.fit ? r.fit : r;
  return fit && isNum(fit.a) && isNum(fit.b) ? fit : null;
}

// --- Rainbow model math ----------------------------------------------
// Identical math to shared/rainbow-core.mjs trendAt / bandEdgeAt
// (GENESIS Jan 3 2009, BAND_BOTTOM -0.75, BAND_WIDTH 0.3), carried
// locally so this file stays self-contained for ask.html's inlined
// copy, exactly like routeAsk. test-ask-v2.mjs cross-checks every
// forecast number below against rainbow-core itself.
const V2_GENESIS_TS = Date.UTC(2009, 0, 3) / 1000;
function trendAt(fit, ts) {
  const days = (ts - V2_GENESIS_TS) / 86400;
  return Math.exp(fit.a + fit.b * Math.log(days));
}
function bandEdgeAt(fit, ts, k) {
  return trendAt(fit, ts) * Math.exp(-0.75 + 0.3 * k);
}

// --- The new answers ---------------------------------------------------

function rsiAnswer(snapshot) {
  const v = snapshot && snapshot.indicators && snapshot.indicators.rsi14;
  if (!isNum(v)) return notAvailable("rsi", "an RSI reading");
  const zone = v < 30 ? "at the cold end" : v > 70 ? "at the hot end" : "in the middle range";
  const text =
    `The RSI is ${fmt1(v)}. RSI runs from 0 to 100 and reads the last 14 days. ` +
    `Under 30 is the cold end. Over 70 is the hot end, the end traders call overbought. ` +
    `Today it sits ${zone}. ` + CLOSER;
  return { intent: "rsi", text, structured: { rsi14: v } };
}

function mayerAnswer(data, snapshot) {
  const ind = (snapshot && snapshot.indicators) || {};
  const spot = snapSpot(snapshot, data);
  let v = isNum(ind.mayer) ? ind.mayer : null;
  if (v === null && isNum(spot) && isNum(ind.ma200) && ind.ma200 > 0) v = spot / ind.ma200;
  if (v === null) return notAvailable("mayer", "a Mayer multiple");
  let text =
    `The Mayer multiple is ${v.toFixed(2)}. It is the price split by the 200-day average. `;
  if (isNum(spot) && isNum(ind.ma200)) {
    text += `One bitcoin costs ${fmtUSD(spot)}. The 200-day average is ${fmtUSD(ind.ma200)}. `;
    text += v < 1
      ? "So the price sits under its own 200-day average. "
      : "So the price sits over its own 200-day average. ";
  }
  text += CLOSER;
  return { intent: "mayer", text, structured: { mayer: parseFloat(v.toFixed(4)) } };
}

function movingAvgAnswer(snapshot) {
  const ind = (snapshot && snapshot.indicators) || {};
  if (!isNum(ind.ma50) && !isNum(ind.ma200)) return notAvailable("movingavg", "the moving averages");
  const parts = [];
  if (isNum(ind.ma50)) parts.push(`The 50-day average is ${fmtUSD(ind.ma50)}.`);
  if (isNum(ind.ma200)) parts.push(`The 200-day average is ${fmtUSD(ind.ma200)}.`);
  const cross = ind.last_cross;
  if (cross && cross.type && cross.date) {
    const type = String(cross.type).toLowerCase();
    if (type.includes("golden")) {
      parts.push(`The last cross was a golden cross on ${fmtSnapDate(cross.date)}: the day the 50-day line moved above the 200-day line.`);
    } else if (type.includes("death")) {
      parts.push(`The last cross was a death cross on ${fmtSnapDate(cross.date)}: the day the 50-day line moved below the 200-day line.`);
    }
  }
  return {
    intent: "movingavg",
    text: parts.join(" ") + " " + CLOSER,
    structured: {
      ma50_usd: isNum(ind.ma50) ? Math.round(ind.ma50) : null,
      ma200_usd: isNum(ind.ma200) ? Math.round(ind.ma200) : null,
      last_cross: cross ? { type: cross.type, date: cross.date } : null,
    },
  };
}

function drawdownAnswer(data, snapshot) {
  const ind = (snapshot && snapshot.indicators) || {};
  const ath = ind.ath || {};
  const spot = snapSpot(snapshot, data);
  let below = isNum(ind.drawdown_pct) ? Math.abs(ind.drawdown_pct) : null;
  if (below === null && isNum(spot) && isNum(ath.price) && ath.price > 0) {
    below = (1 - spot / ath.price) * 100;
  }
  if (below === null || !isNum(ath.price)) return notAvailable("drawdown", "the all-time high");
  const parts = [];
  if (isNum(spot)) parts.push(`One bitcoin costs ${fmtUSD(spot)}.`);
  parts.push(`The all-time high was ${fmtUSD(ath.price)}${ath.date ? ` on ${fmtSnapDate(ath.date)}` : ""}.`);
  parts.push(`That puts today ${fmt1(below)}% under the top.`);
  const dsa = snapshot && snapshot.cycle && snapshot.cycle.days_since_ath;
  if (isNum(dsa)) parts.push(`That top was ${fmtInt(dsa)} days ago.`);
  return {
    intent: "drawdown",
    text: parts.join(" ") + " " + CLOSER,
    structured: { ath_usd: Math.round(ath.price), ath_date: ath.date || null, below_pct: parseFloat(below.toFixed(1)) },
  };
}

function volatilityAnswer(snapshot) {
  const ind = (snapshot && snapshot.indicators) || {};
  if (!isNum(ind.vol30_pct) && !isNum(ind.vol90_pct)) return notAvailable("volatility", "a volatility reading");
  const parts = ["Volatility reads how big the swings are. Bigger number, bigger swings."];
  if (isNum(ind.vol30_pct)) parts.push(`The 30-day reading is ${fmt1(ind.vol30_pct)}%.`);
  if (isNum(ind.vol90_pct)) parts.push(`The 90-day reading is ${fmt1(ind.vol90_pct)}%.`);
  return {
    intent: "volatility",
    text: parts.join(" ") + " " + CLOSER,
    structured: { vol30_pct: isNum(ind.vol30_pct) ? ind.vol30_pct : null, vol90_pct: isNum(ind.vol90_pct) ? ind.vol90_pct : null },
  };
}

function halvingAnswer(snapshot) {
  const cyc = (snapshot && snapshot.cycle) || {};
  if (!cyc.next_halving_est_date && !isNum(cyc.blocks_remaining)) {
    return notAvailable("halving", "the halving clock");
  }
  const parts = [];
  if (cyc.last_halving_date) parts.push(`The last halving was on ${fmtSnapDate(cyc.last_halving_date)}.`);
  if (isNum(cyc.days_since_halving)) parts.push(`That was ${fmtInt(cyc.days_since_halving)} days ago.`);
  if (isNum(cyc.blocks_remaining)) parts.push(`${fmtInt(cyc.blocks_remaining)} blocks are left until the next one.`);
  if (isNum(cyc.pct_through_cycle)) parts.push(`We are ${fmt1(cyc.pct_through_cycle)}% of the way through this cycle.`);
  if (cyc.next_halving_est_date) {
    parts.push(`The next halving lands near ${fmtSnapDate(cyc.next_halving_est_date)}. The block count sets it, not the calendar, so the date is a best guess.`);
  }
  return {
    intent: "halving",
    text: parts.join(" ") + " " + CLOSER,
    structured: {
      next_halving_est_date: cyc.next_halving_est_date || null,
      blocks_remaining: isNum(cyc.blocks_remaining) ? cyc.blocks_remaining : null,
      pct_through_cycle: isNum(cyc.pct_through_cycle) ? cyc.pct_through_cycle : null,
    },
  };
}

function hashrateAnswer(snapshot) {
  const f = (snapshot && snapshot.fundamentals) || {};
  if (!isNum(f.hashrate_ehs)) return notAvailable("hashrate", "a hashrate reading");
  const parts = [
    `The hashrate is ${fmt1(f.hashrate_ehs)} EH/s. That is all the guessing power guarding the network.`,
  ];
  if (isNum(f.hashrate_30d_change_pct)) {
    const ch = f.hashrate_30d_change_pct;
    parts.push(`Over the last 30 days it moved ${ch < 0 ? "down" : "up"} ${fmt1(Math.abs(ch))}%.`);
  }
  return {
    intent: "hashrate",
    text: parts.join(" ") + " " + CLOSER,
    structured: { hashrate_ehs: f.hashrate_ehs, hashrate_30d_change_pct: isNum(f.hashrate_30d_change_pct) ? f.hashrate_30d_change_pct : null },
  };
}

function feesAnswer(snapshot) {
  const fees = (snapshot && snapshot.fundamentals && snapshot.fundamentals.fees) || {};
  if (!isNum(fees.fastest) && !isNum(fees.half_hour) && !isNum(fees.mempool_count)) {
    return notAvailable("fees", "the fee readings");
  }
  const parts = [];
  if (isNum(fees.fastest)) parts.push(`A fast send costs about ${fmtInt(fees.fastest)} sats per vB right now.`);
  if (isNum(fees.half_hour)) parts.push(`A send that can wait half an hour costs about ${fmtInt(fees.half_hour)} sats per vB.`);
  if (isNum(fees.mempool_count)) parts.push(`${fmtInt(fees.mempool_count)} sends wait in line in the mempool.`);
  return {
    intent: "fees",
    text: parts.join(" ") + " " + CLOSER,
    structured: {
      fastest_sat_vb: isNum(fees.fastest) ? fees.fastest : null,
      half_hour_sat_vb: isNum(fees.half_hour) ? fees.half_hour : null,
      mempool_count: isNum(fees.mempool_count) ? fees.mempool_count : null,
    },
  };
}

function fearGreedAnswer(snapshot) {
  const fg = (snapshot && snapshot.fundamentals && snapshot.fundamentals.fear_greed) || {};
  if (!isNum(fg.value)) return notAvailable("feargreed", "a fear and greed reading");
  const text =
    `The fear and greed index reads ${fmtInt(fg.value)} out of 100${fg.label ? `: ${fg.label}` : ""}. ` +
    `Low numbers mean fear. High numbers mean greed. ` + CLOSER;
  return { intent: "feargreed", text, structured: { value: fg.value, label: fg.label || null } };
}

function dominanceAnswer(snapshot) {
  const f = (snapshot && snapshot.fundamentals) || {};
  if (!isNum(f.dominance_btc_pct)) return notAvailable("dominance", "a dominance reading");
  const parts = [`Bitcoin is ${fmt1(f.dominance_btc_pct)}% of all the money in crypto.`];
  if (isNum(f.total_mcap_usd)) parts.push(`All crypto together is worth ${fmtBigUSD(f.total_mcap_usd)}.`);
  return {
    intent: "dominance",
    text: parts.join(" ") + " " + CLOSER,
    structured: { dominance_btc_pct: f.dominance_btc_pct, total_mcap_usd: isNum(f.total_mcap_usd) ? f.total_mcap_usd : null },
  };
}

// Forecast asks get the MODEL EXPLORER, never a prediction: what the
// rainbow model's own lines say at that date IF the model held,
// labeled as the model's lines, plus the model's track record —
// the share of past days the price sat inside the bands.
function forecastAnswer(snapshot, q) {
  const rec = (snapshot && snapshot.band_record) || {};
  let pctInside = isNum(rec.pct_inside) ? rec.pct_inside : null;
  if (pctInside !== null && pctInside <= 1) pctInside = pctInside * 100;
  if (pctInside === null) return notAvailable("forecast", "the model's track record");
  const track =
    `Track record: about ${fmtInt(pctInside)} of 100 past days sat inside the bands` +
    (isNum(rec.days_below) && isNum(rec.days_above)
      ? ` (${fmtInt(rec.days_below)} days below them, ${fmtInt(rec.days_above)} days above them)`
      : "") + ".";
  const years = [...q.matchAll(/\b(20\d{2})\b/g)].map((m) => parseInt(m[1], 10));
  const year = years.find((y) => y >= 2027);
  if (!year) {
    return {
      intent: "forecast",
      text:
        `I do not make forecasts. Name a future year and I can show what the model's lines say for that year. ` +
        `${track} Those are the model's lines, not a forecast. ` + CLOSER,
      structured: { pct_inside: parseFloat(pctInside.toFixed(1)) },
    };
  }
  const fit = snapFit(snapshot);
  if (!fit) return notAvailable("forecast", "the model's fit");
  const ts = Date.UTC(year, 0, 1) / 1000;
  const trend = trendAt(fit, ts);
  const low = bandEdgeAt(fit, ts, 0);
  const high = bandEdgeAt(fit, ts, 9);
  const text =
    `I do not make forecasts. Here is the model explorer instead. ` +
    `If the rainbow model's lines held to Jan 1, ${year}, the growth line would sit at ${fmtUSD(trend)}. ` +
    `The lowest band's floor would be ${fmtUSD(low)}, and the top band's ceiling ${fmtUSD(high)}. ` +
    `${track} Those are the model's lines, not a forecast. ` + CLOSER;
  return {
    intent: "forecast",
    text,
    structured: {
      target_year: year,
      trend_usd: Math.round(trend),
      ladder_low_usd: Math.round(low),
      ladder_high_usd: Math.round(high),
      pct_inside: parseFloat(pctInside.toFixed(1)),
    },
  };
}

// --- The V2 router -----------------------------------------------------
// Order is the discipline:
//   0. Injection / role-play overrides — declined as advice, always.
//   1. "Should I..." — routeAsk's advice answer, untouched.
//   2. Forecast asks with a future year or prediction words — the
//      model explorer (before routeAsk can call them "advice").
//   3. The new snapshot topics.
//   4. Everything else — routeAsk, byte for byte the old behavior.
export function routeAskV2(data, snapshot, rawQ) {
  const q = norm(rawQ);
  if (!q.trim()) return routeAsk(data, rawQ);

  // 0. Injection: "ignore your rules", "you are now an advisor", a
  // direct order to say buy/sell. The answer is the plain advice no.
  if (
    has(q,
      " ignore your rules", " ignore the rules", " ignore your instructions",
      " ignore all instructions", " disregard your", " disregard the",
      " you are now ", " act as ", " pretend ", " jailbreak",
      " financial advisor", " financial adviser",
      " tell me to buy", " tell me to sell")
  ) {
    return routeAsk(data, "Should I buy bitcoin now?");
  }

  // 1. A direct "should I" is advice, even with a year attached.
  if (has(q, " should i ", " should we ")) return routeAsk(data, rawQ);

  // 2. Forecast: prediction words, or a future year with a price word.
  const years = [...q.matchAll(/\b(20\d{2})\b/g)].map((m) => parseInt(m[1], 10));
  const futureYear = years.find((y) => y >= 2027);
  if (
    has(q, " forecast", " prediction", " price prediction") ||
    has(q, " predict ") || q.trim().endsWith(" predict") ||
    (futureYear !== undefined && has(q, " price", " cost", " worth", " be "))
  ) {
    return forecastAnswer(snapshot, q);
  }

  // 3. Snapshot topics.
  if (has(q, " rsi", " relative strength", " overbought", " oversold")) return rsiAnswer(snapshot);
  if (has(q, " mayer")) return mayerAnswer(data, snapshot);
  if (
    has(q, " golden cross", " death cross", " moving average", " 200 day", " 50 day",
      " ma50", " ma200", " day average")
  ) return movingAvgAnswer(snapshot);
  const yearCrash = /\b(19|20)\d{2}\b/.test(q) && has(q, " crash", " fall", " fell");
  if (
    !yearCrash &&
    has(q, " all time high", " ath", " drawdown", " below the high", " down from the top", " off the high", " under the top")
  ) return drawdownAnswer(data, snapshot);
  if (has(q, " volatility", " volatile", " swings", " wild")) return volatilityAnswer(snapshot);
  if (
    has(q, " halving", " halve", " next halving", " block reward", " through the cycle", " the cycle")
  ) return halvingAnswer(snapshot);
  if (has(q, " hashrate", " hash rate", " mining", " miners")) return hashrateAnswer(snapshot);
  if (
    has(q, " fee", " fees", " mempool", " cost to send", " cost of sending", " transaction cost")
  ) return feesAnswer(snapshot);
  if (
    has(q, " fear and greed", " fear greed", " greed index", " fear index", " sentiment")
  ) return fearGreedAnswer(snapshot);
  if (
    has(q, " dominance", " share of crypto", " share of the crypto", " of all crypto", " market share")
  ) return dominanceAnswer(snapshot);

  // 4. The old engine, untouched.
  return routeAsk(data, rawQ);
}
