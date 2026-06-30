/**
 * Build v2 analysis tables (the text-variant similarity experiment).
 *
 * This is v2's OWN pull — the shared scripts/make-analysis-tables.js is left
 * untouched (it serves the cereal/image-only study). v2 differs in two ways:
 * each trial carries a per-side variant control (left_variant/right_variant),
 * and there is NO post-task survey, so there are no survey columns/rows.
 *
 * Outputs (in data/exports/, gitignored — participant data, public repo):
 *   <experiment>_similarity_long.csv  one row per similarity trial (incl. variants)
 *   <experiment>_users.csv            one row per session (demographics + counts)
 *
 * Usage:
 *   node scripts/make-v2-tables.js                  # experiment from config-v2.js
 *   node scripts/make-v2-tables.js <experiment>     # explicit experiment_name
 *   node scripts/make-v2-tables.js --out <dir>      # custom output directory
 *
 * Requires Node 14+ and the repo's package.json "type":"module".
 */
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoDir, '.env.local') });

// ---- CLI args ----
const argv = process.argv.slice(2);
let experimentArg = null;
let outDir = path.join(repoDir, 'data', 'exports');
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outDir = argv[++i];
  else if (!argv[i].startsWith('--')) experimentArg = argv[i];
}

async function resolveExperiment() {
  if (experimentArg) return experimentArg;
  const cfg = pathToFileURL(path.join(repoDir, 'config-v2.js')).href;
  const mod = await import(cfg);
  if (!mod.default || !mod.default.EXPERIMENT_NAME) {
    console.error('config-v2.js must default-export an object with EXPERIMENT_NAME');
    process.exit(1);
  }
  return mod.default.EXPERIMENT_NAME;
}

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\n');
}
function iso(ts) {
  return ts ? new Date(ts).toISOString() : '';
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.error('POSTGRES_URL not set (expected in .env.local).');
    process.exit(1);
  }
  const experiment = await resolveExperiment();
  const sql = neon(process.env.POSTGRES_URL);

  // Pull this experiment only (LEFT JOIN so sessions with no trials still appear).
  const rows = await sql`
    SELECT
      s.session_id, s.prolific_pid AS prolific_pid_hash, s.experiment_name,
      s.age, s.gender, s.started_at, s.completed_at, s.total_duration_ms,
      t.trial_number, t.pair_id, t.position,
      t.data->>'left_product_id'  AS left_product_id,
      t.data->>'right_product_id' AS right_product_id,
      t.data->>'left_variant'     AS left_variant,
      t.data->>'right_variant'    AS right_variant,
      t.rating, t.response_time_ms, t.is_catch_trial
    FROM sessions s
    LEFT JOIN trials t ON t.session_id = s.session_id
    WHERE s.experiment_name = ${experiment}
    ORDER BY s.started_at, s.session_id, t.trial_number
  `;

  if (rows.length === 0) {
    console.error(`No rows for experiment "${experiment}". Pass an experiment_name arg or check config-v2.js.`);
    process.exit(1);
  }

  // First row per session carries that session's (repeated) columns.
  const sessionFirst = new Map();
  const nTrials = new Map();
  for (const r of rows) {
    if (!sessionFirst.has(r.session_id)) sessionFirst.set(r.session_id, r);
    // v2 has no survey rows; >=1001 would be a survey row — guard defensively.
    if (r.trial_number != null && r.trial_number < 1001) {
      nTrials.set(r.session_id, (nTrials.get(r.session_id) || 0) + 1);
    }
  }

  // --- long table: one row per similarity trial ---
  const longHeaders = [
    'session_id', 'completed', 'trial_number', 'pair_id', 'product_a', 'product_b',
    'left_product_id', 'right_product_id', 'left_variant', 'right_variant',
    'position', 'is_catch_trial', 'rating', 'response_time_ms'
  ];
  const longRows = [];
  for (const r of rows) {
    if (r.trial_number == null || r.trial_number >= 1001) continue;
    const [a, b] = String(r.pair_id || '').split('_');
    longRows.push({
      session_id: r.session_id,
      completed: r.completed_at ? 1 : 0,
      trial_number: r.trial_number,
      pair_id: r.pair_id,
      product_a: a, product_b: b,
      left_product_id: r.left_product_id,
      right_product_id: r.right_product_id,
      left_variant: r.left_variant,
      right_variant: r.right_variant,
      position: r.position,
      is_catch_trial: r.is_catch_trial ? 1 : 0,
      rating: r.rating,
      response_time_ms: r.response_time_ms
    });
  }

  // --- users table: one row per session ---
  const userHeaders = [
    'session_id', 'prolific_pid_hash', 'experiment_name', 'completed',
    'started_at', 'completed_at', 'total_duration_ms', 'age', 'gender', 'n_trials'
  ];
  const userRows = [...sessionFirst.values()].map(s => ({
    session_id: s.session_id,
    prolific_pid_hash: s.prolific_pid_hash,
    experiment_name: s.experiment_name,
    completed: s.completed_at ? 1 : 0,
    started_at: iso(s.started_at),
    completed_at: iso(s.completed_at),
    total_duration_ms: s.total_duration_ms,
    age: s.age,
    gender: s.gender,
    n_trials: nTrials.get(s.session_id) || 0
  }));

  fs.mkdirSync(outDir, { recursive: true });
  const longPath = path.join(outDir, `${experiment}_similarity_long.csv`);
  const userPath = path.join(outDir, `${experiment}_users.csv`);
  fs.writeFileSync(longPath, toCsv(longHeaders, longRows));
  fs.writeFileSync(userPath, toCsv(userHeaders, userRows));

  console.log(`Experiment: ${experiment}`);
  console.log(`  sessions: ${userRows.length} (completed: ${userRows.filter(u => u.completed).length})`);
  console.log(`  similarity trials: ${longRows.length}`);
  console.log(`  -> ${longPath}`);
  console.log(`  -> ${userPath}`);
}

main().catch(err => { console.error('make-v2-tables failed:', err); process.exit(1); });
