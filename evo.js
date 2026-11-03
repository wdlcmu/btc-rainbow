// evo.js — Bitcoin Rainbow evolution layer (Nov 1, 2026).
// Fills the gauges, the network cards, the tap-a-crash explorer, the
// model explorer, and today's read from ONE computed snapshot.
// Snapshot order: live worker /api/snapshot -> baked snapshot-data.js
// (labeled a saved copy). A field that is null shows "not available"
// — never a stale number dressed as live. Every number on these
// sections comes from the snapshot object or from BTC_DAILY closes.
"use strict";
(function () {
  var SNAP_BASE = "https://btc-rainbow-ask-staging.wdlcmu.workers.dev";
  var $ = function (id) { return document.getElementById(id); };
  var GENESIS = 1230940800; // Jan 3, 2009 UTC

  function fmtUSD(x) { return "$" + Math.round(x).toLocaleString("en-US"); }
  function fmtBig(x) {
    if (x >= 1e12) return "$" + (x / 1e12).toFixed(2) + " trillion";
    if (x >= 1e9) return "$" + (x / 1e9).toFixed(1) + " billion";
    return fmtUSD(x);
  }
  function fmtPct(x, digits) {
    var v = Math.abs(x).toFixed(digits == null ? 1 : digits);
    return (x < 0 ? "\u2212" : "") + v + "%";
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  function track(surface) {
    try { if (window.FA && FA.track) FA.track("tool_start", { surface: surface }); } catch (e) {}
  }

  // BTC_DAILY: [[yyyymmdd, close], ...] -> [[ts, close], ...]
  var DAILY = (window.BTC_DAILY || []).map(function (r) {
    var s = String(r[0]);
    var ts = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) / 1000;
    return [ts, r[1]];
  });
  function nearestClose(ts) {
    var lo = 0, hi = DAILY.length - 1;
    if (!DAILY.length) return null;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; (DAILY[m][0] < ts) ? lo = m : hi = m; }
    return (ts - DAILY[lo][0] <= DAILY[hi][0] - ts) ? DAILY[lo] : DAILY[hi];
  }

  function unavailable(el) { if (el) el.textContent = "Not available right now."; }

  function fillSnapshot(S, saved) {
    if (!S) return;
    var ind = S.indicators || {}, cyc = S.cycle || {}, fun = S.fundamentals || {}, rb = S.rainbow || {};

    // ---- hero chips
    var setChip = function (id, label, val) {
      var el = $(id); if (!el) return;
      el.textContent = val == null ? label + ": not available" : label + ": " + val;
    };
    setChip("chip-rsi", "RSI", ind.rsi14 == null ? null : String(Math.round(ind.rsi14)));
    setChip("chip-mayer", "Mayer", ind.mayer == null ? null : ind.mayer.toFixed(2));
    setChip("chip-fg", "Fear & Greed", fun.fear_greed ? String(fun.fear_greed.value) : null);

    // ---- gauges
    var g = function (id, val, noteId, note) {
      var el = $(id); if (el) el.textContent = val == null ? "Not available" : val;
      if (noteId) { var n = $(noteId); if (n) n.textContent = note || ""; }
    };
    g("g-rsi", ind.rsi14 == null ? null : String(Math.round(ind.rsi14)), "g-rsi-note",
      ind.rsi14 == null ? "" : (ind.rsi14 >= 70 ? "Running hot." :
        ind.rsi14 <= 30 ? "Washed out." : "In the middle. Not hot, not washed out."));
    g("g-mayer", ind.mayer == null ? null : ind.mayer.toFixed(2) + "\u00d7", "g-mayer-note",
      ind.mayer == null ? "" : (ind.mayer >= 2.4 ? "Far above the average." :
        ind.mayer > 1 ? "Above the average." :
        ind.mayer === 1 ? "Right on the average." : "Below the average."));
    var crossTxt = null, crossNote = "";
    if (ind.ma50 && ind.ma200) {
      crossTxt = fmtUSD(ind.ma50) + " / " + fmtUSD(ind.ma200);
      crossNote = (ind.ma50 >= ind.ma200 ? "50-day on top." : "200-day on top.") +
        (ind.last_cross ?
          (" Last cross: " + ind.last_cross.type + " cross, " + fmtDate(ind.last_cross.date) + ".") :
          " No cross in the data window.");
    }
    g("g-ma", crossTxt, "g-ma-note", crossNote);
    g("g-dd", ind.drawdown_pct == null ? null : fmtPct(ind.drawdown_pct), "g-dd-note",
      (ind.ath && ind.ath.price) ? ("The top was " + fmtUSD(ind.ath.price) + ", " + fmtDate(ind.ath.date) + ".") : "");
    var volTxt = (ind.vol30_pct == null) ? null : (ind.vol30_pct.toFixed(2) + "% a day");
    var volNote = "";
    if (ind.vol30_pct != null) {
      var wild = ind.vol90_pct ? ind.vol30_pct / ind.vol90_pct : 1;
      volNote = wild >= 1.25 ? "Wild for bitcoin." : wild <= 0.8 ? "Calm for bitcoin." : "Typical for bitcoin.";
    }
    g("g-vol", volTxt, "g-vol-note", volNote);
    g("g-dist", rb.pct_vs_trend == null ? null : fmtPct(rb.pct_vs_trend, 0), "g-dist-note",
      rb.band_name ? ("In the " + rb.band_name + " band. The line reads " + fmtUSD(rb.trend_today) + " today.") : "");

    // ---- network
    g("n-supply", fun.supply_issued_pct == null ? null : fun.supply_issued_pct.toFixed(2) + "% out", "n-supply-note",
      fun.subsidy_btc ? ("New coins now arrive at " + fun.subsidy_btc + " per block, about every 10 minutes.") : "");
    g("n-hash", fun.hashrate_ehs == null ? null : Math.round(fun.hashrate_ehs).toLocaleString("en-US") + " EH/s", "n-hash-note",
      fun.hashrate_30d_change_pct == null ? "" :
        ("That is " + (fun.hashrate_30d_change_pct >= 0 ? "up " : "down ") + Math.abs(fun.hashrate_30d_change_pct).toFixed(1) + "% over the last 30 days. More guessing power means a harder network to attack."));
    var feeTxt = null, feeNote = "";
    if (fun.fees && fun.fees.fastest != null) {
      feeTxt = fun.fees.fastest + " sat/vB to go fast";
      feeNote = (fun.fees.mempool_count != null) ?
        (fun.fees.mempool_count.toLocaleString("en-US") + " payments are waiting in line right now.") : "";
    }
    g("n-fees", feeTxt, "n-fees-note", feeNote);
    g("n-fg", fun.fear_greed ? (fun.fear_greed.value + " — " + fun.fear_greed.label) : null, "n-fg-note",
      "A mood ring, not a measure of value.");
    g("n-dom", fun.dominance_btc_pct == null ? null : fun.dominance_btc_pct.toFixed(1) + "% of all crypto", "n-dom-note",
      fun.total_mcap_usd ? ("All of crypto together: about " + fmtBig(fun.total_mcap_usd) + ".") : "");

    // ---- halving bar
    if (cyc.pct_through_cycle != null && $("halv-fill")) {
      $("halv-fill").style.width = cyc.pct_through_cycle.toFixed(1) + "%";
      $("halv-text").textContent =
        cyc.pct_through_cycle.toFixed(1) + "% of the way to the next halving. " +
        (cyc.blocks_remaining != null ? cyc.blocks_remaining.toLocaleString("en-US") + " blocks to go. " : "") +
        (cyc.days_since_halving != null ? cyc.days_since_halving.toLocaleString("en-US") + " days since the last one (" + fmtDate(cyc.last_halving_date) + "). " : "") +
        (cyc.next_halving_est_date ? "The next lands near " + fmtDate(cyc.next_halving_est_date) + " — an estimate; blocks, not calendars, set the day." : "");
    }

    // ---- as-of / source honesty line
    var asof = $("snap-asof");
    if (asof) {
      var when = S.generated_at ? new Date(S.generated_at) : null;
      var whenTxt = when ? when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
      var dead = (S.sources || []).filter(function (s) { return !s.ok; }).map(function (s) { return s.name; });
      asof.textContent = (saved ? "Saved copy. Computed " : "Computed ") + whenTxt +
        " from blockchain.info, Coinbase, mempool.space, alternative.me, and CoinGecko." +
        (dead.length ? " Quiet right now: " + dead.join(", ") + " — its cards say so." : "");
    }

    // ---- Wave 1: Sources & method — per-section sources with as-of,
    // rendered from this snapshot's own source list.
    var msEl = $("m-sources");
    if (msEl && (S.sources || []).length) {
      var asOfTxt = function (s) {
        if (!s.as_of) return "";
        if (String(s.as_of).length === 10) return fmtDate(s.as_of);
        var d = new Date(s.as_of);
        return isFinite(d) ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : String(s.as_of);
      };
      var srcLine = function (s) {
        return s.name + (s.as_of ? ", as of " + asOfTxt(s) : "") + (s.ok ? "" : " — quiet right now; its card says so");
      };
      var pickSrc = function (re) {
        return (S.sources || []).filter(function (s) { return re.test(s.name); });
      };
      var groups = [
        ["The chart, the gauges, and the falls", pickSrc(/blockchain\.info market-price|Coinbase/)],
        ["The network", pickSrc(/mempool\.space|blockchain\.info stats/)],
        ["Fear & Greed", pickSrc(/alternative\.me/)],
        ["Bitcoin's share", pickSrc(/CoinGecko/)]
      ];
      msEl.innerHTML = "";
      groups.forEach(function (grp) {
        if (!grp[1].length) return;
        var p = document.createElement("p");
        var st = document.createElement("strong");
        st.textContent = grp[0] + ". ";
        p.appendChild(st);
        p.appendChild(document.createTextNode(grp[1].map(srcLine).join(". ") + "."));
        msEl.appendChild(p);
      });
      msEl.setAttribute("data-done", "1");
      var mc = $("m-computed");
      if (mc) mc.textContent = "This set of readings was computed " + whenTxt +
        (saved ? " (saved copy)" : "") +
        ". The readings refresh through the day. The price record itself is daily closes, so it moves once a day.";
    }

    window.RB_SNAPSHOT = S;
    initForecast(S);
    initCrashes(S);
    fillStripLines(S);
  }

  // ---- Learn-the-words strip: technical + fundamental one-liners
  function fillStripLines(S) {
    var t = $("technical-text"), f = $("fundamental-text");
    var ind = S.indicators || {}, fun = S.fundamentals || {}, cyc = S.cycle || {};
    if (t && ind.rsi14 != null && ind.mayer != null)
      t.textContent = "Watching the line: RSI " + Math.round(ind.rsi14) + ", Mayer " + ind.mayer.toFixed(2) + " today. See the gauges, Chapter 2.";
    if (f && fun.supply_issued_pct != null && cyc.pct_through_cycle != null)
      f.textContent = "A health check: " + fun.supply_issued_pct.toFixed(1) + "% of all coins are out, and the next halving is " + cyc.pct_through_cycle.toFixed(0) + "% of the way here. See the network, Chapter 3.";
  }

  // ================= TAP-A-CRASH =================
  // One short story per fall: what happened in the world, in plain words.
  // Keyed by the snapshot's crash id. The 2025–26 fall is still open, so
  // its story sticks to what this page's own record shows and names no cause.
  var CRASH_STORIES = {
    "crash-2011-06-11": "Bitcoin's first bubble. In the spring of 2011 the price ran from about a dollar to over thirty in a few weeks. Then hackers broke into Mt. Gox, the one big exchange, and for a few minutes its price showed one cent. Faith in the young market drained away, and the price slid for months.",
    "crash-2013-04-10": "The spring bubble of 2013. New buyers rushed in faster than the plumbing could take. Mt. Gox, where most of the world traded, slowed to a crawl under the load and shut down trading for a day to cool off. In the panic that followed, the price lost most of its value in a week.",
    "crash-2013-12-05": "The top came the same day China barred its banks from touching bitcoin. Two months later Mt. Gox, the world's biggest exchange, stopped all withdrawals, then admitted some 850,000 bitcoins were gone. With the biggest door shut and the coins missing, the price ground down for over a year.",
    "crash-2017-12-17": "The coin-offering mania. Through 2017, brand-new coins were sold to the public by the hundred, and bitcoin rode the fever to nearly $20,000. Then the fever broke: the new coins collapsed, regulators moved in, and the big ad platforms banned crypto ads. The price bled for a full year.",
    "crash-2021-04-14": "Three blows in three months. Tesla stopped taking bitcoin for cars, saying its mining burned too much dirty energy. China then banned mining outright, and about half the world's mining power went dark. Borrowed bets unwound all at once, and the price halved by summer.",
    "crash-2021-11-09": "First the world turned, then the rot showed. Central banks raised interest rates, and every risky bet fell together. Inside crypto, the Terra coin collapsed in May, big lenders fell over the summer, and in November the giant FTX exchange was exposed as a fraud. The bottom came days after FTX fell.",
    "crash-2025-10-07": "This one is still unfolding. The price topped in October 2025 and slid for nine months into the summer of 2026, and it has not climbed back to that top yet. Why it fell is still argued about. The record so far names no single cause."
  };
  var crashInit = false;
  function initCrashes(S) {
    if (crashInit) return;
    var box = $("crash-chips"), svg = $("crash-chart"), out = $("crash-out");
    if (!box || !svg || !out) return;
    var crashes = (S.crashes || []).filter(function (c) { return c.drop_pct >= 25; });
    if (!crashes.length || !DAILY.length) { unavailable(out); return; }
    crashInit = true;
    crashes.forEach(function (c, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip" + (c.open ? " open" : "");
      b.textContent = c.label + "  " + fmtPct(-Math.abs(c.drop_pct), 0).replace("\u2212", "\u2212");
      b.setAttribute("aria-label", "Show the " + c.label + " fall");
      b.addEventListener("click", function () {
        track("crash-explorer");
        box.querySelectorAll(".chip").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        drawCrash(c);
      });
      box.appendChild(b);
      if (i === crashes.length - 1) { b.classList.add("on"); drawCrash(c); }
    });

    // ---- Wave 1: the same seven falls as one computed table.
    // Same snapshot objects the chips draw from, so the table and the
    // explorer can never disagree. Days to recover counts from the top
    // (peak) to the first close back at or above it — the pipeline's
    // days_to_recover, matching BTC_LAB's daysPeakToRecovery.
    var tbody = $("crash-tbody");
    if (tbody) {
      tbody.innerHTML = "";
      crashes.forEach(function (c, i) {
        var tr = document.createElement("tr");
        if (i === crashes.length - 1) tr.className = "on";
        tr.setAttribute("tabindex", "0");
        tr.setAttribute("role", "button");
        tr.setAttribute("aria-label", "Draw the " + c.label + " fall above");
        function cell(main, sub, cls) {
          var td = document.createElement("td");
          if (cls) td.className = cls;
          td.appendChild(document.createTextNode(main));
          if (sub) {
            var s = document.createElement("span");
            s.className = "sub"; s.textContent = sub;
            td.appendChild(s);
          }
          return td;
        }
        tr.appendChild(cell(c.label, c.open ? "still open" : "", "cfall"));
        tr.appendChild(cell(fmtUSD(c.peak_price), fmtDate(c.peak_date), "cnum"));
        tr.appendChild(cell(fmtUSD(c.bottom_price), fmtDate(c.bottom_date), "cnum"));
        tr.appendChild(cell(fmtPct(-Math.abs(c.drop_pct)), "", "cnum"));
        tr.appendChild(cell(c.days_down.toLocaleString("en-US"), "", "cnum"));
        tr.appendChild(c.recovery_date
          ? cell(c.days_to_recover.toLocaleString("en-US") + " days", fmtDate(c.recovery_date), "cnum")
          : cell("Not yet", "still below that top", "cnum"));
        function pick() {
          track("crash-table");
          tbody.querySelectorAll("tr").forEach(function (x) { x.classList.remove("on"); });
          tr.classList.add("on");
          var chip = box.children[i];
          if (chip) chip.click();
          var out2 = $("crash-out");
          if (out2) out2.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        tr.addEventListener("click", pick);
        tr.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
        });
        tbody.appendChild(tr);
      });
    }

    function drawCrash(c) {
      var t0 = Date.parse(c.peak_date + "T00:00:00Z") / 1000;
      var tEnd = c.recovery_date ? Date.parse(c.recovery_date + "T00:00:00Z") / 1000 : DAILY[DAILY.length - 1][0];
      var seg = DAILY.filter(function (p) { return p[0] >= t0 - 86400 && p[0] <= tEnd; });
      if (seg.length < 2) { unavailable(out); return; }
      var W = 1000, H = 300, L = 8, R = 8, T = 14, B = 14;
      var lo = Math.min.apply(null, seg.map(function (p) { return p[1]; }));
      var hi = Math.max.apply(null, seg.map(function (p) { return p[1]; }));
      var yLo = Math.log(lo * 0.92), yHi = Math.log(hi * 1.08);
      var X = function (ts) { return L + (ts - seg[0][0]) / (seg[seg.length - 1][0] - seg[0][0]) * (W - L - R); };
      var Y = function (p) { return T + (yHi - Math.log(p)) / (yHi - yLo) * (H - T - B); };
      var pts = seg.filter(function (_, i) { return i % Math.ceil(seg.length / 420) === 0 || i === seg.length - 1; })
        .map(function (p) { return X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join(" ");
      var bot = nearestClose(Date.parse(c.bottom_date + "T00:00:00Z") / 1000);
      svg.innerHTML =
        '<polyline points="' + pts + '" fill="none" stroke="#ff5d8f" stroke-width="2.4"/>' +
        (bot ? '<circle cx="' + X(bot[0]).toFixed(1) + '" cy="' + Y(bot[1]).toFixed(1) + '" r="6" fill="#ffd94d" stroke="#0d1330" stroke-width="2"/>' : "");
      svg.setAttribute("aria-label", "Price line of the " + c.label + " fall, from " + fmtUSD(c.peak_price) + " down to " + fmtUSD(c.bottom_price) + (c.recovery_date ? " and back up." : "."));
      out.innerHTML = "";
      var lines = [
        "Top: " + fmtUSD(c.peak_price) + " (" + fmtDate(c.peak_date) + "). Bottom: " + fmtUSD(c.bottom_price) + " (" + fmtDate(c.bottom_date) + ").",
        "The fall: " + fmtPct(-Math.abs(c.drop_pct)) + ", over " + c.days_down.toLocaleString("en-US") + " days down.",
        c.recovery_date ?
          "Back to that top on " + fmtDate(c.recovery_date) + " — " + c.days_to_recover.toLocaleString("en-US") + " days after the top." :
          "Not back to that top yet. This fall is still open."
      ];
      lines.forEach(function (tx) {
        var p = document.createElement("p"); p.textContent = tx; out.appendChild(p);
      });
      var story = CRASH_STORIES[c.id];
      if (story) {
        var sp = document.createElement("p"); sp.className = "crash-story"; sp.textContent = story; out.appendChild(sp);
      }
    }
  }

  // ================= FORECAST / MODEL EXPLORER =================
  var fcInit = false;
  function initForecast(S) {
    if (fcInit) return;
    var out = $("fc-out"), slider = $("fc-slider");
    if (!out || !slider || !S.rainbow || S.rainbow.a == null) { if (out) unavailable(out); return; }
    fcInit = true;
    var a = S.rainbow.a, b = S.rainbow.b;
    var BW = 0.3, BB = -0.75;
    var years = 5, scenario = 2; // scenario: 0 bottom band, 2 the line... use band idx: -1 line
    scenario = "line";
    var trend = function (ts) { return Math.exp(a + b * Math.log((ts - GENESIS) / 86400)); };
    var bandMid = function (ts, k) { return trend(ts) * Math.exp(BB + BW * (k + 0.5)); };

    function render() {
      var now = Date.now() / 1000;
      var ts = now + years * 365.25 * 86400;
      var dateTxt = fmtDate(new Date(ts * 1000).toISOString().slice(0, 10));
      var low = bandMid(ts, 0), line = trend(ts), high = bandMid(ts, 8);
      var pick = scenario === "bottom" ? low : scenario === "top" ? high : line;
      var pickName = scenario === "bottom" ? "the bottom band's middle" : scenario === "top" ? "the top band's middle" : "the growth line itself";
      out.innerHTML = "";
      var rows = [
        ["On", dateTxt + " — " + (years === Math.round(years) ? years : years.toFixed(1)) + " years out"],
        ["If the price followed " + pickName, fmtUSD(pick)],
        ["The full ladder that day", fmtUSD(trend(ts) * Math.exp(BB)) + " (bottom edge) to " + fmtUSD(trend(ts) * Math.exp(BB + BW * 9)) + " (top edge)"]
      ];
      rows.forEach(function (r) {
        var p = document.createElement("p");
        var k = document.createElement("span"); k.className = "fc-k"; k.textContent = r[0] + ": ";
        p.appendChild(k); p.appendChild(document.createTextNode(r[1]));
        out.appendChild(p);
      });
    }
    slider.addEventListener("input", function () {
      years = parseFloat(slider.value);
      var lab = $("fc-years-label"); if (lab) lab.textContent = (years === Math.round(years) ? years : years.toFixed(1)) + " years out";
      track("forecast"); render();
    });
    document.querySelectorAll("#fc-years .chip").forEach(function (c) {
      c.addEventListener("click", function () {
        years = parseFloat(c.getAttribute("data-yrs")); slider.value = years;
        var lab = $("fc-years-label"); if (lab) lab.textContent = years + " years out";
        document.querySelectorAll("#fc-years .chip").forEach(function (x) { x.classList.toggle("on", x === c); });
        track("forecast"); render();
      });
    });
    document.querySelectorAll("#fc-scen .chip").forEach(function (c) {
      c.addEventListener("click", function () {
        scenario = c.getAttribute("data-scen");
        document.querySelectorAll("#fc-scen .chip").forEach(function (x) { x.classList.toggle("on", x === c); });
        track("forecast"); render();
      });
    });
    render();

    // Honesty record, same component: the model's track record.
    var rec = S.band_record, recEl = $("fc-record");
    if (rec && recEl) {
      var names = ["Deep Blue", "Blue", "Sky", "Green", "Lime", "Yellow", "Orange", "Dark Orange", "Red"];
      var colors = ["#2e3a9e", "#2f6fd0", "#35b6c9", "#3fae5a", "#a8c93f", "#f2c230", "#ef8f2c", "#e85d1f", "#d92b2b"];
      var bars = rec.share_by_band.map(function (sh, k) {
        return '<div class="fc-bar-row"><span class="fc-bar-name">' + names[k] + '</span>' +
          '<span class="fc-bar"><i style="background:' + colors[k] + ';width:' + Math.max(1.5, sh) + '%"></i></span>' +
          '<span class="fc-bar-val">' + sh.toFixed(1) + '%</span></div>';
      }).join("");
      recEl.innerHTML =
        "<h3>The model's own track record</h3>" +
        "<p>Share of all days since 2010 spent in each band, on today's fit:</p>" + bars +
        "<p>The price has closed inside the ladder on " + rec.pct_inside.toFixed(1) + "% of days. " +
        "It sat below every band on " + rec.days_below.toLocaleString("en-US") + " days and above every band on " + rec.days_above.toLocaleString("en-US") + " days. " +
        "The bands are a ruler the past drew. The future has not agreed to stay inside them.</p>";
    }
  }

  // ================= TODAY'S READ =================
  function fillNote(note, saved) {
    var box = $("read-note"), dateEl = $("read-date");
    if (!box || !note) return;
    if (dateEl) dateEl.textContent = (saved ? "Saved copy — " : "") + ((note.headline || note.title || ("Read for " + fmtDate(note.date))));
    box.innerHTML = "";
    (note.paragraphs || []).forEach(function (tx) {
      var p = document.createElement("p"); p.textContent = tx; box.appendChild(p);
    });
    if (note.grounding_ok === false) {
      var p = document.createElement("p"); p.className = "fine";
      p.textContent = "One line of today's read failed its fact check and was held back. The numbers above are the ones that passed.";
      box.appendChild(p);
    }
  }

  // ================= LOAD =================
  var done = false;
  function useBaked() {
    if (done) return; done = true;
    if (window.BTC_SNAPSHOT) fillSnapshot(window.BTC_SNAPSHOT, true);
    if (window.BTC_NOTE) fillNote(window.BTC_NOTE, true);
  }
  try {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 6000);
    fetch(SNAP_BASE + "/api/snapshot", { signal: ctl.signal }).then(function (r) {
      if (!r.ok) throw new Error("bad");
      return r.json();
    }).then(function (S) {
      clearTimeout(timer);
      if (!done) { done = true; fillSnapshot(S, false); }
      return fetch(SNAP_BASE + "/api/analysis", { signal: ctl.signal });
    }).then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (A) { if (A && A.today) fillNote(A.today, false); else if (window.BTC_NOTE) fillNote(window.BTC_NOTE, true); })
      .catch(function () { useBaked(); });
  } catch (e) { useBaked(); }
  setTimeout(function () { if (!done) useBaked(); }, 6500);
})();
