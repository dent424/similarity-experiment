// Pull all data for the image-only cereal experiment from the live DB:
// prints a session-by-session summary and writes the full rows to CSV.
import { readFileSync, writeFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';

const env = readFileSync('.env.local', 'utf8');
const url = env.match(/POSTGRES_URL=(.+)/)[1].trim().replace(/^["']|["']$/g, '');
const sql = neon(url);

const EXPERIMENT = 'image-only-pilot-2026-05-19';

const rows = await sql`
  SELECT
    s.session_id, s.prolific_pid, s.started_at, s.completed_at, s.total_duration_ms,
    s.age, s.gender,
    t.trial_number, t.pair_id, t.position,
    t.data->>'left_product_id' AS left_product_id,
    t.data->>'right_product_id' AS right_product_id,
    t.rating, t.response_time_ms, t.is_catch_trial,
    t.data->>'question' AS question,
    t.data->>'product_id' AS product_id
  FROM sessions s
  LEFT JOIN trials t ON t.session_id = s.session_id
  WHERE s.experiment_name = ${EXPERIMENT}
  ORDER BY s.started_at, t.trial_number
`;

if (rows.length === 0) {
  console.log(`No data yet for ${EXPERIMENT}`);
  process.exit(0);
}

// Per-session summary
const sessions = new Map();
for (const r of rows) {
  if (!sessions.has(r.session_id)) {
    sessions.set(r.session_id, { ...r, simTrials: 0, catchRating: null, surveyRows: 0, cerealDays: null, famRatings: [] });
  }
  const s = sessions.get(r.session_id);
  if (r.trial_number === null) continue;
  if (r.question === null) {
    s.simTrials++;
    if (r.is_catch_trial) s.catchRating = r.rating;
  } else {
    s.surveyRows++;
    if (r.question === 'cereal_days_past_week') s.cerealDays = r.rating;
    if (r.question === 'brand_familiarity') s.famRatings.push(`${r.product_id}=${r.rating}`);
  }
}

console.log(`=== ${EXPERIMENT}: ${sessions.size} session(s) ===\n`);
for (const s of sessions.values()) {
  const done = s.completed_at ? `completed (${Math.round(s.total_duration_ms / 1000)}s)` : 'NOT completed';
  const pid = s.prolific_pid ? `pid-hash ${s.prolific_pid.slice(0, 12)}...` : 'no PID';
  console.log(`session ${s.session_id.slice(0, 8)}...  ${done}  ${pid}`);
  console.log(`  started: ${s.started_at}`);
  console.log(`  similarity trials: ${s.simTrials} (catch rating: ${s.catchRating === null ? 'n/a' : s.catchRating})`);
  console.log(`  survey rows: ${s.surveyRows}  cereal days/wk: ${s.cerealDays === null ? 'n/a' : s.cerealDays}`);
  if (s.famRatings.length) console.log(`  familiarity: ${s.famRatings.join(', ')}`);
  console.log(`  demographics: age=${s.age || 'n/a'} gender=${s.gender || 'n/a'}\n`);
}

// Full CSV
const headers = Object.keys(rows[0]);
const csv = [
  headers.join(','),
  ...rows.map(r => headers.map(h => {
    const v = r[h];
    if (v === null || v === undefined) return '';
    const str = String(v instanceof Date ? v.toISOString() : v);
    return /[,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(','))
].join('\n');
writeFileSync('image-only-pilot_data.csv', csv);
console.log(`Full data written to image-only-pilot_data.csv (${rows.length} rows)`);
