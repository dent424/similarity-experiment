import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.POSTGRES_URL);

// Stores post-task survey responses (category experience, brand familiarity)
// as rows in the trials table: pair_id/position are NULL, the rating column
// holds the response, and the data JSONB identifies the question (and
// product, for per-brand items). Survey rows use trial_number >= 1001 so
// they can never collide with similarity trials and are easy to filter.
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

  const { session_id, responses } = req.body;

  if (!session_id || !Array.isArray(responses) || responses.length === 0) {
    return res.status(400).json({ error: 'session_id and a non-empty responses array are required' });
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(session_id)) {
    return res.status(400).json({ error: 'Invalid session_id format' });
  }

  // Validate each response before inserting anything
  for (const r of responses) {
    if (typeof r.trial_number !== 'number' || r.trial_number < 1000) {
      return res.status(400).json({ error: 'Survey trial_number must be a number >= 1000' });
    }
    if (typeof r.rating !== 'number' || r.rating < 0 || r.rating > 100) {
      return res.status(400).json({ error: 'Rating must be between 0 and 100' });
    }
    if (!r.question || typeof r.question !== 'string') {
      return res.status(400).json({ error: 'Each response needs a question identifier' });
    }
  }

  try {
    for (const r of responses) {
      const data = { question: r.question };
      if (r.product_id) {
        data.product_id = r.product_id;
      }

      await sql`
        INSERT INTO trials (session_id, trial_number, pair_id, position, rating, response_time_ms, is_catch_trial, data)
        VALUES (${session_id}, ${r.trial_number}, NULL, NULL, ${r.rating}, ${r.response_time_ms || 0}, FALSE, ${JSON.stringify(data)})
      `;
    }

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Failed to record survey responses:', error);

    // Check for duplicate submission
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Survey responses already recorded' });
    }

    return res.status(500).json({ error: 'Failed to record survey responses' });
  }
}
