/* Crossings: gamified AP practice. Static site; results go to a Google Sheet via Apps Script. */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const LIVE = !!CFG.scriptUrl;

  // ---- tuning ---------------------------------------------------------------
  const XP = { correct: 10, streakBonus: 5, streakFrom: 3, checkFirst: 6, checkRetry: 2, setComplete: 10, perfect: 25 };
  const LEVELS = [
    [0, "Stowaway"], [40, "Deckhand"], [100, "Settler"], [180, "Freeholder"], [280, "Merchant"],
    [400, "Burgess"], [550, "Magistrate"], [720, "Governor"], [920, "Chronicler"],
  ];
  const READ = { wordsPerSec: 5, min: 8, max: 30, parallelMin: 5, parallelMax: 15 };

  // ---- tiny helpers -----------------------------------------------------------
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const LETTERS = "ABCDE";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: app still works for this session */ } },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const words = (s) => String(s).trim().split(/\s+/).length;
  const pct = (x) => Math.round(x * 100);

  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ---- state ------------------------------------------------------------------
  let bankCfg, bank, Q = {}, SETS = {}, TOPIC_COUNT = {};
  let profile = store.get("crossings:profile", null);
  let prog = null;
  let leadersCache = null;

  const progKey = () => `crossings:prog:${bank.id}:${profile.key}`;
  const blankProg = () => ({ xp: 0, streak: 0, bestStreak: 0, sets: {}, topics: {}, run: null });
  const saveProg = () => store.set(progKey(), prog);

  function levelFor(xp) {
    let i = 0;
    while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
    const floor = LEVELS[i][0], next = LEVELS[i + 1]?.[0] ?? null;
    return { idx: i, name: LEVELS[i][1], floor, next, frac: next ? (xp - floor) / (next - floor) : 1 };
  }

  // ---- server -----------------------------------------------------------------
  async function apiGet(params) {
    const u = new URL(CFG.scriptUrl);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { redirect: "follow" });
    return r.json();
  }
  async function apiPost(body) {
    // text/plain body = "simple" CORS request, no preflight (Apps Script can't answer one)
    const r = await fetch(CFG.scriptUrl, { method: "POST", body: JSON.stringify(body), redirect: "follow" });
    return r.json();
  }

  function enqueue(ev) {
    if (!LIVE) return;
    ev.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    ev.key = profile.key;
    ev.bank = bank.id;
    ev.ts = Date.now();
    const ob = store.get("crossings:outbox", []);
    ob.push(ev);
    store.set("crossings:outbox", ob);
    flush();
  }
  let flushing = false;
  async function flush() {
    if (!LIVE || flushing) return;
    const ob = store.get("crossings:outbox", []);
    if (!ob.length) return;
    flushing = true;
    let again = false;
    try {
      const batch = ob.slice(0, 40);
      const res = await apiPost({ action: "batch", events: batch });
      if (res.ok) {
        const sent = new Set(batch.map((e) => e.id));
        const rest = store.get("crossings:outbox", []).filter((e) => !sent.has(e.id));
        store.set("crossings:outbox", rest);
        again = rest.length > 0;
      }
    } catch { /* offline: retried on the next answer, every 30s, and when back online */ }
    flushing = false;
    if (again) flush();
  }
  setInterval(flush, 30000);
  window.addEventListener("online", flush);

  // ---- password wall ----------------------------------------------------------------
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (u8) => btoa(String.fromCharCode(...u8));

  async function deriveKey(pw, enc) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64d(enc.salt), iterations: enc.iter }, base, 256);
    return new Uint8Array(bits);
  }

  async function decryptBank(enc, raw) {
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(enc.iv) }, key, b64d(enc.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function viewUnlock(enc, cacheKey) {
    return new Promise((resolve) => {
      app.innerHTML = `
        <section class="signin">
          <div class="signin-card card">
            <p class="kicker">Crew only</p>
            <h1 class="display">The ship's password</h1>
            <p class="lede">Enter the password your teacher gave the class. You'll only need it once on this device.</p>
            <form id="unlock" autocomplete="off">
              <label for="pw">Password</label>
              <div class="row">
                <input id="pw" type="password" required autocomplete="current-password">
                <button class="btn primary" type="submit">Unlock</button>
              </div>
            </form>
            <div id="unlock-msg" aria-live="polite"></div>
          </div>
        </section>`;
      $("#pw").focus();
      $("#unlock").addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = $("#unlock-msg"), btn = e.target.querySelector("button");
        btn.disabled = true;
        msg.innerHTML = `<p class="muted">Checking…</p>`;
        try {
          const raw = await deriveKey($("#pw").value, enc);
          const plain = await decryptBank(enc, raw);
          store.set(cacheKey, b64e(raw));
          resolve(plain);
        } catch {
          btn.disabled = false;
          msg.innerHTML = `<p class="warn">That's not the password. Check with ${esc(CFG.teacherName)}.</p>`;
          $("#pw").select();
        }
      });
    });
  }

  // ---- bank ---------------------------------------------------------------------
  async function loadBank() {
    const want = new URLSearchParams(location.search).get("bank") || store.get("crossings:bank", null);
    bankCfg = CFG.banks.find((b) => b.id === want) || CFG.banks[0];
    const r = await fetch(bankCfg.file, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Couldn't load ${bankCfg.file}`);
    let data = await r.json();
    if (data.ct) {
      // Encrypted bank (tools/encrypt_bank.py): unlock with the class password, remembered per device.
      const cacheKey = `crossings:unlock:${bankCfg.id}:${data.salt}`;
      const cached = store.get(cacheKey, null);
      let plain = null;
      if (cached) {
        try { plain = await decryptBank(data, b64d(cached)); } catch { store.del(cacheKey); }
      }
      data = plain || (await viewUnlock(data, cacheKey));
    }
    bank = data;
    Q = {}; SETS = {}; TOPIC_COUNT = {};
    bank.questions.forEach((q) => { Q[q.num] = q; TOPIC_COUNT[q.topic] = (TOPIC_COUNT[q.topic] || 0) + 1; });
    bank.sets.forEach((s) => { SETS[s.id] = s; });
    document.title = `Crossings · ${bank.title}`;
  }

  function loadProg() {
    prog = Object.assign(blankProg(), store.get(progKey(), {}));
  }

  async function pullServerProgress() {
    if (!LIVE) return;
    try {
      const res = await apiGet({ action: "progress", key: profile.key, bank: bank.id });
      const sp = res.ok && res.progress;
      if (sp && (sp.xp || 0) > (prog.xp || 0)) {
        prog = Object.assign(blankProg(), sp, { run: prog.run });
        saveProg();
        toast("Progress restored from your other device.");
      }
    } catch { /* offline is fine */ }
  }

  // ---- HUD ------------------------------------------------------------------------
  function renderHud() {
    const hud = $("#hud");
    if (!profile || !prog) { hud.hidden = true; return; }
    const lv = levelFor(prog.xp);
    hud.hidden = false;
    hud.innerHTML = `
      <span class="hud-level" title="Level ${lv.idx + 1}">${esc(lv.name)}</span>
      <span class="hud-xp"><b>${prog.xp}</b> XP</span>
      <span class="hud-streak ${prog.streak >= XP.streakFrom ? "hot" : ""}" title="Correct answers in a row">${flame()}<b>${prog.streak}</b></span>
      <button class="hud-name" data-action="signout" title="Sign out">${esc(profile.first)} · sign out</button>`;
  }
  const flame = () => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1c1 3 4 4.5 4 8.2A4 4 0 0 1 4 9.2C4 7 5.2 6 6 4.5c.4 1.5 1 2.2 1.8 2.6C7.9 5 7.6 3 8 1z" fill="currentColor"/></svg>`;

  function popXp(amount, anchor) {
    if (!amount) return;
    const el = document.createElement("span");
    el.className = "xp-pop";
    el.textContent = `+${amount} XP`;
    const r = (anchor || app).getBoundingClientRect();
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${r.top + window.scrollY}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  // ---- sign in ------------------------------------------------------------------
  function viewSignin(prefill = "") {
    renderHud();
    app.innerHTML = `
      <section class="signin">
        <div class="signin-card card">
          <p class="kicker">${esc(bank.course || "")}</p>
          <h1 class="display">${esc(bank.title)}</h1>
          <p class="sub">${esc(bank.subtitle || "")}</p>
          <p class="lede">Answer a set, read the log on what you missed, prove you've got it, then sail on. Every answer earns XP and charts your mastery, topic by topic.</p>
          <form id="signin" autocomplete="off">
            <label for="nm">Your first and last name</label>
            <div class="row">
              <input id="nm" name="name" required minlength="3" placeholder="e.g. Ashley Arauz" value="${esc(prefill)}">
              <button class="btn primary" type="submit">Come aboard</button>
            </div>
          </form>
          <div id="matches" aria-live="polite"></div>
          ${LIVE ? "" : `<p class="demo-note">Demo mode: no results sheet is connected, so nothing is saved for your teacher.</p>`}
        </div>
      </section>`;
    $("#nm").focus();
    $("#signin").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#nm").value.trim();
      const box = $("#matches");
      if (!LIVE) {
        const parts = name.split(/\s+/);
        return signIn({ key: "demo-" + name.toLowerCase().replace(/[^a-z]+/g, "-"), name, first: parts[0] });
      }
      box.innerHTML = `<p class="muted">Checking the ship's roll…</p>`;
      try {
        const res = await apiGet({ action: "lookup", name });
        if (!res.ok) throw new Error(res.error);
        const m = res.matches;
        if (!m.length) {
          box.innerHTML = `<p class="warn">We couldn't find “${esc(name)}” on the roster. Use your full first and last name as the school has it, or ask ${esc(CFG.teacherName)}.</p>`;
        } else {
          box.innerHTML = `<p>${m.length === 1 ? "Is this you?" : "Which one is you?"}</p>
            <div class="match-list">${m.map((s, i) => `<button class="btn match" data-i="${i}">${esc(s.name)}</button>`).join("")}</div>`;
          box.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => signIn(m[+b.dataset.i])));
        }
      } catch (err) {
        box.innerHTML = `<p class="warn">Couldn't reach the results sheet. Check your connection and try again.</p>`;
      }
    });
  }

  async function signIn(p) {
    profile = { key: p.key, name: p.name, first: p.first };
    store.set("crossings:profile", profile);
    loadProg();
    await pullServerProgress();
    viewHome();
  }

  function signOut() {
    if (prog?.run) saveProg();
    store.del("crossings:profile");
    profile = null; prog = null;
    viewSignin();
  }

  // ---- home -------------------------------------------------------------------------
  const setUnlocked = (i) => !bank.lockSets || i === 0 || !!prog.sets[bank.sets[i - 1].id]?.done;

  function topicMastery(t) {
    const m = prog.topics[t] || {};
    const seen = Object.keys(m).length;
    const sum = Object.values(m).reduce((a, b) => a + b, 0);
    return { seen, total: TOPIC_COUNT[t] || 0, frac: TOPIC_COUNT[t] ? sum / TOPIC_COUNT[t] : 0 };
  }
  const tier = (m) => (!m.seen ? "uncharted" : m.frac >= 0.85 ? "mastered" : m.frac >= 0.6 ? "claimed" : "charted");
  const TIER_LABEL = { uncharted: "Uncharted", charted: "Charted", claimed: "Claimed", mastered: "Mastered" };

  function viewHome() {
    stopGate();
    renderHud();
    const lv = levelFor(prog.xp);
    const done = bank.sets.filter((s) => prog.sets[s.id]?.done).length;
    const run = prog.run;
    const units = [...new Set(bank.topics.map((t) => t.unit))];

    app.innerHTML = `
      <section class="home">
        <div class="home-head">
          <div>
            <p class="kicker">${esc(bank.course || "")} · ${esc(bank.subtitle || "")}</p>
            <h1 class="display">Welcome aboard, ${esc(profile.first)}.</h1>
          </div>
          ${CFG.banks.length > 1 ? `<label class="bank-pick">Question bank
            <select id="bankpick">${CFG.banks.map((b) => `<option value="${esc(b.id)}" ${b.id === bank.id ? "selected" : ""}>${esc(b.title || b.id)}</option>`).join("")}</select></label>` : ""}
        </div>

        <div class="ledger card">
          <div class="emblem" aria-hidden="true"><span>${lv.idx + 1}</span></div>
          <div class="ledger-main">
            <p class="kicker">Rank</p>
            <p class="rank">${esc(lv.name)}</p>
            <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct(lv.frac)}"><i style="width:${pct(lv.frac)}%"></i></div>
            <p class="muted small">${lv.next ? `${prog.xp - lv.floor} / ${lv.next - lv.floor} XP to ${esc(levelFor(lv.next).name)}` : "Highest rank reached."}</p>
          </div>
          <dl class="stats">
            <div><dt>XP</dt><dd>${prog.xp}</dd></div>
            <div><dt>Ports reached</dt><dd>${done}<small>/${bank.sets.length}</small></dd></div>
            <div><dt>Best streak</dt><dd>${prog.bestStreak}</dd></div>
          </dl>
        </div>

        ${run ? `<button class="resume card" data-action="open-set" data-set="${run.setId}">
            <span class="kicker">Voyage in progress</span>
            <span class="resume-title">Resume Set ${run.setId}: ${esc(SETS[run.setId].title)}</span>
            <span class="resume-go">Continue →</span></button>` : ""}

        <h2 class="section-title"><span>The Voyage</span></h2>
        <ol class="route">
          ${bank.sets.map((s, i) => portCard(s, i)).join("")}
        </ol>

        <div class="lower">
          <section>
            <h2 class="section-title"><span>Territory Chart</span></h2>
            <p class="muted small">Your mastery of each topic, from your latest answers. Missed questions you fix on the check count for half.</p>
            ${units.map((u) => `
              <h3 class="unit-label">Unit ${u}</h3>
              <div class="territory">
                ${bank.topics.filter((t) => t.unit === u).map((t) => {
                  const m = topicMastery(t.id), tr = tier(m);
                  return `<div class="tile ${tr}" title="${esc(t.title)}">
                    <span class="tile-id">${esc(t.id)}</span>
                    <span class="tile-title">${esc(t.title)}</span>
                    <span class="tile-meter"><i style="height:${pct(m.frac)}%"></i></span>
                    <span class="tile-foot">${TIER_LABEL[tr]}${m.seen ? ` · ${pct(m.frac)}%` : ""}</span>
                  </div>`;
                }).join("")}
              </div>`).join("")}
          </section>
          <section>
            <h2 class="section-title"><span>Ship's Roll</span></h2>
            <div id="leaders" class="leaders card">${LIVE ? `<p class="muted">Loading the class standings…</p>` : `<p class="muted">The class leaderboard appears once the results sheet is connected.</p>`}</div>
          </section>
        </div>
      </section>`;

    $("#bankpick")?.addEventListener("change", (e) => {
      store.set("crossings:bank", e.target.value);
      location.search = "";
      location.reload();
    });
    if (LIVE) loadLeaders();
    app.focus({ preventScroll: true });
  }

  function portCard(s, i) {
    const rec = prog.sets[s.id];
    const open = setUnlocked(i);
    const active = prog.run?.setId === s.id;
    const topics = [...new Set(s.questions.map((n) => Q[n].topic))];
    let status, cls;
    if (active) { status = "In progress"; cls = "active"; }
    else if (rec?.done) { status = `Best ${rec.score}/${rec.total}${rec.perfect ? " · flawless" : ""}`; cls = "done"; }
    else if (open) { status = `${s.questions.length} questions · set sail`; cls = "open"; }
    else { status = "Locked: reach the previous port first"; cls = "locked"; }
    return `
      <li class="port ${cls}">
        <button class="port-btn" data-action="open-set" data-set="${s.id}" ${open || active ? "" : "disabled"}>
          <span class="seal"><span>${s.id}</span></span>
          <span class="port-body">
            <span class="port-title">${esc(s.title)}</span>
            <span class="port-blurb">${esc(s.blurb || "")}</span>
            <span class="port-topics">${topics.map((t) => `<i>${esc(t)}</i>`).join("")}</span>
            <span class="port-status">${status}</span>
          </span>
        </button>
      </li>`;
  }

  async function loadLeaders() {
    const box = $("#leaders");
    try {
      if (!leadersCache || Date.now() - leadersCache.at > 60000) {
        const res = await apiGet({ action: "leaderboard", bank: bank.id });
        if (!res.ok) throw new Error(res.error);
        leadersCache = { at: Date.now(), rows: res.leaders };
      }
      const rows = leadersCache.rows;
      if (!box.isConnected) return;
      box.innerHTML = rows.length ? `<ol class="roll">${rows.map((r, i) => `
          <li class="${i < 3 ? "top" : ""}"><span class="roll-n">${i + 1}</span><span class="roll-name">${esc(r.name)}</span><span class="roll-lv">${esc(r.level || "")}</span><span class="roll-xp">${r.xp}</span></li>`).join("")}</ol>
          <p class="muted small">Standings update when a set is finished.</p>`
        : `<p class="muted">No one has finished a set yet. Be the first name on the roll.</p>`;
    } catch {
      if (box.isConnected) box.innerHTML = `<p class="muted">Couldn't load the standings right now.</p>`;
    }
  }

  // ---- runs -------------------------------------------------------------------------
  function openSet(id) {
    id = +id;
    if (prog.run && prog.run.setId !== id) {
      toast(`Finish Set ${prog.run.setId} first; it's still in progress.`);
      return;
    }
    if (!prog.run) {
      const replay = !!prog.sets[id]?.done;
      prog.run = { setId: id, replay, phase: "intro", i: 0, answers: {}, missed: [], ri: 0, ci: 0, tries: {}, xp: 0, startStreak: prog.streak };
      saveProg();
    }
    renderRun();
  }

  function renderRun() {
    stopGate();
    renderHud();
    const run = prog.run;
    if (!run) return viewHome();
    ({ intro: viewIntro, main: viewMain, review: viewReview, check: viewCheck, done: viewDone })[run.phase]();
    window.scrollTo({ top: 0 });
  }

  function addXp(n, anchor) {
    if (prog.run?.replay || !n) return 0;
    prog.xp += n;
    prog.run.xp += n;
    popXp(n, anchor);
    return n;
  }

  function setTopic(num, score) {
    const t = Q[num].topic;
    (prog.topics[t] ||= {})[num] = score;
  }

  // shared markup -----------------------------------------------------------------
  function stimHTML(id) {
    const s = id && bank.stimuli[id];
    if (!s) return "";
    if (s.type === "image") {
      return `<figure class="stim stim-img">
        <button class="zoomable" data-zoom="${esc(s.src)}" aria-label="Enlarge image"><img src="${esc(s.src)}" alt="${esc(s.alt)}"></button>
        ${s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : ""}
        <p class="hint">Tap the image to enlarge.</p></figure>`;
    }
    if (s.type === "table") {
      return `<figure class="stim stim-table">
        <figcaption class="tbl-title">${esc(s.title)}</figcaption>
        <div class="tablewrap"><table><thead><tr>${s.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${s.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join("")}</tr>`).join("")}</tbody></table></div>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}</figure>`;
    }
    return `<figure class="stim stim-text"><div class="quote">${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      ${s.source ? `<figcaption>${esc(s.source)}</figcaption>` : ""}</figure>`;
  }

  function runHead(label) {
    const run = prog.run, set = SETS[run.setId];
    const pips = set.questions.map((n, i) => {
      const a = run.answers[n];
      const st = a ? (a === Q[n].answer ? "right" : "wrong") : i === run.i && run.phase === "main" ? "now" : "";
      return `<i class="pip ${st}"></i>`;
    }).join("");
    return `<div class="run-head">
      <button class="btn ghost small" data-action="home">← Map</button>
      <div class="run-title"><span class="kicker">Set ${set.id}${run.replay ? " · practice run, no XP" : ""}</span><span>${esc(set.title)}</span></div>
      <div class="run-phase">${label}</div>
      <div class="pips" aria-hidden="true">${pips}</div>
    </div>`;
  }

  function choicesHTML(choices, opts = {}) {
    // opts: picked, correct (letter, shown), wrongs (array of disabled letters), locked
    return `<ol class="choices" role="list">${choices.map((c, i) => {
      const L = LETTERS[i];
      const cls = [
        opts.correct === L ? "is-correct" : "",
        opts.picked === L && opts.correct && opts.correct !== L ? "is-wrong" : "",
        opts.picked === L && opts.lockedRight ? "is-correct" : "",
        opts.picked === L && opts.lockedWrong ? "is-wrong" : "",
        (opts.wrongs || []).includes(L) ? "is-struck" : "",
      ].join(" ");
      const dis = opts.locked || (opts.wrongs || []).includes(L);
      return `<li><button class="choice ${cls}" data-letter="${L}" ${dis ? "disabled" : ""} aria-pressed="${opts.picked === L}">
        <span class="letter">${L}</span><span class="ctext">${esc(c)}</span></button></li>`;
    }).join("")}</ol>`;
  }

  function layout(head, stimId, inner) {
    const stim = stimHTML(stimId);
    return `<section class="run">${head}<div class="run-body ${stim ? "has-stim" : ""}">
      ${stim ? `<aside class="stim-col">${stim}</aside>` : ""}<article class="qcol">${inner}</article></div></section>`;
  }

  function wireChoices(onPick) {
    app.querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => {
      if (b.disabled) return;
      app.querySelectorAll(".choice").forEach((x) => { x.classList.remove("picked"); x.setAttribute("aria-pressed", "false"); });
      b.classList.add("picked");
      b.setAttribute("aria-pressed", "true");
      onPick(b.dataset.letter);
    }));
  }

  // reading gate: button unlocks after enough *visible* seconds -----------------------
  let gateTimer = null;
  function stopGate() { clearInterval(gateTimer); gateTimer = null; }
  function gate(btn, seconds, label) {
    stopGate();
    let left = Math.round(seconds);
    const tick = () => {
      if (left <= 0) {
        stopGate();
        btn.disabled = false;
        btn.classList.remove("waiting");
        btn.innerHTML = label;
        return;
      }
      btn.disabled = true;
      btn.classList.add("waiting");
      btn.innerHTML = `Keep reading <span class="count">${left}</span>`;
      if (document.visibilityState === "visible") left--;
    };
    tick();
    gateTimer = setInterval(tick, 1000);
  }
  const readSeconds = (text, min = READ.min, max = READ.max) => Math.min(max, Math.max(min, words(text) / READ.wordsPerSec));

  // intro ----------------------------------------------------------------------------
  function viewIntro() {
    const run = prog.run, set = SETS[run.setId];
    const topics = [...new Set(set.questions.map((n) => Q[n].topic))].map((t) => bank.topics.find((x) => x.id === t));
    app.innerHTML = `<section class="intro card">
      <div class="seal big"><span>${set.id}</span></div>
      <p class="kicker">Set ${set.id} of ${bank.sets.length}</p>
      <h1 class="display">${esc(set.title)}</h1>
      <p class="lede">${esc(set.blurb || "")}</p>
      <ul class="intro-topics">${topics.map((t) => `<li><b>${esc(t.id)}</b> ${esc(t.title)}</li>`).join("")}</ul>
      <ol class="how">
        <li><b>${set.questions.length} questions.</b> You'll see right or wrong, but not the answer yet.</li>
        <li><b>Debrief.</b> Read the explanation for each one you missed.</li>
        <li><b>Check.</b> Answer a new question on the same idea. Keep going until you get it.</li>
      </ol>
      ${run.replay ? `<p class="demo-note">You've finished this set already. This is a practice run: answers are still recorded, but you won't earn XP.</p>` : ""}
      <div class="actions"><button class="btn ghost" data-action="abandon">Not now</button><button class="btn primary" data-action="begin">Set sail →</button></div>
    </section>`;
  }

  // main questions ---------------------------------------------------------------------
  function viewMain() {
    const run = prog.run, set = SETS[run.setId];
    const num = set.questions[run.i], q = Q[num];
    const answered = run.answers[num];
    const right = answered && answered === q.answer;
    const last = run.i === set.questions.length - 1;
    app.innerHTML = layout(runHead(`Question ${run.i + 1} of ${set.questions.length}`), q.stimulus, `
      <p class="qmeta">Topic ${esc(q.topic)} · ${esc(topicTitle(q.topic))}</p>
      <h2 class="stem">${esc(q.stem)}</h2>
      ${choicesHTML(q.choices, answered ? { picked: answered, locked: true, lockedRight: right, lockedWrong: !right } : {})}
      <div class="feedback" aria-live="polite">${answered ? feedbackHTML(right) : ""}</div>
      <div class="actions">
        ${answered
          ? `<button class="btn primary" data-action="next">${last ? (run.missed.length ? "To the debrief →" : "Finish set →") : "Next question →"}</button>`
          : `<button class="btn primary" data-action="lock" disabled>Lock in answer</button>`}
      </div>`);
    let pick = null;
    if (!answered) wireChoices((L) => { pick = L; $("[data-action=lock]").disabled = false; });
    app._lock = () => {
      if (!pick || run.answers[num]) return;
      const ok = pick === q.answer;
      run.answers[num] = pick;
      const anchor = $("[data-action=lock]");
      let gained = 0;
      if (ok) {
        prog.streak++;
        prog.bestStreak = Math.max(prog.bestStreak, prog.streak);
        gained += XP.correct + (prog.streak >= XP.streakFrom ? XP.streakBonus : 0);
        setTopic(num, 1);
      } else {
        prog.streak = 0;
        run.missed.push(num);
        setTopic(num, 0);
      }
      addXp(gained, anchor);
      enqueue({ action: "answer", set: set.id, phase: "main", num, topic: q.topic, chosen: pick, correct: q.answer, isCorrect: ok, attempt: 1 });
      saveProg();
      renderRun();
    };
  }

  function feedbackHTML(right) {
    if (right) {
      const s = prog.streak;
      return `<p class="fb good"><b>Correct.</b> ${s >= XP.streakFrom ? `${flame()} ${s} in a row: streak bonus.` : "Keep it rolling."}</p>`;
    }
    return `<p class="fb bad"><b>Not this time.</b> You'll get the full story in the debrief at the end of the set.</p>`;
  }

  const topicTitle = (id) => bank.topics.find((t) => t.id === id)?.title || "";

  // debrief ---------------------------------------------------------------------------
  function viewReview() {
    const run = prog.run;
    const num = run.missed[run.ri], q = Q[num];
    const last = run.ri === run.missed.length - 1;
    app.innerHTML = layout(runHead(`Debrief ${run.ri + 1} of ${run.missed.length}`), q.stimulus, `
      <p class="qmeta">Question you missed · Topic ${esc(q.topic)}</p>
      <h2 class="stem">${esc(q.stem)}</h2>
      ${choicesHTML(q.choices, { picked: run.answers[num], correct: q.answer, locked: true })}
      <div class="log">
        <p class="log-head"><span>Ship's log</span><span class="muted small">You chose ${run.answers[num]} · Answer ${q.answer}</span></p>
        <p>${esc(q.explanation || "Explanation coming soon.")}</p>
      </div>
      <div class="actions"><button class="btn primary" data-action="read-next">…</button></div>`);
    gate($("[data-action=read-next]"), readSeconds(q.explanation || ""), last ? "Got it: on to the check →" : "Got it: next →");
  }

  // checks (parallel questions) ---------------------------------------------------------
  function viewCheck() {
    const run = prog.run;
    const num = run.missed[run.ci], p = Q[num].parallel;
    const tries = run.tries[num] || [];
    const solved = tries.includes(p.answer);
    const wrongs = tries.filter((L) => L !== p.answer);
    const last = run.ci === run.missed.length - 1;
    const showing = run.showExp === num;  // just missed: show explanation before retry
    app.innerHTML = layout(runHead(`Check ${run.ci + 1} of ${run.missed.length}`), p.stimulus, `
      <p class="qmeta">Check for understanding · same idea as question ${run.i !== undefined ? SETS[run.setId].questions.indexOf(num) + 1 : ""}</p>
      <h2 class="stem">${esc(p.stem)}</h2>
      ${choicesHTML(p.choices, solved ? { picked: p.answer, locked: true, lockedRight: true, wrongs } : { wrongs, locked: showing, picked: showing ? tries[tries.length - 1] : null, lockedWrong: showing })}
      <div class="feedback" aria-live="polite">
        ${solved ? `<p class="fb good"><b>Got it.</b> ${tries.length === 1 ? "First try." : "You worked it out."}</p>` : ""}
        ${showing ? `<div class="log"><p class="log-head"><span>Not quite. Here's why</span></p><p>${esc(p.explanation)}</p></div>` : ""}
      </div>
      <div class="actions">
        ${solved ? `<button class="btn primary" data-action="check-next">${last ? "Finish set →" : "Next check →"}</button>`
          : showing ? `<button class="btn primary" data-action="retry">…</button>`
          : `<button class="btn primary" data-action="lock" disabled>Lock in answer</button>`}
      </div>`);
    if (showing) gate($("[data-action=retry]"), readSeconds(p.explanation, READ.parallelMin, READ.parallelMax), "Try again →");
    let pick = null;
    if (!solved && !showing) wireChoices((L) => { pick = L; $("[data-action=lock]").disabled = false; });
    app._lock = () => {
      if (!pick) return;
      const ok = pick === p.answer;
      (run.tries[num] ||= []).push(pick);
      const attempt = run.tries[num].length;
      if (ok) {
        addXp(attempt === 1 ? XP.checkFirst : XP.checkRetry, $("[data-action=lock]"));
        setTopic(num, attempt === 1 ? 0.5 : 0.25);
      } else {
        run.showExp = num;
      }
      enqueue({ action: "answer", set: run.setId, phase: "check", num, topic: Q[num].topic, chosen: pick, correct: p.answer, isCorrect: ok, attempt });
      saveProg();
      renderRun();
    };
  }

  // set complete -------------------------------------------------------------------------
  function finishRun() {
    const run = prog.run, set = SETS[run.setId];
    const total = set.questions.length, score = total - run.missed.length;
    const perfect = run.missed.length === 0;
    addXp(XP.setComplete + (perfect ? XP.perfect : 0));
    const prev = prog.sets[set.id];
    prog.sets[set.id] = {
      done: true, total, at: Date.now(),
      score: Math.max(score, prev?.score ?? 0),
      first: prev?.first ?? score,
      perfect: perfect || !!prev?.perfect,
      runs: (prev?.runs || 0) + 1,
    };
    const checkAttempts = Object.values(run.tries).reduce((a, t) => a + t.length, 0);
    run.summary = { score, total, perfect, checkAttempts };
    run.phase = "done";
    const { run: _omit, ...snapshot } = prog;
    enqueue({
      action: "set", set: set.id, title: set.title, score, total, missed: run.missed.map((n) => n),
      checkAttempts, xpEarned: run.xp, totalXp: prog.xp, level: levelFor(prog.xp).name,
      setsDone: Object.values(prog.sets).filter((s) => s.done).length, replay: run.replay, progress: snapshot,
    });
    leadersCache = null;
    saveProg();
    renderRun();
  }

  function viewDone() {
    const run = prog.run, set = SETS[run.setId], s = run.summary;
    const lvBefore = levelFor(prog.xp - run.xp), lv = levelFor(prog.xp);
    const idx = bank.sets.findIndex((x) => x.id === set.id);
    const nextSet = bank.sets[idx + 1];
    const topics = [...new Set(set.questions.map((n) => Q[n].topic))];
    app.innerHTML = `<section class="finish card">
      <div class="seal big ${s.perfect ? "gold" : ""}"><span>${set.id}</span></div>
      <p class="kicker">Port reached</p>
      <h1 class="display">${s.perfect ? "A flawless crossing." : "Set complete."}</h1>
      <div class="scoreline">
        <div><span class="big-n">${s.score}<small>/${s.total}</small></span><span class="muted small">first try</span></div>
        <div><span class="big-n">${run.replay ? "—" : "+" + run.xp}</span><span class="muted small">${run.replay ? "practice run" : "XP earned"}</span></div>
        <div><span class="big-n">${s.checkAttempts}</span><span class="muted small">check attempts</span></div>
      </div>
      ${lv.idx > lvBefore.idx ? `<p class="levelup">New rank: <b>${esc(lv.name)}</b></p>` : ""}
      <div class="mini-territory">${topics.map((t) => {
        const m = topicMastery(t), tr = tier(m);
        return `<div class="tile small ${tr}"><span class="tile-id">${esc(t)}</span><span class="tile-meter"><i style="height:${pct(m.frac)}%"></i></span><span class="tile-foot">${TIER_LABEL[tr]} · ${pct(m.frac)}%</span></div>`;
      }).join("")}</div>
      <div class="actions">
        <button class="btn ghost" data-action="close-run">Back to the map</button>
        ${nextSet ? `<button class="btn primary" data-action="close-run" data-then="${nextSet.id}">Next: Set ${nextSet.id} →</button>` : ""}
      </div>
    </section>`;
  }

  // ---- events -------------------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const zoom = e.target.closest("[data-zoom]");
    if (zoom) {
      const d = $("#zoom");
      d.querySelector("img").src = zoom.dataset.zoom;
      d.querySelector("img").alt = zoom.querySelector("img")?.alt || "";
      d.showModal();
      return;
    }
    if (e.target.closest("#zoom [data-close]") || e.target.id === "zoom") { $("#zoom").close(); return; }
    const go = e.target.closest("[data-go]");
    if (go) { e.preventDefault(); if (profile && prog) viewHome(); return; }
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const run = prog?.run;
    switch (el.dataset.action) {
      case "signout": return signOut();
      case "home": return viewHome();
      case "open-set": return openSet(el.dataset.set);
      case "begin": run.phase = "main"; saveProg(); return renderRun();
      case "abandon": prog.run = null; saveProg(); return viewHome();
      case "lock": return app._lock?.();
      case "next":
        if (run.i < SETS[run.setId].questions.length - 1) run.i++;
        else if (run.missed.length) run.phase = "review";
        else return finishRun();
        saveProg(); return renderRun();
      case "read-next":
        if (run.ri < run.missed.length - 1) run.ri++;
        else run.phase = "check";
        saveProg(); return renderRun();
      case "retry": run.showExp = null; saveProg(); return renderRun();
      case "check-next":
        if (run.ci < run.missed.length - 1) { run.ci++; saveProg(); return renderRun(); }
        return finishRun();
      case "close-run": {
        prog.run = null;
        saveProg();
        const then = el.dataset.then;
        return then && setUnlocked(bank.sets.findIndex((s) => s.id === +then)) ? openSet(then) : viewHome();
      }
    }
  });

  // keyboard: A-E or 1-5 picks, Enter presses the main button
  document.addEventListener("keydown", (e) => {
    if (!prog?.run || e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($("#zoom").open) return;
    const k = e.key.toUpperCase();
    const i = LETTERS.indexOf(k) >= 0 ? LETTERS.indexOf(k) : "12345".indexOf(k);
    if (i >= 0) {
      const b = app.querySelectorAll(".choice")[i];
      if (b && !b.disabled) { b.click(); b.focus(); }
    } else if (e.key === "Enter" && !e.target.matches("button")) {
      const b = app.querySelector(".actions .btn.primary");
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    }
  });

  // ---- boot ---------------------------------------------------------------------------
  (async () => {
    try {
      await loadBank();
    } catch (err) {
      app.innerHTML = `<p class="warn">Couldn't load the question bank. ${esc(err.message)}</p>`;
      return;
    }
    if (!profile) return viewSignin();
    loadProg();
    viewHome();
    pullServerProgress().then(() => { if (!prog.run) viewHome(); else renderHud(); });
    flush();
  })();
})();
