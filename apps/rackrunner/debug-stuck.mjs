/** Debug stuck tournament */
import { readFileSync } from 'fs';
// inline minimal from sim
function nextPowerOf2(n) { let p = 1; while (p < n) p *= 2; return p; }

function buildBracket(players) {
  const n = players.length;
  const size = nextPowerOf2(n);
  const totalWRounds = Math.log2(size);
  const bracket = { W: {}, L: {}, F: {}, R: {} };
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
  const seeds = getSeedOrder(size);
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
  const totalLRounds = (totalWRounds - 1) * 2;
  for (let r = 1; r <= totalLRounds; r++) {
    const matchCount = Math.pow(2, Math.floor((totalLRounds - r) / 2));
    for (let m = 1; m <= matchCount; m++) {
      bracket.L[`L${r}-${m}`] = { code: `L${r}-${m}`, p1: null, p2: null, winner: null, loser: null, status: "pending" };
    }
  }
  bracket.F["F1"] = { code: "F1", p1: null, p2: null, winner: null, loser: null, status: "pending" };
  bracket.R["R1"] = { code: "R1", p1: null, p2: null, winner: null, loser: null, status: "pending" };
  return { bracket, totalWRounds, totalLRounds };
}

function resolveByes(bracket, feedNext) {
  for (const code in bracket.W) {
    const m = bracket.W[code];
    if (m.status === "pending" && (m.p1 === "BYE" || m.p2 === "BYE")) {
      if (m.p1 === "BYE" && m.p2 === "BYE") { m.winner = "BYE"; m.loser = "BYE"; m.status = "done"; }
      else if (m.p1 === "BYE") { m.winner = m.p2; m.loser = "BYE"; m.status = "done"; }
      else { m.winner = m.p1; m.loser = "BYE"; m.status = "done"; }
      feedNext(m);
    }
  }
}

function makeFeedNext(bracket, state) {
  return function feedNext(m) {
    const code = m.code;
    const winner = m.winner;
    const loser = m.loser;
    if (code.startsWith("W")) {
      const parts = code.substring(1).split("-");
      const r = parseInt(parts[0]);
      const i = parseInt(parts[1]);
      const nextW = `W${r + 1}-${Math.ceil(i / 2)}`;
      if (bracket.W[nextW]) {
        if (i % 2 === 1) bracket.W[nextW].p1 = winner;
        else bracket.W[nextW].p2 = winner;
      } else bracket.F["F1"].p1 = winner;
      if (loser && loser !== "BYE") {
        if (r === 1) {
          const nextL = `L1-${Math.ceil(i / 2)}`;
          if (bracket.L[nextL]) {
            if (i % 2 === 1) bracket.L[nextL].p1 = loser;
            else bracket.L[nextL].p2 = loser;
          }
        } else {
          const targetLR = (r - 1) * 2;
          const count = Object.keys(bracket.L).filter(k => k.startsWith(`L${targetLR}-`)).length;
          const dropIndex = count - i + 1;
          const nextL = `L${targetLR}-${dropIndex}`;
          if (bracket.L[nextL]) bracket.L[nextL].p2 = loser;
        }
      }
    } else if (code.startsWith("L")) {
      const parts = code.substring(1).split("-");
      const r = parseInt(parts[0]);
      const i = parseInt(parts[1]);
      const totalLRounds = Object.keys(bracket.L).reduce((max, k) => Math.max(max, parseInt(k.substring(1).split("-")[0])), 0);
      if (r === totalLRounds) bracket.F["F1"].p2 = winner;
      else if (r % 2 === 1) {
        const nextL = `L${r + 1}-${i}`;
        if (bracket.L[nextL]) bracket.L[nextL].p1 = winner;
      } else {
        const nextL = `L${r + 1}-${Math.ceil(i / 2)}`;
        if (bracket.L[nextL]) {
          if (i % 2 === 1) bracket.L[nextL].p1 = winner;
          else bracket.L[nextL].p2 = winner;
        }
      }
    } else if (code === "F1") {
      if (winner === m.p1) state.phase = "complete";
      else { bracket.R["R1"].p1 = m.p1; bracket.R["R1"].p2 = m.p2; }
    } else if (code === "R1") state.phase = "complete";
    resolveByes(bracket, feedNext);
  };
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
  if (bracket.F["F1"].status !== "done" && bracket.F["F1"].p1 && bracket.F["F1"].p2) list.push(bracket.F["F1"]);
  if (bracket.F["F1"].status === "done" && bracket.R["R1"].p1 && bracket.R["R1"].p2 && bracket.R["R1"].status !== "done") list.push(bracket.R["R1"]);
  return list;
}

function dump(bracket) {
  const pending = [];
  for (const k of Object.keys(bracket.W).concat(Object.keys(bracket.L), ['F1','R1'])) {
    const m = bracket.W[k] || bracket.L[k] || bracket.F[k] || bracket.R[k];
    if (m && m.status !== 'done') pending.push(`${m.code}: p1=${m.p1} p2=${m.p2}`);
  }
  return pending;
}

const n = 9;
const players = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const { bracket } = buildBracket(players);
const state = { phase: 'active' };
const feedNext = makeFeedNext(bracket, state);
resolveByes(bracket, feedNext);
console.log('after byes playable', getPlayable(bracket).map(m => m.code));
let steps = 0;
while (state.phase !== 'complete' && steps < 50) {
  const playable = getPlayable(bracket);
  if (!playable.length) {
    console.log('STUCK at step', steps);
    console.log(dump(bracket).join('\n'));
    break;
  }
  const m = playable[0];
  const winner = m.p1;
  m.winner = winner;
  m.loser = m.p1 === winner ? m.p2 : m.p1;
  m.status = 'done';
  feedNext(m);
  steps++;
}
console.log('steps', steps, 'phase', state.phase);
