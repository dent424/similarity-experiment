import { sql } from '@vercel/postgres';

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

  const { session_id, age, gender } = req.body;

  // Validate required fields
  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(session_id)) {
    return res.status(400).json({ error: 'Invalid session_id format' });
  }

  // Validate age if provided
  if (age !== undefined && age !== null) {
    if (typeof age !== 'number' || age < 18 || age > 120) {
      return res.status(400).json({ error: 'Age must be between 18 and 120' });
    }
  }

  // Validate gender if provided
  const validGenders = ['male', 'female', 'non-binary', 'prefer-not', 'other'];
  if (gender !== undefined && gender !== null && !validGenders.includes(gender)) {
    return res.status(400).json({ error: 'Invalid gender value' });
  }

  try {
    await sql`
      UPDATE sessions
      SET age = ${age || null}, gender = ${gender || null}
      WHERE session_id = ${session_id}
    `;

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Failed to save demographics:', error);
    return res.status(500).json({ error: 'Failed to save demographics' });
  }
}
