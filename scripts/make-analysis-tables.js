/**
 * Build analysis-ready tables from the experiment database.
 *
 * Produces three CSVs in data/exports/<experiment>/ (gitignored - these contain
 * participant data and the repo is public), all keyed by session_id:
 *
 *   <experiment>_similarity_long.csv  - one row per similarity trial
 *                                       (catch trials included, flagged)
 *   <experiment>_users_wide.csv       - one row per session: demographics,
 *                                       survey responses, familiarity x N,
 *                                       engagement/exclusion variables
 *   <experiment>_products.csv         - product lookup / factor universe
 *
 * Unlike export_data.js, ALL sessions are always included (no --all flag);
 * filter on the `completed` column in analysis. Dropout rows have counts of 0
 * and empty cells for everything not observed.
 *
 * Usage:
 *   node scripts/make-analysis-tables.js                          # default experiment from config
 *   node scripts/make-analysis-tables.js image-only-pilot-2026-05-19
 *   node scripts/make-analysis-tables.js --list                   # experiments + counts
 *   node scripts/make-analysis-tables.js --dry-run                # validate + report, write nothing
 *   node scripts/make-analysis-tables.js --catch-threshold=80     # catch_passed cutoff
 *   node scripts/make-analysis-tables.js --out=C:\Temp\exports    # custom output dir
 *
 * Conventions: snake_case columns; booleans 0/1; timestamps ISO 8601 UTC;
 * NULL/NaN -> empty cell (never literal "null"/"NaN"/"NA"); counts are 0 when
 * nothing observed, derived stats are empty when not computable; no BOM
 * (base R mangles BOM'd headers - Excel users: import via Data > From Text,
 * do not double-click the file).
 *
 * Note: prolific_pid_hash holds a SHA-256 hash for the image-only experiments;
 * for legacy experiments (Feb 2026 pilot) the same column holds the raw PID.
 *
 * Requires Node 14+ and the repo's package.json "type":"module".
 */

import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoDir = path.join(__dirname, '..');

dotenv.config({ path: path.join(repoDir, '.env.local') });

const KNOWN_QUESTIONS = ['cereal_days_past_week', 'movie_days_past_month', 'brand_familiarity', 'brand_liking'];

const USAGE = `Usage: node scripts/make-analysis-tables.js [experiment_name] [flags]
  experiment_name        default: EXPERIMENT_NAME from config-image-only.js
  --catch-threshold N    catch_passed cutoff, integer 0-100 (default 80)
  --out DIR              output directory (default data/exports/<experiment>)
  --list                 list experiments and session counts, then exit
  --dry-run              run all validations and print the report, write nothing
  --help                 show this help`;

// ---------------------------------------------------------------------------
// CLI parsing - sequential, so "--catch-threshold 80" doesn't get read as an
// experiment name (the args.find(!startsWith('--')) shortcut would do that)
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { experiment: null, catchThreshold: 80, out: null, list: false, dryRun: false, help: false };
  const VALUE_FLAGS = { '--catch-threshold': 'catchThreshold', '--out': 'out' };
  const BOOL_FLAGS = { '--list': 'list', '--dry-run': 'dryRun', '--help': 'help' };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flagName = arg.startsWith('--') ? (eq === -1 ? arg : arg.slice(0, eq)) : null;

    if (flagName && BOOL_FLAGS[flagName] !== undefined) {
      if (eq !== -1) fail(`${flagName} does not take a value`);
      opts[BOOL_FLAGS[flagName]] = true;
    } else if (flagName && VALUE_FLAGS[flagName] !== undefined) {
      let value;
      if (eq !== -1) {
        value = arg.slice(eq + 1);
      } else {
        value = argv[++i];
        if (value === undefined) fail(`${flagName} requires a value`);
      }
      opts[VALUE_FLAGS[flagName]] = value;
    } else if (flagName) {
      fail(`Unknown flag: ${flagName}\n${USAGE}`);
    } else if (opts.experiment === null) {
      opts.experiment = arg;
    } else {
      fail(`Unexpected extra argument: "${arg}" (experiment already set to "${opts.experiment}")\n${USAGE}`);
    }
  }

  const t = Number(opts.catchThreshold);
  if (!Number.isInteger(t) || t < 0 || t > 100) {
    fail(`--catch-threshold must be an integer 0-100, got "${opts.catchThreshold}"`);
  }
  opts.catchThreshold = t;
  return opts;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV helpers (escape rules mirrored from export_data.js)
// ---------------------------------------------------------------------------
function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isNaN(v)) return '';
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvCell(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function isoOrEmpty(v) {
  return v ? new Date(v).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Stats helpers - return null (empty cell) when not computable
// ---------------------------------------------------------------------------
function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function sampleSd(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

if (!process.env.POSTGRES_URL) {
  fail('POSTGRES_URL is not set. Check that .env.local exists in the repo root.');
}
const sql = neon(process.env.POSTGRES_URL);

if (opts.list) {
  const result = await sql`
    SELECT experiment_name,
           count(*)::int AS total,
           count(completed_at)::int AS completed,
           max(started_at) AS last_session
    FROM sessions
    GROUP BY experiment_name
    ORDER BY max(started_at) DESC
  `;
  console.log('Experiments in database:\n');
  for (const r of result) {
    const last = new Date(r.last_session).toISOString().slice(0, 16);
    console.log(`  ${r.experiment_name.padEnd(35)} total ${String(r.total).padStart(4)}  completed ${String(r.completed).padStart(4)}  last ${last}`);
  }
  process.exit(0);
}

// Default experiment from config (single source of truth)
let experiment = opts.experiment;
if (!experiment) {
  const configPath = path.resolve(repoDir, 'config-image-only.js');
  let mod;
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (e) {
    fail(`Could not load ${configPath}: ${e.message}`);
  }
  if (!mod.default || !mod.default.EXPERIMENT_NAME) {
    fail('config-image-only.js must default-export an object with EXPERIMENT_NAME');
  }
  experiment = mod.default.EXPERIMENT_NAME;
}

// Expected regular-trial count: only known when this is some config's experiment
let expectedNPairs = null;
for (const cfg of ['config-image-only.js', 'config-movie-franchise.js']) {
  const mod = await import(pathToFileURL(path.resolve(repoDir, cfg)).href).catch(() => null);
  if (mod && mod.default && mod.default.EXPERIMENT_NAME === experiment && Number.isInteger(mod.default.N_PAIRS)) {
    expectedNPairs = mod.default.N_PAIRS;
    break;
  }
}

// The category-consumption question is experiment-specific (cereal days past
// week vs movie days past month); the wide-table column names follow the
// question key.
const CATEGORY_QUESTION = experiment.startsWith('movie-franchise')
  ? 'movie_days_past_month'
  : 'cereal_days_past_week';
const CATEGORY_RT_COL = CATEGORY_QUESTION.replace(/_past_(week|month)$/, '') + '_rt_ms'; // cereal_days_rt_ms / movie_days_rt_ms

// Movie-franchise studies also ask a per-brand liking block (mirrors
// familiarity; block order randomized, recoverable from trial_number)
const HAS_LIKING = experiment.startsWith('movie-franchise');

// ---------------------------------------------------------------------------
// Stimuli: new convention stimuli/<exp>/stimuli.json, legacy stimuli/<exp>.json
// ---------------------------------------------------------------------------
const stimuliCandidates = [
  path.join(repoDir, 'stimuli', experiment, 'stimuli.json'),
  path.join(repoDir, 'stimuli', `${experiment}.json`)
];
const stimuliPath = stimuliCandidates.find(p => fs.existsSync(p));
if (!stimuliPath) {
  const available = fs.readdirSync(path.join(repoDir, 'stimuli'))
    .filter(f => f.endsWith('.json') || fs.existsSync(path.join(repoDir, 'stimuli', f, 'stimuli.json')));
  fail(`No stimuli found for "${experiment}".\n  Tried: ${stimuliCandidates.join('\n         ')}\n  Available stimuli: ${available.join(', ')}`);
}

let stimuli;
try {
  stimuli = JSON.parse(fs.readFileSync(stimuliPath, 'utf8'));
} catch (e) {
  fail(`Could not parse ${stimuliPath}: ${e.message}`);
}
const products = (stimuli.products || []).map(p => ({
  id: p.id,
  name: p.name,
  image_filename: p.image || '' // legacy field name is `image`
}));
if (products.length < 2) fail(`stimuli at ${stimuliPath} has ${products.length} products (need >= 2)`);
if (new Set(products.map(p => p.id)).size !== products.length) fail('Duplicate product ids in stimuli');

const N = products.length;
const productIdx = new Map(products.map((p, i) => [p.id, i + 1])); // 1..N, stimuli.json order
const famColumn = id => `familiarity_${id.replace(/-/g, '_')}`;
const likColumn = id => `liking_${id.replace(/-/g, '_')}`;

// ---------------------------------------------------------------------------
// Pull and group
// ---------------------------------------------------------------------------
const rows = await sql`
  SELECT
    s.session_id, s.prolific_pid, s.experiment_name, s.age, s.gender,
    s.started_at, s.completed_at, s.total_duration_ms,
    t.trial_number, t.pair_id, t.position, t.rating, t.response_time_ms, t.is_catch_trial,
    t.data->>'left_product_id'  AS left_product_id,
    t.data->>'right_product_id' AS right_product_id,
    t.data->>'question'         AS question,
    t.data->>'product_id'       AS product_id
  FROM sessions s
  LEFT JOIN trials t ON t.session_id = s.session_id
  WHERE s.experiment_name = ${experiment}
  ORDER BY s.started_at, s.session_id, t.trial_number
`;

if (rows.length === 0) {
  console.log(`No data found for experiment "${experiment}".`);
  process.exit(0);
}

// Validation accumulators (declared before grouping - the classification loop pushes into them)
const hardFails = [];
const warns = [];

const sessions = new Map(); // session_id -> {meta, regular[], catch[], category[], familiarity[]}
for (const r of rows) {
  if (!sessions.has(r.session_id)) {
    sessions.set(r.session_id, {
      session_id: r.session_id,
      prolific_pid: r.prolific_pid,
      experiment_name: r.experiment_name,
      age: r.age,
      gender: r.gender,
      started_at: r.started_at,
      completed_at: r.completed_at,
      total_duration_ms: r.total_duration_ms,
      completed: r.completed_at ? 1 : 0,
      regular: [],
      catch: [],
      category: [],
      familiarity: [],
      liking: [],
      seenTrialNumbers: new Set()
    });
  }
  const s = sessions.get(r.session_id);
  if (r.trial_number === null) continue; // session with no trials

  const trial = {
    trial_number: Number(r.trial_number),
    pair_id: r.pair_id,
    position: r.position,
    rating: r.rating === null ? null : Number(r.rating),
    response_time_ms: r.response_time_ms === null ? null : Number(r.response_time_ms),
    is_catch_trial: !!r.is_catch_trial,
    left_product_id: r.left_product_id,
    right_product_id: r.right_product_id,
    question: r.question,
    product_id: r.product_id
  };

  if (s.seenTrialNumbers.has(trial.trial_number)) {
    hardFails.push(`session ${r.session_id}: duplicate trial_number ${trial.trial_number}`);
  }
  s.seenTrialNumbers.add(trial.trial_number);

  // Classification: catch > survey > regular; both set = corrupt
  if (trial.is_catch_trial && trial.question) {
    hardFails.push(`session ${r.session_id} trial ${trial.trial_number}: is_catch_trial AND question both set`);
  } else if (trial.is_catch_trial) {
    s.catch.push(trial);
  } else if (trial.question) {
    if (trial.question === CATEGORY_QUESTION) s.category.push(trial);
    else if (trial.question === 'movie_days_past_week' && CATEGORY_QUESTION === 'movie_days_past_month') {
      // Legacy key from sessions recorded before the past-week -> past-month
      // change (stale cached JS); the response lands in the past-month column.
      warns.push(`session ${r.session_id}: legacy question key "movie_days_past_week" mapped to ${CATEGORY_QUESTION}`);
      s.category.push(trial);
    }
    else if (trial.question === 'brand_familiarity') s.familiarity.push(trial);
    else if (trial.question === 'brand_liking' && HAS_LIKING) s.liking.push(trial);
    else hardFails.push(`session ${r.session_id} trial ${trial.trial_number}: unknown question "${trial.question}"`);
  } else {
    s.regular.push(trial);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateSimilarityTrial(sessionId, t, kind) {
  const where = `session ${sessionId} trial ${t.trial_number}`;
  if (t.rating === null || Number.isNaN(t.rating) || t.rating < 0 || t.rating > 100) {
    hardFails.push(`${where}: rating "${t.rating}" out of range`);
    return;
  }
  if (!['AB', 'BA'].includes(t.position)) {
    hardFails.push(`${where}: position "${t.position}" not AB/BA`);
    return;
  }
  if (!t.pair_id || !t.left_product_id || !t.right_product_id) {
    hardFails.push(`${where}: missing pair_id or left/right product ids`);
    return;
  }
  const parts = t.pair_id.split('_');
  if (parts.length !== 2) {
    hardFails.push(`${where}: pair_id "${t.pair_id}" does not split into 2 parts`);
    return;
  }
  if (!productIdx.has(t.left_product_id) || !productIdx.has(t.right_product_id)) {
    hardFails.push(`${where}: product id not in stimuli (${t.left_product_id}, ${t.right_product_id})`);
    return;
  }
  const expectedPairId = [t.left_product_id, t.right_product_id].sort().join('_');
  if (t.pair_id !== expectedPairId) {
    hardFails.push(`${where}: pair_id "${t.pair_id}" != sorted ids "${expectedPairId}"`);
  }
  const [first] = [t.left_product_id, t.right_product_id].sort();
  const expectedPosition = t.left_product_id === first ? 'AB' : 'BA';
  if (t.position !== expectedPosition) {
    hardFails.push(`${where}: position "${t.position}" inconsistent with left/right (expected ${expectedPosition})`);
  }
  if (kind === 'regular' && t.left_product_id === t.right_product_id) {
    hardFails.push(`${where}: self-pair but is_catch_trial=false`);
  }
}

for (const s of sessions.values()) {
  for (const t of s.regular) validateSimilarityTrial(s.session_id, t, 'regular');
  for (const t of s.catch) {
    validateSimilarityTrial(s.session_id, t, 'catch');
    if (t.position !== 'AB') warns.push(`session ${s.session_id}: catch trial position is "${t.position}" (expected AB)`);
  }

  // Survey checks - familiarity and liking share the same per-brand structure
  for (const [label, items] of [['familiarity', s.familiarity], ['liking', s.liking]]) {
    const seen = new Set();
    for (const t of items) {
      if (!t.product_id || !productIdx.has(t.product_id)) {
        hardFails.push(`session ${s.session_id} trial ${t.trial_number}: ${label} product_id "${t.product_id}" not in stimuli`);
        continue;
      }
      if (seen.has(t.product_id)) {
        hardFails.push(`session ${s.session_id}: duplicate ${label} for product "${t.product_id}"`);
      }
      seen.add(t.product_id);
      if (t.rating < 1 || t.rating > 7) warns.push(`session ${s.session_id}: ${label} ${t.product_id}=${t.rating} outside 1-7 (kept)`);
    }
    const rts = new Set(items.map(t => t.response_time_ms));
    if (rts.size > 1) warns.push(`session ${s.session_id}: ${label} response times differ within session (page-level RT assumption violated)`);
  }
  for (const t of s.category) {
    if (t.rating < 0 || t.rating > 7) warns.push(`session ${s.session_id}: ${CATEGORY_QUESTION}=${t.rating} outside 0-7 (kept)`);
  }

  // Completeness warnings - completed sessions only (dropouts are expected to be partial)
  if (s.completed) {
    if (expectedNPairs !== null && s.regular.length !== expectedNPairs) {
      warns.push(`completed session ${s.session_id}: ${s.regular.length} regular trials (expected ${expectedNPairs})`);
    }
    if (s.catch.length !== 1) warns.push(`completed session ${s.session_id}: ${s.catch.length} catch trials (expected 1)`);
    if (s.category.length !== 1) warns.push(`completed session ${s.session_id}: ${s.category.length} category-survey rows (expected 1)`);
    if (s.familiarity.length !== N) warns.push(`completed session ${s.session_id}: ${s.familiarity.length} familiarity rows (expected ${N})`);
    if (HAS_LIKING && s.liking.length !== N) warns.push(`completed session ${s.session_id}: ${s.liking.length} liking rows (expected ${N})`);
    if (s.age === null || !s.gender) warns.push(`completed session ${s.session_id}: missing demographics (age=${s.age}, gender=${s.gender})`);
    if (s.completed_at && s.started_at && new Date(s.completed_at) < new Date(s.started_at)) {
      warns.push(`completed session ${s.session_id}: completed_at < started_at`);
    }
  }
}

// ---------------------------------------------------------------------------
// Output dir safety guard - never produce committable participant data
// ---------------------------------------------------------------------------
let repoRoot = null;
try {
  repoRoot = path.resolve(execSync('git rev-parse --show-toplevel', { cwd: repoDir, encoding: 'utf8' }).trim());
} catch (e) {
  hardFails.push('git not available - cannot verify the output directory is gitignored. Install git or use --out with a directory outside the repo.');
}

const outDir = opts.out ? path.resolve(process.cwd(), opts.out) : path.join(repoDir, 'data', 'exports', experiment);

if (repoRoot) {
  const rel = path.relative(repoRoot, outDir);
  const isInside = !path.isAbsolute(rel) && !rel.startsWith('..');
  if (isInside) {
    const probe = path.join(outDir, '__check__.csv');
    try {
      execSync(`git check-ignore -q "${probe}"`, { cwd: repoRoot, encoding: 'utf8' });
    } catch (e) {
      if (e.status === 1) {
        hardFails.push(`Output dir ${outDir} is inside the repo but NOT gitignored (repo is public; exports contain participant data).\n  Add this line to .gitignore:  ${rel.replace(/\\/g, '/')}/`);
      } else {
        hardFails.push(`git check-ignore failed unexpectedly: ${e.message}`);
      }
    }
  }
  // Outside the repo: allowed - cannot be committed from there.
}

// ---------------------------------------------------------------------------
// Hard-fail gate
// ---------------------------------------------------------------------------
if (hardFails.length > 0) {
  console.error(`\n${hardFails.length} HARD ERROR(S) - nothing written:\n`);
  for (const f of hardFails) console.error(`  - ${f}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build tables
// ---------------------------------------------------------------------------
const longHeaders = [
  'session_id', 'completed', 'trial_number', 'pair_id', 'product_a', 'product_b',
  'product_a_idx', 'product_b_idx', 'left_product_id', 'right_product_id',
  'position', 'is_catch_trial', 'rating', 'response_time_ms'
];
const longRows = [];
for (const s of sessions.values()) {
  for (const t of [...s.regular, ...s.catch]) {
    const [a, b] = t.pair_id.split('_').sort();
    longRows.push({
      session_id: s.session_id,
      completed: s.completed,
      trial_number: t.trial_number,
      pair_id: t.pair_id,
      product_a: a,
      product_b: b,
      product_a_idx: productIdx.get(a),
      product_b_idx: productIdx.get(b),
      left_product_id: t.left_product_id,
      right_product_id: t.right_product_id,
      position: t.position,
      is_catch_trial: t.is_catch_trial ? 1 : 0,
      rating: t.rating,
      response_time_ms: t.response_time_ms
    });
  }
}
longRows.sort((x, y) => x.session_id.localeCompare(y.session_id) || x.trial_number - y.trial_number);

const wideHeaders = [
  'session_id', 'prolific_pid_hash', 'experiment_name', 'completed', 'started_at', 'completed_at',
  'total_duration_ms', 'age', 'gender',
  'n_similarity_trials', 'median_similarity_rt_ms', 'sd_similarity_rating', 'n_rating_eq_50',
  'catch_rating', 'catch_passed',
  CATEGORY_QUESTION, CATEGORY_RT_COL, 'familiarity_page_rt_ms',
  ...products.map(p => famColumn(p.id)), // stimuli.json order, deterministic
  ...(HAS_LIKING ? ['liking_page_rt_ms', ...products.map(p => likColumn(p.id))] : [])
];
const wideRows = [];
for (const s of sessions.values()) {
  const ratings = s.regular.map(t => t.rating);
  const rts = s.regular.map(t => t.response_time_ms).filter(v => v !== null);
  const catchRating = s.catch.length > 0 ? s.catch[0].rating : null;

  const row = {
    session_id: s.session_id,
    prolific_pid_hash: s.prolific_pid,
    experiment_name: s.experiment_name,
    completed: s.completed,
    started_at: isoOrEmpty(s.started_at),
    completed_at: isoOrEmpty(s.completed_at),
    total_duration_ms: s.total_duration_ms,
    age: s.age,
    gender: s.gender,
    n_similarity_trials: s.regular.length,
    median_similarity_rt_ms: median(rts),
    sd_similarity_rating: sampleSd(ratings),
    n_rating_eq_50: ratings.filter(r => r === 50).length,
    catch_rating: catchRating,
    // three-state: 1 passed, 0 failed, empty = no catch trial (NA, not a failure)
    catch_passed: catchRating === null ? null : (catchRating >= opts.catchThreshold ? 1 : 0),
    [CATEGORY_QUESTION]: s.category.length > 0 ? s.category[0].rating : null,
    [CATEGORY_RT_COL]: s.category.length > 0 ? s.category[0].response_time_ms : null,
    familiarity_page_rt_ms: s.familiarity.length > 0 ? s.familiarity[0].response_time_ms : null
  };
  // Familiarity mapped by product_id (display order is randomized; trial_number
  // reflects display position and is never used for column placement)
  for (const p of products) row[famColumn(p.id)] = null;
  for (const t of s.familiarity) row[famColumn(t.product_id)] = t.rating;

  if (HAS_LIKING) {
    row.liking_page_rt_ms = s.liking.length > 0 ? s.liking[0].response_time_ms : null;
    for (const p of products) row[likColumn(p.id)] = null;
    for (const t of s.liking) row[likColumn(t.product_id)] = t.rating;
  }

  wideRows.push(row);
}

const productHeaders = ['product_idx', 'product_id', 'product_name', 'image_filename', 'familiarity_column',
  ...(HAS_LIKING ? ['liking_column'] : [])];
const productRows = products.map((p, i) => ({
  product_idx: i + 1,
  product_id: p.id,
  product_name: p.name,
  image_filename: p.image_filename,
  familiarity_column: famColumn(p.id),
  ...(HAS_LIKING ? { liking_column: likColumn(p.id) } : {})
}));

// Formula-injection tripwire: flag (never mutate - prepending ' would corrupt joins)
const formulaCells = new Set();
for (const rowSet of [longRows, wideRows, productRows]) {
  for (const row of rowSet) {
    for (const v of Object.values(row)) {
      if (typeof v === 'string' && /^[=+@]/.test(v)) formulaCells.add(v);
    }
  }
}
for (const v of formulaCells) warns.push(`string cell starts with formula character: "${v}" (written as-is; open CSVs via R/pandas or Excel Data>From Text)`);

// ---------------------------------------------------------------------------
// Write (tmp then rename, so no partial snapshots)
// ---------------------------------------------------------------------------
const files = [
  { name: `${experiment}_similarity_long.csv`, csv: toCsv(longHeaders, longRows), rows: longRows.length },
  { name: `${experiment}_users_wide.csv`, csv: toCsv(wideHeaders, wideRows), rows: wideRows.length },
  { name: `${experiment}_products.csv`, csv: toCsv(productHeaders, productRows), rows: productRows.length }
];

if (!opts.dryRun) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(outDir, f.name + '.tmp'), f.csv, 'utf8');
  for (const f of files) {
    const target = path.join(outDir, f.name);
    fs.rmSync(target, { force: true }); // Windows: rename over existing throws EPERM
    fs.renameSync(target + '.tmp', target);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let gitSha = 'unknown';
try { gitSha = execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf8' }).trim(); } catch {}

const all = [...sessions.values()];
const completedSessions = all.filter(s => s.completed);

// Pair coverage + position balance over completed sessions, regular trials only
const pairCounts = new Map();
const posCounts = new Map();
let abTotal = 0, baTotal = 0;
for (const s of completedSessions) {
  for (const t of s.regular) {
    pairCounts.set(t.pair_id, (pairCounts.get(t.pair_id) || 0) + 1);
    const k = `${t.pair_id}|${t.position}`;
    posCounts.set(k, (posCounts.get(k) || 0) + 1);
    if (t.position === 'AB') abTotal++; else baTotal++;
  }
}
const totalPairs = (N * (N - 1)) / 2;
const counts = [...pairCounts.values()];
let imbalanced = 0;
for (const pairId of pairCounts.keys()) {
  const ab = posCounts.get(`${pairId}|AB`) || 0;
  const ba = posCounts.get(`${pairId}|BA`) || 0;
  if (Math.abs(ab - ba) > 1) imbalanced++;
}
const catchRatings = completedSessions.flatMap(s => s.catch.map(t => t.rating));
const catchPassRate = catchRatings.length
  ? Math.round(100 * catchRatings.filter(r => r >= opts.catchThreshold).length / catchRatings.length)
  : null;

console.log(`
=== make-analysis-tables ${opts.dryRun ? '(DRY RUN - nothing written)' : ''} ===
run:        ${new Date().toISOString()}  (git ${gitSha})
experiment: ${experiment}
stimuli:    ${path.relative(repoDir, stimuliPath)}  (${N} products)
sessions:   ${all.length} total = ${completedSessions.length} completed + ${all.length - completedSessions.length} incomplete (all included; filter on completed)
output:     ${outDir}
files:      ${files.map(f => `${f.name} (${f.rows} rows)`).join('\n            ')}

catch:      threshold ${opts.catchThreshold}; pass rate ${catchPassRate === null ? 'n/a (no catch trials yet)' : catchPassRate + '%'} over ${catchRatings.length} completed session(s)
coverage:   ${pairCounts.size}/${totalPairs} pairs observed${counts.length ? `; ratings per pair min ${Math.min(...counts)} / median ${median(counts)} / max ${Math.max(...counts)}` : ''} (completed sessions, regular trials)
position:   AB ${abTotal} vs BA ${baTotal}; pairs with |AB-BA| > 1: ${imbalanced}

definitions:
  - engagement stats (n_similarity_trials, median_similarity_rt_ms, sd_similarity_rating,
    n_rating_eq_50) are over REGULAR trials only (catch excluded); counts are 0 when none,
    stats empty when not computable
  - catch_passed is three-state: 1 (>= ${opts.catchThreshold}), 0 (< ${opts.catchThreshold}), empty = no catch trial
    (reads as NA - do not count as failure)
  - trial_number in similarity_long is the within-session presentation order (1..${expectedNPairs !== null ? expectedNPairs + 1 : 'K'})
  - familiarity_*${HAS_LIKING ? '/liking_*' : ''} columns are experiment-specific - don't pool across experiments${HAS_LIKING ? `
  - familiarity/liking block order is randomized per participant; recover it from
    survey trial_numbers (first-shown block starts at 1002, second at ${1002 + N})` : ''}

recipe (R):
  long <- read.csv("${experiment}_similarity_long.csv"); wide <- read.csv("${experiment}_users_wide.csv")
  df <- merge(subset(long, completed==1 & is_catch_trial==0),
              wide[, !names(wide) %in% c("completed","experiment_name")], by="session_id")
  mat <- with(df, tapply(rating, list(product_a, product_b), mean, na.rm=TRUE))  # symmetrize: (mat+t(mat))/2

recipe (Python):
  df = long[(long.completed==1) & (long.is_catch_trial==0)].merge(
      wide.drop(columns=["completed","experiment_name"]), on="session_id")
  mat = df.pivot_table(index="product_a", columns="product_b", values="rating", aggfunc="mean")

note: use na.rm/skipna - never na.omit() wide rows (missing familiarity/catch_passed is empty by design)
`);

if (warns.length > 0) {
  console.log(`${warns.length} WARNING(S):`);
  for (const w of warns) console.log(`  - ${w}`);
} else {
  console.log('No warnings.');
}
