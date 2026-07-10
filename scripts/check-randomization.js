/**
 * Verify the two randomization mechanisms of the v2 study.
 *
 *   A. Pair assignment  (/api/assign-pairs): each participant gets N_PAIRS pairs,
 *      balanced toward least-covered pairs + less-seen left/right side.
 *   B. Variant per brand (client): each participant is shown ONE variant per
 *      brand, drawn uniformly at random, HELD CONSTANT for the whole session.
 *
 * SECTION 1 checks the invariants on the REAL sessions in the DB (esp. held-
 * constant, and that different participants got different variants/pairs).
 * SECTION 2 simulates many participants to prove the distributions (uniform
 * variants; even pair + position coverage) — the live data is too small for that.
 *
 *   node scripts/check-randomization.js [experiment_name] [sim_participants]
 *      (default experiment_name: provided-brand-positioning-brandvoice2-2026-07-09;
 *      default sim_participants: 20000 / 400)
 */
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoDir, '.env.local') });

const EXP = process.argv[2] || 'provided-brand-positioning-brandvoice2-2026-07-09';
const N_PAIRS = 15;
const stim = JSON.parse(fs.readFileSync(path.join(repoDir, 'stimuli', EXP, 'stimuli.json'), 'utf8'));
const IDS = stim.products.map(p => p.id).sort();
const VARIANTS = new Map(stim.products.map(p => [p.id, p.variants.map(v => v.variant)]));

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const allPairs = () => { const out = []; for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) out.push(`${IDS[i]}_${IDS[j]}`); return out; };

async function section1_realData() {
  console.log('==================================================================');
  console.log('SECTION 1 — REAL sessions in the DB');
  console.log('==================================================================');
  if (!process.env.POSTGRES_URL) { console.log('POSTGRES_URL not set — skipping real-data section.\n'); return; }
  const sql = neon(process.env.POSTGRES_URL);
  const rows = await sql`
    SELECT s.session_id, t.trial_number, t.is_catch_trial,
           t.data->>'left_product_id'  AS lpid, t.data->>'right_product_id' AS rpid,
           t.data->>'left_variant'     AS lvar, t.data->>'right_variant'    AS rvar
    FROM sessions s JOIN trials t ON t.session_id = s.session_id
    WHERE s.experiment_name = ${EXP} AND t.trial_number < 1001
    ORDER BY s.started_at, t.trial_number`;

  const sessions = new Map();
  for (const r of rows) {
    if (!sessions.has(r.session_id)) sessions.set(r.session_id, []);
    sessions.get(r.session_id).push(r);
  }
  console.log(`sessions with trials: ${sessions.size}\n`);
  if (sessions.size === 0) { console.log('(no data yet)\n'); return; }

  // held-constant per session (Question 2): same brand in >1 trial -> same variant
  let heldPass = 0, totalRecurrences = 0, violations = 0;
  const perSessionVariant = new Map();  // sessionId -> {brand -> variant}
  for (const [sid, trials] of sessions) {
    const map = {};
    let conflict = false;
    for (const t of trials) for (const [id, v] of [[t.lpid, t.lvar], [t.rpid, t.rvar]]) {
      if (id == null) continue;
      if (id in map) { totalRecurrences++; if (map[id] !== v) { conflict = true; violations++; console.log(`  VIOLATION session ${sid}: brand ${id} shown variant ${map[id]} then ${v}`); } }
      else map[id] = v;
    }
    if (!conflict) heldPass++;
    perSessionVariant.set(sid, map);
  }
  console.log(`Q2 held-constant: ${heldPass}/${sessions.size} sessions OK`);
  console.log(`   (${totalRecurrences} within-session brand recurrences checked, ${violations} violation(s))\n`);

  // cross-session variation: did different participants get different variants?
  console.log('Cross-session variant per brand (should VARY across participants):');
  for (const id of IDS) {
    const picks = [...perSessionVariant.values()].map(m => m[id]).filter(v => v != null);
    const distinct = [...new Set(picks)];
    console.log(`   ${id}: [${picks.join(', ')}]${picks.length > 1 ? `  (${distinct.length} distinct)` : ''}`);
  }

  // real pair coverage so far
  const pairSeen = new Set(), posCount = { AB: 0, BA: 0 };
  for (const trials of sessions.values()) for (const t of trials) if (!t.is_catch_trial) { pairSeen.add([t.lpid, t.rpid].sort().join('_')); }
  console.log(`\nDistinct non-catch pairs covered so far: ${pairSeen.size} / ${allPairs().length}`);
  console.log('(sparse with few sessions — the simulation below shows how coverage fills in.)\n');
}

function section2a_variantUniformity(M) {
  console.log('==================================================================');
  console.log(`SECTION 2A — SIMULATE variant draw (${M} participants)`);
  console.log('==================================================================');
  // Each participant: one uniform pick per brand (the actual client logic).
  const tally = new Map(IDS.map(id => [id, new Map(VARIANTS.get(id).map(v => [v, 0]))]));
  for (let i = 0; i < M; i++) for (const id of IDS) {
    const vs = VARIANTS.get(id);
    const pick = vs[Math.floor(Math.random() * vs.length)];
    tally.get(id).set(pick, tally.get(id).get(pick) + 1);
  }
  // chi-square vs uniform per brand
  let worstChi = 0, minShare = 1, maxShare = 0;
  for (const id of IDS) {
    const vs = VARIANTS.get(id), exp = M / vs.length;
    let chi = 0;
    for (const v of vs) { const obs = tally.get(id).get(v); chi += (obs - exp) ** 2 / exp; const share = obs / M; if (share < minShare) minShare = share; if (share > maxShare) maxShare = share; }
    if (chi > worstChi) worstChi = chi;
  }
  const df = VARIANTS.get(IDS[0]).length - 1;
  // chi-square critical value at p=0.001 for this df (Wilson–Hilferty
  // approximation; e.g. ~27.9 for df=9, ~43.9 for df=19).
  const z = 3.090232; // standard normal quantile for p=0.001
  const crit = Math.round(df * (1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))) ** 3 * 10) / 10;
  console.log(`per brand: ${VARIANTS.get(IDS[0]).length} variants, expected share = ${(100 / VARIANTS.get(IDS[0]).length).toFixed(1)}% each`);
  console.log(`observed variant share range across all brands: ${(minShare * 100).toFixed(2)}% .. ${(maxShare * 100).toFixed(2)}%`);
  console.log(`worst per-brand chi-square (df=${df}): ${worstChi.toFixed(1)}  (uniform if < ${crit} at p=0.001)`);
  console.log(worstChi < crit ? 'PASS — variant draw is uniform per brand.\n' : 'FAIL — a brand deviates from uniform.\n');
  // sample: brand-01 counts
  const b1 = IDS[0];
  console.log(`sample (${b1}) counts by variant: ${VARIANTS.get(b1).map(v => `${v}:${tally.get(b1).get(v)}`).join('  ')}\n`);
}

function section2b_pairBalance(P) {
  console.log('==================================================================');
  console.log(`SECTION 2B — SIMULATE pair assignment (${P} participants, ${N_PAIRS} pairs each)`);
  console.log('==================================================================');
  const counts = new Map();  // "pid|AB"/"pid|BA" -> n
  const get = k => counts.get(k) || 0;
  const pairs0 = allPairs();
  let distinctOk = true, selfOk = true;

  for (let p = 0; p < P; p++) {
    const list = pairs0.map(pid => { const ab = get(pid + '|AB'), ba = get(pid + '|BA'); return { pid, ab, ba, total: ab + ba }; });
    shuffle(list);                         // pre-shuffle => random tie-break (stable sort)
    list.sort((a, b) => a.total - b.total); // least-covered first
    const sel = list.slice(0, N_PAIRS);
    if (new Set(sel.map(s => s.pid)).size !== N_PAIRS) distinctOk = false;
    if (sel.some(s => { const [a, b] = s.pid.split('_'); return a === b; })) selfOk = false;
    for (const s of sel) {
      const pos = s.ab < s.ba ? 'AB' : s.ba < s.ab ? 'BA' : (Math.random() < 0.5 ? 'AB' : 'BA');
      counts.set(s.pid + '|' + pos, get(s.pid + '|' + pos) + 1);
    }
  }
  // coverage + position balance per pair
  let min = Infinity, max = -Infinity, sum = 0, uncovered = 0, maxImbalance = 0;
  for (const pid of pairs0) {
    const ab = get(pid + '|AB'), ba = get(pid + '|BA'), tot = ab + ba;
    if (tot === 0) uncovered++;
    if (tot < min) min = tot; if (tot > max) max = tot; sum += tot;
    if (Math.abs(ab - ba) > maxImbalance) maxImbalance = Math.abs(ab - ba);
  }
  const mean = sum / pairs0.length;
  console.log(`possible pairs: ${pairs0.length}   total ratings placed: ${P * N_PAIRS}`);
  console.log(`per-pair coverage: min ${min}, max ${max}, mean ${mean.toFixed(1)}  (spread max-min = ${max - min})`);
  console.log(`uncovered pairs: ${uncovered}`);
  console.log(`max within-pair left/right imbalance |AB-BA|: ${maxImbalance}`);
  console.log(`every participant got ${N_PAIRS} DISTINCT pairs: ${distinctOk ? 'yes' : 'NO'};  no self-pairs: ${selfOk ? 'yes' : 'NO'}`);
  const balanced = uncovered === 0 && (max - min) <= 2 * N_PAIRS && maxImbalance <= N_PAIRS && distinctOk && selfOk;
  console.log(balanced ? 'PASS — pairs and left/right sides are evenly balanced.\n' : 'CHECK — see numbers above.\n');
}

async function main() {
  const argM = parseInt(process.argv[3], 10);
  const M = Number.isFinite(argM) ? argM : 20000;
  const P = 400;
  await section1_realData();
  section2a_variantUniformity(M);
  section2b_pairBalance(P);
}
main().catch(e => { console.error('check failed:', e); process.exit(1); });
