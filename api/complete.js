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

  const { session_id, total_duration_ms } = req.body;

  // Validate required fields
  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(session_id)) {
    return res.status(400).json({ error: 'Invalid session_id format' });
  }

  try {
    await sql`
      UPDATE sessions
      SET completed_at = NOW(), total_duration_ms = ${total_duration_ms || null}
      WHERE session_id = ${session_id}
    `;

    // Return the Prolific completion URL
    // This should be configured in environment variables for production
    const prolificCompletionUrl = process.env.PROLIFIC_COMPLETION_URL || null;

    return res.status(200).json({
      success: true,
      redirect_url: prolificCompletionUrl
    });
  } catch (error) {
    console.error('Failed to complete session:', error);
    return res.status(500).json({ error: 'Failed to complete session' });
  }
}
