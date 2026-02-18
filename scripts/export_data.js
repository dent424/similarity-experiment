/**
 * Export experiment data from Neon Postgres to CSV.
 *
 * Usage:
 *   node scripts/export_data.js                     # Export all completed sessions
 *   node scripts/export_data.js 50_word             # Export only 50_word experiment
 *   node scripts/export_data.js --all               # Include incomplete sessions too
 *   node scripts/export_data.js 50_word --all       # Specific experiment, include incomplete
 *   node scripts/export_data.js --list              # List experiments and session counts
 */

import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const sql = neon(process.env.POSTGRES_URL);

const args = process.argv.slice(2);
const listMode = args.includes('--list');
const includeIncomplete = args.includes('--all');
const experimentName = args.find(a => !a.startsWith('--')) || null;

async function listExperiments() {
  const result = await sql`
    SELECT
      experiment_name,
      count(*) as total_sessions,
      count(completed_at) as completed,
      count(*) - count(completed_at) as incomplete,
      min(started_at) as first_session,
      max(started_at) as last_session
    FROM sessions
    GROUP BY experiment_name
    ORDER BY max(started_at) DESC
  `;

  console.log('Experiments in database:\n');
  console.log('  Name                              | Total | Done | Incomplete | Last session');
  console.log('  ----------------------------------|-------|------|------------|-------------------------');
  result.forEach(r => {
    const name = r.experiment_name.padEnd(35);
    const total = String(r.total_sessions).padStart(5);
    const done = String(r.completed).padStart(4);
    const inc = String(r.incomplete).padStart(10);
    const last = new Date(r.last_session).toISOString().slice(0, 16);
    console.log(`  ${name} | ${total} | ${done} | ${inc} | ${last}`);
  });
}

async function exportData() {
  let result;

  if (experimentName && !includeIncomplete) {
    result = await sql`
      SELECT s.session_id, s.prolific_pid, s.experiment_name, s.age, s.gender,
        s.started_at, s.completed_at, s.total_duration_ms, t.trial_number, t.pair_id,
        t.position, t.data->>'left_product_id' as left_product_id,
        t.data->>'right_product_id' as right_product_id, t.rating, t.response_time_ms, t.is_catch_trial
      FROM sessions s LEFT JOIN trials t ON s.session_id = t.session_id
      WHERE s.completed_at IS NOT NULL AND s.experiment_name = ${experimentName}
      ORDER BY s.started_at, s.session_id, t.trial_number`;
  } else if (experimentName && includeIncomplete) {
    result = await sql`
      SELECT s.session_id, s.prolific_pid, s.experiment_name, s.age, s.gender,
        s.started_at, s.completed_at, s.total_duration_ms, t.trial_number, t.pair_id,
        t.position, t.data->>'left_product_id' as left_product_id,
        t.data->>'right_product_id' as right_product_id, t.rating, t.response_time_ms, t.is_catch_trial
      FROM sessions s LEFT JOIN trials t ON s.session_id = t.session_id
      WHERE s.experiment_name = ${experimentName}
      ORDER BY s.started_at, s.session_id, t.trial_number`;
  } else if (!includeIncomplete) {
    result = await sql`
      SELECT s.session_id, s.prolific_pid, s.experiment_name, s.age, s.gender,
        s.started_at, s.completed_at, s.total_duration_ms, t.trial_number, t.pair_id,
        t.position, t.data->>'left_product_id' as left_product_id,
        t.data->>'right_product_id' as right_product_id, t.rating, t.response_time_ms, t.is_catch_trial
      FROM sessions s LEFT JOIN trials t ON s.session_id = t.session_id
      WHERE s.completed_at IS NOT NULL
      ORDER BY s.experiment_name, s.started_at, s.session_id, t.trial_number`;
  } else {
    result = await sql`
      SELECT s.session_id, s.prolific_pid, s.experiment_name, s.age, s.gender,
        s.started_at, s.completed_at, s.total_duration_ms, t.trial_number, t.pair_id,
        t.position, t.data->>'left_product_id' as left_product_id,
        t.data->>'right_product_id' as right_product_id, t.rating, t.response_time_ms, t.is_catch_trial
      FROM sessions s LEFT JOIN trials t ON s.session_id = t.session_id
      ORDER BY s.experiment_name, s.started_at, s.session_id, t.trial_number`;
  }

  if (result.length === 0) {
    console.log('No data found' + (experimentName ? ` for experiment "${experimentName}"` : '') + '.');
    return;
  }

  const headers = [
    'session_id', 'prolific_pid', 'experiment_name', 'age', 'gender',
    'started_at', 'completed_at', 'total_duration_ms', 'trial_number',
    'pair_id', 'position', 'left_product_id', 'right_product_id',
    'rating', 'response_time_ms', 'is_catch_trial'
  ];

  const rows = result.map(row => {
    return headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  // Build filename
  const namePart = experimentName || 'all';
  const outFile = path.join(__dirname, '..', `${namePart}_data.csv`);
  fs.writeFileSync(outFile, csv);

  // Count unique sessions
  const sessionIds = new Set(result.map(r => r.session_id));
  console.log(`Exported ${result.length} rows (${sessionIds.size} sessions) to ${path.basename(outFile)}`);
}

(async () => {
  if (listMode) {
    await listExperiments();
  } else {
    await exportData();
  }
})().catch(e => console.error('Error:', e.message));
