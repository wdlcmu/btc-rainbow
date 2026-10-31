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

export const INTENTS = ["today", "dca", "explain", "buy_ways", "advice", "none"];

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
