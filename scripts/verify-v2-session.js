/**
 * Verify a v2 session was written to the DB correctly (read-only spot-check).
 *
 *   node scripts/verify-v2-session.js                      # latest session for the LIVE arm (config-v2.js)
 *   node scripts/verify-v2-session.js <experiment_name>    # latest for another experiment
 *   node scripts/verify-v2-session.js --session <uuid>     # a specific session
 *
 * Reads POSTGRES_URL from .env.local. Prints the session + its trials and runs
 * assertions (completed, demographics, 1 catch, per-side variants present, catch
 * equality, held-constant per brand, rating/position/pair_id sanity).
 */
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoDir, '.env.local') });

// Default to the live arm rather than a hardcoded name: a stale default here
// silently verifies a retired study's session and reports its failures as if
// they were the current arm's.
const CONFIG = (await import(pathToFileURL(path.join(repoDir, 'config-v2.js')).href)).default;
const argv = process.argv.slice(2);
let experiment = CONFIG.EXPERIMENT_NAME;
let sessionId = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--session') sessionId = argv[++i];
  else if (!argv[i].startsWith('--')) experiment = argv[i];
}

if (!process.env.POSTGRES_URL) { console.error('POSTGRES_URL not set (.env.local).'); process.exit(1); }
const sql = neon(process.env.POSTGRES_URL);

const checks = [];
const ok = (name, cond, extra = '') => { checks.push(!!cond); console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

async function main() {
  const counts = await sql`SELECT COUNT(*)::int AS sessions, COUNT(completed_at)::int AS completed FROM sessions WHERE experiment_name = ${experiment}`;
  console.log(`Experiment "${experiment}": ${counts[0].sessions} session(s), ${counts[0].completed} completed.`);

  const r = sessionId
    ? await sql`SELECT * FROM sessions WHERE session_id = ${sessionId}`
    : await sql`SELECT * FROM sessions WHERE experiment_name = ${experiment} ORDER BY started_at DESC LIMIT 1`;
  const session = r[0];
  if (!session) { console.log(`\nNo session found${sessionId ? ` for ${sessionId}` : ''}. Run a test, then re-run this.`); return; }

  console.log(`\n=== session ${session.session_id} ===`);
  console.log(`  prolific_pid(hash): ${session.prolific_pid ?? '(none)'}`);
  console.log(`  started:   ${session.started_at}`);
  console.log(`  completed: ${session.completed_at ?? '(NOT completed)'}`);
  console.log(`  duration_ms: ${session.total_duration_ms ?? '(none)'}   age/gender: ${session.age ?? '(none)'} / ${session.gender ?? '(none)'}`);

  const trials = await sql`
    SELECT trial_number, pair_id, position, rating, response_time_ms, is_catch_trial,
           data->>'left_product_id'  AS left_product_id,
           data->>'right_product_id' AS right_product_id,
           data->>'left_variant'     AS left_variant,
           data->>'right_variant'    AS right_variant,
           data->>'question'         AS question
    FROM trials WHERE session_id = ${session.session_id} ORDER BY trial_number`;

  console.log(`\n  trials (${trials.length}):`);
  for (const t of trials) {
    console.log(`   #${String(t.trial_number).padStart(2)}  ${String(t.pair_id).padEnd(28)} ${t.position}  L=${t.left_product_id}:v${t.left_variant}  R=${t.right_product_id}:v${t.right_variant}  rating=${t.rating}${t.is_catch_trial ? '  [CATCH]' : ''}`);
  }

  console.log(`\n  checks:`);
  ok('session completed', !!session.completed_at);
  ok('demographics saved', session.age != null && !!session.gender);
  ok('no survey rows (all trial_number < 1001)', trials.every(t => Number(t.trial_number) < 1001));
  ok('no question field on any trial (survey dropped)', trials.every(t => t.question == null));
  const catches = trials.filter(t => t.is_catch_trial);
  const regular = trials.filter(t => !t.is_catch_trial);
  ok('regular trials present', regular.length > 0, `${regular.length} regular`);
  ok('exactly 1 catch trial', catches.length === 1, `${catches.length} catch`);
  ok('every trial has left & right variant', trials.every(t => t.left_variant != null && t.right_variant != null));
  ok('variants parse as integers', trials.every(t => Number.isInteger(Number(t.left_variant)) && Number.isInteger(Number(t.right_variant))));
  ok('ratings in 0..100', trials.every(t => t.rating != null && t.rating >= 0 && t.rating <= 100));
  ok('pair_id splits into exactly 2 ids', trials.every(t => String(t.pair_id || '').split('_').length === 2));
  ok('positions are AB/BA', trials.every(t => ['AB', 'BA'].includes(t.position)));
  if (catches.length === 1) {
    const c = catches[0];
    ok('catch: same product both sides', c.left_product_id === c.right_product_id, `${c.left_product_id}/${c.right_product_id}`);
    ok('catch: same variant both sides', c.left_variant === c.right_variant, `${c.left_variant}/${c.right_variant}`);
  }
  const idV = new Map();
  let conflict = false;
  for (const t of trials) for (const side of ['left', 'right']) {
    const id = t[`${side}_product_id`], v = t[`${side}_variant`];
    if (id == null) continue;
    if (idV.has(id) && idV.get(id) !== v) conflict = true; else idV.set(id, v);
  }
  ok('held-constant: each brand one variant all session', !conflict);

  // ---- stimulus<->data mapping: every recorded (brand, variant) must resolve
  //      to exactly one stimulus text, pair_id must match the sorted ids, and
  //      every brand must have a coordinates row (the analysis join). ----
  const stimPath = path.join(repoDir, 'stimuli', experiment, 'stimuli.json');
  let stim = null;
  try { stim = JSON.parse(fs.readFileSync(stimPath, 'utf8')); } catch (e) { /* missing */ }
  if (!stim) {
    console.log(`\n  (mapping checks skipped — stimuli.json not found at ${stimPath})`);
  } else {
    const textOf = new Map();                 // "id|variant" -> text
    for (const p of stim.products) for (const v of p.variants) textOf.set(`${p.id}|${v.variant}`, v.text);
    const stimIds = new Set(stim.products.map(p => p.id));
    const resolves = t => ['left', 'right'].every(s => textOf.has(`${t[`${s}_product_id`]}|${t[`${s}_variant`]}`));
    ok('every recorded (brand, variant) resolves to a unique stimulus text', trials.every(resolves));
    ok('all recorded brand ids exist in stimuli.json', trials.every(t => stimIds.has(t.left_product_id) && stimIds.has(t.right_product_id)));
    ok('pair_id == sorted(left_id, right_id)', trials.every(t => t.pair_id === [t.left_product_id, t.right_product_id].sort().join('_')));

    const decPath = path.join(repoDir, '..', 'Generated Stimulus Study', 'decoder.csv');
    try {
      const coordIds = new Set(fs.readFileSync(decPath, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.split(',')[0]));
      ok('every recorded brand has a coordinates row (decoder.csv)', trials.every(t => coordIds.has(t.left_product_id) && coordIds.has(t.right_product_id)));
    } catch (e) {
      console.log('  (coordinates join skipped — decoder.csv not found locally)');
    }

    // Ordered ANSWER KEY: the resolved LEFT/RIGHT text per trial, to compare
    // against ordered screenshots. Each trial screen shows "Pair N of 16", so
    // match screenshot "Pair N" to the entry with the same number here.
    console.log(`\n  ===== ANSWER KEY (what the DB says was shown each trial) =====`);
    for (const t of trials) {
      const lt = textOf.get(`${t.left_product_id}|${t.left_variant}`) || '(UNRESOLVED)';
      const rt = textOf.get(`${t.right_product_id}|${t.right_variant}`) || '(UNRESOLVED)';
      console.log(`\n  Pair ${t.trial_number} of ${trials.length}${t.is_catch_trial ? '   [CATCH]' : ''}   (rating ${t.rating})`);
      console.log(`    LEFT  ${t.left_product_id} v${t.left_variant}:  ${lt}`);
      console.log(`    RIGHT ${t.right_product_id} v${t.right_variant}: ${rt}`);
    }
  }

  const passed = checks.filter(Boolean).length;
  console.log(`\n==== ${passed}/${checks.length} checks passed ====`);
  process.exit(passed === checks.length ? 0 : 1);
}
main().catch(e => { console.error('verify failed:', e); process.exit(2); });
