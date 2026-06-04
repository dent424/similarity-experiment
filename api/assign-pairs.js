import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL);

// Balanced trial assignment: returns the n_pairs least-rated pairs for this
// experiment, each with its less-seen left/right arrangement. Ties are broken
// randomly, so early on (all counts equal) this is identical to simple random
// sampling.
//
// Counted toward balance: trials from completed sessions, plus trials from
// in-progress sessions started within the last 30 minutes (so concurrent
// participants see each other's ratings almost immediately). Abandoned
// sessions age out of the window — dropout data is excluded from analysis,
// so a dropout's pairs return to the "uncovered" pool and get reassigned.
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { experiment_name, product_ids, n_pairs } = req.body;

  if (!experiment_name || !Array.isArray(product_ids) || product_ids.length < 2 || !n_pairs) {
    return res.status(400).json({ error: 'experiment_name, product_ids (>= 2), and n_pairs are required' });
  }

  try {
    // Current rating counts per (pair, position): completed sessions plus
    // likely-in-flight ones (started < 30 min ago, not yet completed)
    const rows = await sql`
      SELECT t.pair_id, t.position, COUNT(*)::int AS n
      FROM trials t
      JOIN sessions s ON s.session_id = t.session_id
      WHERE s.experiment_name = ${experiment_name}
        AND (s.completed_at IS NOT NULL OR s.started_at > NOW() - INTERVAL '30 minutes')
        AND t.is_catch_trial = FALSE
      GROUP BY t.pair_id, t.position
    `;

    const counts = new Map();
    for (const row of rows) {
      counts.set(`${row.pair_id}|${row.position}`, row.n);
    }

    // All possible pairs. pair_id is the two IDs alphabetically sorted and
    // joined with '_', matching the client convention; position 'AB' means
    // the alphabetically first ID is on the left.
    const ids = [...product_ids].sort();
    const pairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pairId = `${ids[i]}_${ids[j]}`;
        const ab = counts.get(`${pairId}|AB`) || 0;
        const ba = counts.get(`${pairId}|BA`) || 0;
        pairs.push({ pairId, first: ids[i], second: ids[j], ab, ba, total: ab + ba });
      }
    }

    // Least-covered pairs first; pre-shuffling makes ties break randomly
    // (Array.prototype.sort is stable)
    shuffleArray(pairs);
    pairs.sort((a, b) => a.total - b.total);
    const selected = pairs.slice(0, Math.min(n_pairs, pairs.length));

    const assignments = selected.map(p => {
      let position;
      if (p.ab < p.ba) {
        position = 'AB';
      } else if (p.ba < p.ab) {
        position = 'BA';
      } else {
        position = Math.random() < 0.5 ? 'AB' : 'BA';
      }

      return {
        pair_id: p.pairId,
        position,
        left_product_id: position === 'AB' ? p.first : p.second,
        right_product_id: position === 'AB' ? p.second : p.first
      };
    });

    return res.status(200).json({ assignments });
  } catch (error) {
    console.error('Failed to assign pairs:', error);
    return res.status(500).json({ error: 'Failed to assign pairs' });
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
