/** Audit fixed RackRunner DE logic for 2–20 players */
function nextPowerOf2(n) { let p = 1; while (p < n) p *= 2; return p; }
function getSeedOrder(num) {
  if (num === 2) return [1, 2];
  const prev = getSeedOrder(num / 2);
  const next = [];
  for (let i = 0; i < prev.length; i++) {
    next.push(prev[i]);
    next.push(num + 1 - prev[i]);
  }
  return next;
}

function buildAll(players) {
  const n = players.length;
  const size = nextPowerOf2(n);
  const totalWRounds = Math.log2(size);
  const totalLRounds = totalWRounds > 1 ? (totalWRounds - 1) * 2 : 0;
  const seeds = getSeedOrder(size);
  const bracket = { W: {}, L: {}, F: {}, R: {} };
  const feeders = {};

  function addFeed(target, slot, from, type) {
    if (!feeders[target]) feeders[target] = { p1: [], p2: [] };
    feeders[target][slot].push({ from, type });
  }

  for (let r = 1; r <= totalWRounds; r++) {
    const matchCount = size / Math.pow(2, r);
    for (let m = 1; m <= matchCount; m++) {
      const code = `W${r}-${m}`;
      let p1 = null, p2 = null;
      if (r === 1) {
        const s1 = seeds[(m - 1) * 2];
        const s2 = seeds[(m - 1) * 2 + 1];
        p1 = s1 <= n ? players[s1 - 1].id : "BYE";
        p2 = s2 <= n ? players[s2 - 1].id : "BYE";
      }
      bracket.W[code] = { code, p1, p2, winner: null, loser: null, status: "pending" };
    }
  }
  for (let r = 1; r <= totalLRounds; r++) {
    const matchCount = Math.pow(2, Math.floor((totalLRounds - r) / 2));
    for (let m = 1; m <= matchCount; m++) {
      bracket.L[`L${r}-${m}`] = { code: `L${r}-${m}`, p1: null, p2: null, winner: null, loser: null, status: "pending" };
    }
  }
  bracket.F.F1 = { code: "F1", p1: null, p2: null, winner: null, loser: null, status: "pending" };
  bracket.R.R1 = { code: "R1", p1: null, p2: null, winner: null, loser: null, status: "pending" };

  for (let r = 1; r < totalWRounds; r++) {
    const matchCount = size / Math.pow(2, r);
    for (let i = 1; i <= matchCount; i++) {
      addFeed(`W${r + 1}-${Math.ceil(i / 2)}`, i % 2 === 1 ? "p1" : "p2", `W${r}-${i}`, "winner");
    }
  }
  addFeed("F1", "p1", `W${totalWRounds}-1`, "winner");
  for (let r = 1; r <= totalWRounds; r++) {
    const matchCount = size / Math.pow(2, r);
    for (let i = 1; i <= matchCount; i++) {
      const code = `W${r}-${i}`;
      if (totalLRounds === 0) {
        if (r === totalWRounds) addFeed("F1", "p2", code, "loser");
      } else if (r === 1) {
        addFeed(`L1-${Math.ceil(i / 2)}`, i % 2 === 1 ? "p1" : "p2", code, "loser");
      } else {
        const targetLR = (r - 1) * 2;
        const count = Math.pow(2, Math.floor((totalLRounds - targetLR) / 2));
        addFeed(`L${targetLR}-${count - i + 1}`, "p2", code, "loser");
      }
    }
  }
  for (let r = 1; r < totalLRounds; r++) {
    const matchCount = Math.pow(2, Math.floor((totalLRounds - r) / 2));
    for (let i = 1; i <= matchCount; i++) {
      const code = `L${r}-${i}`;
      if (r === totalLRounds - 1) addFeed("F1", "p2", code, "winner");
      else if (r % 2 === 1) addFeed(`L${r + 1}-${i}`, "p1", code, "winner");
      else {
        const nextL = `L${r + 1}-${Math.ceil(i / 2)}`;
        addFeed(nextL, i % 2 === 1 ? "p1" : "p2", code, "winner");
      }
    }
  }

  return { bracket, feeders, totalLRounds };
}

function findMatch(bracket, code) {
  return bracket.W[code] || bracket.L[code] || bracket.F[code] || bracket.R[code];
}

function slotWillGetPlayer(bracket, feeders, matchCode, slot) {
  const feeds = feeders[matchCode]?.[slot] || [];
  for (const f of feeds) {
    const src = findMatch(bracket, f.from);
    if (!src) continue;
    if (src.status !== "done") return true;
    if (f.type === "loser" && src.loser && src.loser !== "BYE") return true;
    if (f.type === "winner" && src.winner && src.winner !== "BYE") return true;
  }
  return false;
}

function feedNext(bracket, m, state) {
  const code = m.code;
  const winner = m.winner;
  const loser = m.loser;
  if (code.startsWith("W")) {
    const [r, i] = [parseInt(code.substring(1).split("-")[0]), parseInt(code.substring(1).split("-")[1])];
    const nextW = `W${r + 1}-${Math.ceil(i / 2)}`;
    if (bracket.W[nextW]) {
      if (i % 2 === 1) bracket.W[nextW].p1 = winner;
      else bracket.W[nextW].p2 = winner;
    } else bracket.F.F1.p1 = winner;
    if (loser && loser !== "BYE") {
      const totalLRounds = Object.keys(bracket.L).reduce((max, k) => Math.max(max, parseInt(k.substring(1).split("-")[0])), 0);
      if (totalLRounds === 0) bracket.F.F1.p2 = loser;
      else if (r === 1) {
        const nextL = `L1-${Math.ceil(i / 2)}`;
        if (bracket.L[nextL]) {
          if (i % 2 === 1) bracket.L[nextL].p1 = loser;
          else bracket.L[nextL].p2 = loser;
        }
      } else {
        const targetLR = (r - 1) * 2;
        const count = Object.keys(bracket.L).filter(k => k.startsWith(`L${targetLR}-`)).length;
        bracket.L[`L${targetLR}-${count - i + 1}`].p2 = loser;
      }
    }
  } else if (code.startsWith("L")) {
    const r = parseInt(code.substring(1).split("-")[0]);
    const i = parseInt(code.substring(1).split("-")[1]);
    const totalLRounds = Object.keys(bracket.L).reduce((max, k) => Math.max(max, parseInt(k.substring(1).split("-")[0])), 0);
    if (r === totalLRounds) bracket.F.F1.p2 = winner;
    else if (r % 2 === 1) bracket.L[`L${r + 1}-${i}`].p1 = winner;
    else {
      const nextL = `L${r + 1}-${Math.ceil(i / 2)}`;
      if (i % 2 === 1) bracket.L[nextL].p1 = winner;
      else bracket.L[nextL].p2 = winner;
    }
  } else if (code === "F1") {
    if (winner === m.p1) {
      bracket.F.F1.winner = winner;
      state.phase = "complete";
    } else {
      bracket.R.R1.p1 = m.p1;
      bracket.R.R1.p2 = m.p2;
    }
  } else if (code === "R1") state.phase = "complete";
}

function completeMatch(bracket, feeders, m, state) {
  m.status = "done";
  feedNext(bracket, m, state);
  resolveAuto(bracket, feeders, state);
}

function resolveByesIn(bracket, feeders, obj, state) {
  for (const code in obj) {
    const m = obj[code];
    if (m.status !== "pending") continue;
    if (m.p1 === "BYE" || m.p2 === "BYE") {
      if (m.p1 === "BYE" && m.p2 === "BYE") { m.winner = "BYE"; m.loser = "BYE"; completeMatch(bracket, feeders, m, state); }
      else if (m.p1 === "BYE") { m.winner = m.p2; m.loser = "BYE"; completeMatch(bracket, feeders, m, state); }
      else { m.winner = m.p1; m.loser = "BYE"; completeMatch(bracket, feeders, m, state); }
    }
  }
}

function resolveWalkovers(bracket, feeders, state) {
  const all = [...Object.values(bracket.W), ...Object.values(bracket.L), bracket.F.F1, bracket.R.R1];
  for (const m of all) {
    if (m.status === "done") continue;
    const ok1 = m.p1 && m.p1 !== "BYE";
    const ok2 = m.p2 && m.p2 !== "BYE";
    if (ok1 && ok2) continue;
    if (ok1 && !ok2 && !slotWillGetPlayer(bracket, feeders, m.code, "p2")) {
      m.winner = m.p1; m.loser = m.p2; completeMatch(bracket, feeders, m, state);
    } else if (ok2 && !ok1 && !slotWillGetPlayer(bracket, feeders, m.code, "p1")) {
      m.winner = m.p2; m.loser = m.p1; completeMatch(bracket, feeders, m, state);
    }
  }
}

function resolveAuto(bracket, feeders, state) {
  resolveByesIn(bracket, feeders, bracket.W, state);
  resolveWalkovers(bracket, feeders, state);
  resolveByesIn(bracket, feeders, bracket.W, state);
  resolveWalkovers(bracket, feeders, state);
}

function getPlayable(bracket) {
  const list = [];
  const collect = obj => {
    for (const k in obj) {
      const m = obj[k];
      if (m.status !== "done" && m.p1 && m.p2 && m.p1 !== "BYE" && m.p2 !== "BYE") list.push(m);
    }
  };
  collect(bracket.W);
  collect(bracket.L);
  if (bracket.F.F1.status !== "done" && bracket.F.F1.p1 && bracket.F.F1.p2) list.push(bracket.F.F1);
  if (bracket.F.F1.status === "done" && bracket.R.R1.p1 && bracket.R.R1.p2 && bracket.R.R1.status !== "done") list.push(bracket.R.R1);
  return list;
}

function run(n, lbWinsGF) {
  const players = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const { bracket, feeders } = buildAll(players);
  const state = { phase: "active" };
  resolveAuto(bracket, feeders, state);
  let steps = 0;
  while (state.phase !== "complete" && steps < 600) {
    const playable = getPlayable(bracket);
    if (!playable.length) return { ok: false, n, steps, reason: "stuck" };
    const m = playable[0];
    let winner;
    if (m.code === "F1" && lbWinsGF) winner = m.p2;
    else if (m.code === "R1") winner = m.p2;
    else winner = m.p1;
    m.winner = winner;
    m.loser = m.p1 === winner ? m.p2 : m.p1;
    completeMatch(bracket, feeders, m, state);
    steps++;
  }
  return { ok: state.phase === "complete", n, steps, reset: bracket.R.R1.status === "done" };
}

let fail = 0;
for (let n = 2; n <= 20; n++) {
  const a = run(n, false);
  const b = run(n, true);
  if (!a.ok || !b.ok) {
    console.log("FAIL", n, a, b);
    fail++;
  } else {
    console.log("OK", n, "steps", a.steps, "reset", b.reset);
  }
}
console.log(fail ? `FAILED ${fail}` : "ALL 2-20 PASS");
