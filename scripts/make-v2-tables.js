/**
 * Build the analysis-ready data package for the v2 text-variant similarity study.
 *
 * Pulls the study's data from Neon and writes a documented CSV set (per Alex's
 * schema; brand names + ratings + the specific variant in the ratings file, the
 * authored dimensions in a SEPARATE file). Trial-level only.
 *
 * Outputs (in data/exports/<experiment>/, gitignored — participant data + authored coordinates):
 *   <experiment>_ratings_long.csv  one row per rating (session, trial, both sides'
 *                                  brand id/name/variant, rating, RT, position, catch)
 *   <experiment>_sessions.csv      one row per participant (demographics + engagement/
 *                                  exclusion: n_trials, median RT, sd rating, n=50, catch)
 *   <experiment>_brands.csv        DIMENSIONS lookup: brand_id, brand_name, D1/D2/D3, salience
 *   <experiment>_instances.csv     the specific instances: brand_id, brand_name, variant, text
 *   README.md                      data dictionary + join keys + analysis recipes
 *
 * Usage:
 *   node scripts/make-v2-tables.js                    # experiment from config-v2.js
 *   node scripts/make-v2-tables.js <experiment>       # explicit experiment_name
 *   node scripts/make-v2-tables.js --out <dir>        # custom output directory
 *   node scripts/make-v2-tables.js --catch-threshold 80
 *
 * Conventions (matching make-analysis-tables.js): snake_case; booleans 0/1; timestamps
 * ISO-8601 UTC; empty cell for NULL/NaN (never "null"/"NA"); no BOM. All sessions
 * included with a `completed` flag (filter on it in analysis).
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
let outDir = null; // default: data/exports/<experiment>/ (set once experiment is resolved)
let catchThreshold = 80;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outDir = argv[++i];
  else if (argv[i] === '--catch-threshold') catchThreshold = parseInt(argv[++i], 10);
  else if (!argv[i].startsWith('--')) experimentArg = argv[i];
}

// ---- CSV + stats helpers (empty cell for NULL/NaN; no BOM) ----
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isNaN(v)) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (headers, rows) => [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\n') + '\n';
const iso = ts => (ts ? new Date(ts).toISOString() : null);
const wc = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;
function median(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function sampleSd(vals) {
  if (vals.length < 2) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)) * 100) / 100;
}

async function resolveExperiment() {
  if (experimentArg) return experimentArg;
  const mod = await import(pathToFileURL(path.join(repoDir, 'config-v2.js')).href);
  if (!mod.default || !mod.default.EXPERIMENT_NAME) { console.error('config-v2.js must default-export EXPERIMENT_NAME'); process.exit(1); }
  return mod.default.EXPERIMENT_NAME;
}

// Brand metadata: real names + coordinates + the per-variant instance texts.
// Names/coordinates/salience come from the grouped "stimuli-all.json" (Box) when
// present, else decoder.csv — these are identical across arms. Instance texts
// (the variant wording participants actually saw) ALWAYS come from the runtime
// stimuli/<experiment>/stimuli.json when it exists, since stimuli-all.json's
// variants belong to the original arm and are wrong for every other arm; only if
// the runtime file is missing do we fall back to stimuli-all.json's texts.
//
// The Box files always describe the FULL 15-brand set, so for a subset arm (e.g.
// the 12-brand brandvoice2 arm, which drops brand-08/09/13) the brand rows are
// filtered down to the ids that actually shipped in the runtime stimuli — without
// this, <exp>_brands.csv would list brands no participant ever saw.
function loadMeta(experiment) {
  const boxAll = path.join(repoDir, '..', 'Generated Stimulus Study', 'stimuli-all.json');
  const boxDecoder = path.join(repoDir, '..', 'Generated Stimulus Study', 'decoder.csv');
  const runtime = path.join(repoDir, 'stimuli', experiment, 'stimuli.json');
  const brandName = new Map(), brandsRows = [], instancesRows = [];
  const byId = (a, b) => a.brand_id.localeCompare(b.brand_id, undefined, { numeric: true });
  let source;

  if (fs.existsSync(boxAll)) {
    const all = JSON.parse(fs.readFileSync(boxAll, 'utf8'));
    for (const b of all.brands) {
      brandName.set(b.id, b.brand_name);
      brandsRows.push({ brand_id: b.id, brand_name: b.brand_name, D1_tradition_innovation: b.coordinates?.D1, D2_solitary_communal: b.coordinates?.D2, D3_rugged_refined: b.coordinates?.D3, salience: b.salience });
    }
    source = 'stimuli-all.json (names/coords)';
  } else if (fs.existsSync(boxDecoder)) {
    const lines = fs.readFileSync(boxDecoder, 'utf8').trim().split(/\r?\n/).slice(1);
    for (const l of lines) { const [id, name, d1, d2, d3, sal] = l.split(','); brandName.set(id, name); brandsRows.push({ brand_id: id, brand_name: name, D1_tradition_innovation: d1, D2_solitary_communal: d2, D3_rugged_refined: d3, salience: sal }); }
    source = 'decoder.csv (names/coords)';
  }

  let shippedIds = null;
  if (fs.existsSync(runtime)) {
    const st = JSON.parse(fs.readFileSync(runtime, 'utf8'));
    shippedIds = new Set(st.products.map(p => p.id));
    for (const p of st.products) { if (!brandName.has(p.id)) brandName.set(p.id, p.name); for (const v of p.variants) instancesRows.push({ brand_id: p.id, brand_name: brandName.get(p.id), variant: v.variant, word_count: wc(v.text), text: v.text }); }
    source = (source ? source + ' + ' : '') + 'runtime stimuli.json (texts)';
  } else if (fs.existsSync(boxAll)) {
    console.warn(`WARNING: no runtime stimuli.json for ${experiment}; instance texts fall back to stimuli-all.json's ORIGINAL-ARM variants and may not match what this arm's participants saw.`);
    const all = JSON.parse(fs.readFileSync(boxAll, 'utf8'));
    for (const b of all.brands) for (const v of b.variants) instancesRows.push({ brand_id: b.id, brand_name: b.brand_name, variant: v.variant, word_count: wc(v.text), text: v.text });
    source = (source || 'stimuli-all.json (names/coords)') + ' + stimuli-all.json fallback texts (original arm; may not match)';
  }

  // Keep only the brands this arm actually shipped (see note above). Guarded on
  // shippedIds so the no-runtime-file fallback path is unaffected.
  const shipped = shippedIds ? brandsRows.filter(r => shippedIds.has(r.brand_id)) : brandsRows;
  const nDropped = brandsRows.length - shipped.length;
  if (nDropped) source += ` + filtered to the ${shipped.length} brands in this arm (${nDropped} not shipped)`;

  shipped.sort(byId); instancesRows.sort((a, b) => byId(a, b) || a.variant - b.variant);
  return { brandName, brandsRows: shipped, instancesRows, source: source || 'stimuli.json (neutral names; no coordinates found)' };
}

function readmeMd(experiment, meta, nSessions, nCompleted, nRatings) {
  const today = new Date().toISOString().slice(0, 10);
  const nMetaBrands = new Set(meta.instancesRows.map(r => r.brand_id)).size;
  const mVariants = nMetaBrands ? Math.round(meta.instancesRows.length / nMetaBrands) : '?';
  return `# ${experiment} — data package

Generated ${today}. Analysis-ready export of a controlled text similarity study: participants
rate how similar two invented-brand *positioning statements* are, on a 0-100 slider. Each brand
has ${mVariants} interchangeable wording **variants**; each participant sees one variant per brand, held
constant for their whole session. Snapshot: **${nSessions} session(s) (${nCompleted} completed),
${nRatings} rating rows.**

> NOTE: this is a **research answer key** — brands.csv holds the authored coordinates. Keep team-only
> (these files are gitignored / Box-only).

## Files & join keys
| File | One row per | Keys |
|---|---|---|
| ${experiment}_ratings_long.csv | rating (trial) | session_id → sessions; (brand_id, variant) → instances; brand_id → brands |
| ${experiment}_sessions.csv | participant | session_id |
| ${experiment}_brands.csv | brand | brand_id |
| ${experiment}_instances.csv | brand × variant | (brand_id, variant) |

## ratings_long.csv
One row per similarity rating (all sessions; filter completed==1 for analysis; drop is_catch_trial==1).
| Column | Notes |
|---|---|
| session_id | participant key |
| completed | 1 if the session finished, else 0 |
| trial_number | 1..16 within the session (order shown) |
| is_catch_trial | 1 = attention-check trial (same brand+variant both sides) |
| position | AB / BA (which brand is physically on the left) |
| pair_id | the two brand_ids sorted + "_"-joined (UNORDERED key) |
| left_brand_id, left_brand_name, left_variant | the instance shown on the LEFT |
| right_brand_id, right_brand_name, right_variant | the instance shown on the RIGHT |
| rating | 0-100 |
| response_time_ms | time to respond |

**Direction (for asymmetry / Tversky):** the prompt is "how similar is the product on the LEFT to the
product on the RIGHT?" → treat **left = subject, right = referent**. The directed pair is
(left_brand_id → right_brand_id); the same unordered pair appears in both orders across participants,
so S(A→B) and S(B→A) are both recoverable. Variant is a nuisance/robustness factor — the brand identity
(brand_id) is the unit of interest.

## sessions.csv
| Column | Notes |
|---|---|
| session_id, prolific_pid_hash, experiment_name | keys / provenance (pid is a SHA-256 hash; raw PID never stored) |
| completed | 1 finished, 0 dropout |
| started_at, completed_at | ISO-8601 UTC (completed_at empty if dropout) |
| total_duration_ms, age, gender | |
| n_similarity_trials | count of regular (non-catch) trials |
| median_similarity_rt_ms | median RT over regular trials |
| sd_similarity_rating | sample SD of ratings over regular trials |
| n_rating_eq_50 | # ratings exactly 50 (slider left at default) |
| catch_rating | rating on the catch trial (identical statements → should be ~100) |
| catch_passed | 1 if catch_rating >= ${catchThreshold}, 0 if below, empty if no catch trial |

## brands.csv (dimensions — the authored ground truth)
| Column | Notes |
|---|---|
| brand_id, brand_name | keys |
| D1_tradition_innovation, D2_solitary_communal, D3_rugged_refined | authored coordinate, -2..+2 |
| salience | H / M / L (detail density of the writing; drives expected asymmetry) |

## instances.csv (the specific variant texts)
| Column | Notes |
|---|---|
| brand_id, brand_name, variant | keys — (brand_id, variant) matches the left_/right_ columns in ratings_long |
| word_count, text | the exact statement shown for that instance |

## Handling
- Empty cell = NA. In R use na.rm=TRUE / in Python skipna; never na.omit() a whole wide row.
- Include only completed==1 for primary analysis; exclude catch (is_catch_trial==1) and optionally
  sessions with catch_passed==0.

### Quick start (R)
    library(readr)
    r <- read_csv("${experiment}_ratings_long.csv")
    b <- read_csv("${experiment}_brands.csv")        # join when you're ready to look at coordinates
    r <- subset(r, completed == 1 & is_catch_trial == 0)

### Quick start (Python)
    import pandas as pd
    r = pd.read_csv("${experiment}_ratings_long.csv")
    b = pd.read_csv("${experiment}_brands.csv")
    r = r[(r.completed == 1) & (r.is_catch_trial == 0)]

## Regenerate
    node scripts/make-v2-tables.js
`;
}

async function main() {
  if (!process.env.POSTGRES_URL) { console.error('POSTGRES_URL not set (.env.local).'); process.exit(1); }
  const experiment = await resolveExperiment();
  const meta = loadMeta(experiment);
  const sql = neon(process.env.POSTGRES_URL);

  const rows = await sql`
    SELECT s.session_id, s.prolific_pid AS prolific_pid_hash, s.experiment_name,
           s.age, s.gender, s.started_at, s.completed_at, s.total_duration_ms,
           t.trial_number, t.pair_id, t.position,
           t.data->>'left_product_id'  AS left_product_id,
           t.data->>'right_product_id' AS right_product_id,
           t.data->>'left_variant'     AS left_variant,
           t.data->>'right_variant'    AS right_variant,
           t.rating, t.response_time_ms, t.is_catch_trial
    FROM sessions s LEFT JOIN trials t ON t.session_id = s.session_id
    WHERE s.experiment_name = ${experiment}
    ORDER BY s.started_at, s.session_id, t.trial_number`;

  // group by session
  const sess = new Map();
  for (const r of rows) {
    if (!sess.has(r.session_id)) sess.set(r.session_id, { first: r, trials: [] });
    if (r.trial_number != null && r.trial_number < 1001) sess.get(r.session_id).trials.push(r);
  }

  const name = id => meta.brandName.get(id) ?? '';

  // ratings_long
  const ratingsHeaders = ['session_id', 'completed', 'trial_number', 'is_catch_trial', 'position', 'pair_id',
    'left_brand_id', 'left_brand_name', 'left_variant', 'right_brand_id', 'right_brand_name', 'right_variant',
    'rating', 'response_time_ms'];
  const ratingsRows = [];
  for (const { first, trials } of sess.values()) for (const t of trials) {
    ratingsRows.push({
      session_id: t.session_id, completed: first.completed_at ? 1 : 0, trial_number: t.trial_number,
      is_catch_trial: t.is_catch_trial ? 1 : 0, position: t.position, pair_id: t.pair_id,
      left_brand_id: t.left_product_id, left_brand_name: name(t.left_product_id), left_variant: t.left_variant,
      right_brand_id: t.right_product_id, right_brand_name: name(t.right_product_id), right_variant: t.right_variant,
      rating: t.rating, response_time_ms: t.response_time_ms
    });
  }

  // sessions
  const sessHeaders = ['session_id', 'prolific_pid_hash', 'experiment_name', 'completed', 'started_at', 'completed_at',
    'total_duration_ms', 'age', 'gender', 'n_similarity_trials', 'median_similarity_rt_ms', 'sd_similarity_rating',
    'n_rating_eq_50', 'catch_rating', 'catch_passed'];
  const sessRows = [...sess.values()].map(({ first, trials }) => {
    const regular = trials.filter(t => !t.is_catch_trial);
    const catches = trials.filter(t => t.is_catch_trial);
    const ratings = regular.map(t => t.rating).filter(v => v != null);
    const rts = regular.map(t => t.response_time_ms).filter(v => v != null);
    const catchRating = catches.length ? catches[0].rating : null;
    return {
      session_id: first.session_id, prolific_pid_hash: first.prolific_pid_hash, experiment_name: first.experiment_name,
      completed: first.completed_at ? 1 : 0, started_at: iso(first.started_at), completed_at: iso(first.completed_at),
      total_duration_ms: first.total_duration_ms, age: first.age, gender: first.gender,
      n_similarity_trials: regular.length, median_similarity_rt_ms: median(rts), sd_similarity_rating: sampleSd(ratings),
      n_rating_eq_50: ratings.filter(r => r === 50).length,
      catch_rating: catchRating, catch_passed: catches.length ? (catchRating >= catchThreshold ? 1 : 0) : null
    };
  });

  if (!outDir) outDir = path.join(repoDir, 'data', 'exports', experiment);
  fs.mkdirSync(outDir, { recursive: true });
  const write = (suffix, headers, rowsArr) => { const p = path.join(outDir, `${experiment}_${suffix}.csv`); fs.writeFileSync(p, toCsv(headers, rowsArr)); return p; };
  const p1 = write('ratings_long', ratingsHeaders, ratingsRows);
  const p2 = write('sessions', sessHeaders, sessRows);
  const p3 = write('brands', ['brand_id', 'brand_name', 'D1_tradition_innovation', 'D2_solitary_communal', 'D3_rugged_refined', 'salience'], meta.brandsRows);
  const p4 = write('instances', ['brand_id', 'brand_name', 'variant', 'word_count', 'text'], meta.instancesRows);
  const p5 = path.join(outDir, 'README.md');
  fs.writeFileSync(p5, readmeMd(experiment, meta, sessRows.length, sessRows.filter(s => s.completed).length, ratingsRows.length));

  console.log(`Experiment: ${experiment}   (brand metadata: ${meta.source})`);
  console.log(`  sessions: ${sessRows.length} (${sessRows.filter(s => s.completed).length} completed)   rating rows: ${ratingsRows.length}`);
  console.log(`  brands: ${meta.brandsRows.length}   instances: ${meta.instancesRows.length}`);
  for (const p of [p1, p2, p3, p4, p5]) console.log(`  -> ${p}`);
}

main().catch(err => { console.error('make-v2-tables failed:', err); process.exit(1); });
