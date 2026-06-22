/**
 * Delete ALL data (sessions + trials) for a single experiment.
 *
 * Irreversible. The experiment name must be passed explicitly as an argument —
 * there is no default, so you can't wipe the wrong study by forgetting an arg.
 * Deletes trials first, then sessions (FK-safe order). Other experiments in the
 * shared database are untouched.
 *
 * Usage:
 *   node scripts/clear-experiment.js <experiment_name>
 *   node scripts/clear-experiment.js image-only-pilot-2026-05-19
 */

import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoDir, '.env.local') });

const experiment = process.argv[2];
if (!experiment) {
  console.error('ERROR: pass the experiment name explicitly, e.g.');
  console.error('  node scripts/clear-experiment.js image-only-pilot-2026-05-19');
  process.exit(1);
}

const sql = neon(process.env.POSTGRES_URL);

async function main() {
  // Count what's about to be deleted, so the action is auditable.
  const before = await sql`
    SELECT COUNT(*)::int AS sessions,
           (SELECT COUNT(*)::int FROM trials t
              JOIN sessions s ON s.session_id = t.session_id
             WHERE s.experiment_name = ${experiment}) AS trials
    FROM sessions WHERE experiment_name = ${experiment}
  `;
  const { sessions, trials } = before[0];

  console.log(`Experiment: ${experiment}`);
  console.log(`  sessions to delete: ${sessions}`);
  console.log(`  trials to delete:   ${trials}`);

  if (sessions === 0 && trials === 0) {
    console.log('Nothing to delete. Exiting.');
    return;
  }

  // FK-safe order: trials reference sessions(session_id).
  const delTrials = await sql`
    DELETE FROM trials
     WHERE session_id IN (
       SELECT session_id FROM sessions WHERE experiment_name = ${experiment}
     )
  `;
  const delSessions = await sql`
    DELETE FROM sessions WHERE experiment_name = ${experiment}
  `;

  // Verify nothing remains for this experiment.
  const after = await sql`
    SELECT COUNT(*)::int AS sessions FROM sessions WHERE experiment_name = ${experiment}
  `;

  console.log('Deleted.');
  console.log(`  remaining sessions for ${experiment}: ${after[0].sessions}`);
}

main().catch(err => {
  console.error('Clear failed:', err);
  process.exit(1);
});
