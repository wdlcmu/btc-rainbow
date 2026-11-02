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
