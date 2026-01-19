import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL);

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

  const { session_id, trial_number, pair_id, position, rating, response_time_ms, is_catch_trial } = req.body;

  // Validate required fields
  if (!session_id || trial_number === undefined || !pair_id || !position || rating === undefined || response_time_ms === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(session_id)) {
    return res.status(400).json({ error: 'Invalid session_id format' });
  }

  // Validate rating range
  if (typeof rating !== 'number' || rating < 0 || rating > 100) {
    return res.status(400).json({ error: 'Rating must be between 0 and 100' });
  }

  // Validate position
  if (!['AB', 'BA'].includes(position)) {
    return res.status(400).json({ error: 'Position must be AB or BA' });
  }

  try {
    await sql`
      INSERT INTO trials (session_id, trial_number, pair_id, position, rating, response_time_ms, is_catch_trial)
      VALUES (${session_id}, ${trial_number}, ${pair_id}, ${position}, ${rating}, ${response_time_ms}, ${is_catch_trial || false})
    `;

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Failed to record trial:', error);

    // Check for duplicate trial
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Trial already recorded' });
    }

    return res.status(500).json({ error: 'Failed to record trial' });
  }
}
