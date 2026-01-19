import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    // Create a new session
    const { prolific_pid, study_id, session_id_param, experiment_name, user_agent } = req.body;

    if (!experiment_name) {
      return res.status(400).json({ error: 'experiment_name is required' });
    }

    try {
      const result = await sql`
        INSERT INTO sessions (prolific_pid, study_id, session_id_param, experiment_name, user_agent)
        VALUES (${prolific_pid || null}, ${study_id || null}, ${session_id_param || null}, ${experiment_name}, ${user_agent || null})
        RETURNING session_id
      `;

      return res.status(201).json({ session_id: result.rows[0].session_id });
    } catch (error) {
      console.error('Failed to create session:', error);
      return res.status(500).json({ error: 'Failed to create session' });
    }
  }

  if (req.method === 'GET') {
    // Check if a participant has already completed the study
    const { prolific_pid } = req.query;

    if (!prolific_pid) {
      return res.status(200).json({ exists: false, completed: false });
    }

    try {
      const result = await sql`
        SELECT session_id, completed_at FROM sessions
        WHERE prolific_pid = ${prolific_pid}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (result.rows.length === 0) {
        return res.status(200).json({ exists: false, completed: false });
      }

      return res.status(200).json({
        exists: true,
        completed: result.rows[0].completed_at !== null,
        session_id: result.rows[0].session_id
      });
    } catch (error) {
      console.error('Failed to check session:', error);
      return res.status(500).json({ error: 'Failed to check session' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
