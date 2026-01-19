import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple API key protection
  const { key } = req.query;
  if (!process.env.EXPORT_API_KEY || key !== process.env.EXPORT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Query all data with decoded left/right products
    const result = await sql`
      SELECT
        s.session_id,
        s.prolific_pid,
        s.experiment_name,
        s.age,
        s.gender,
        s.started_at,
        s.completed_at,
        s.total_duration_ms,
        t.trial_number,
        t.pair_id,
        -- Decode left_product and right_product from pair_id and position
        CASE
          WHEN t.position = 'AB' THEN SPLIT_PART(t.pair_id, '_', 1)
          ELSE SPLIT_PART(t.pair_id, '_', 2)
        END as left_product,
        CASE
          WHEN t.position = 'AB' THEN SPLIT_PART(t.pair_id, '_', 2)
          ELSE SPLIT_PART(t.pair_id, '_', 1)
        END as right_product,
        t.rating,
        t.response_time_ms,
        t.is_catch_trial
      FROM sessions s
      LEFT JOIN trials t ON s.session_id = t.session_id
      ORDER BY s.started_at, s.session_id, t.trial_number
    `;

    if (result.rows.length === 0) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=experiment_data.csv');
      return res.status(200).send('session_id,prolific_pid,experiment_name,age,gender,started_at,completed_at,total_duration_ms,trial_number,pair_id,left_product,right_product,rating,response_time_ms,is_catch_trial\n');
    }

    // Build CSV
    const headers = [
      'session_id',
      'prolific_pid',
      'experiment_name',
      'age',
      'gender',
      'started_at',
      'completed_at',
      'total_duration_ms',
      'trial_number',
      'pair_id',
      'left_product',
      'right_product',
      'rating',
      'response_time_ms',
      'is_catch_trial'
    ];

    const rows = result.rows.map(row => {
      return headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) {
          return '';
        }
        // Escape values containing commas or quotes
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=experiment_data.csv');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Failed to export data:', error);
    return res.status(500).json({ error: 'Failed to export data' });
  }
}
