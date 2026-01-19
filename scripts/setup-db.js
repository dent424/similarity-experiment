import { sql } from '@vercel/postgres';

async function setupDatabase() {
  console.log('Setting up database tables...');

  // Create sessions table
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      session_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      prolific_pid VARCHAR(255),
      study_id VARCHAR(255),
      session_id_param VARCHAR(255),
      stimulus_set VARCHAR(100) NOT NULL,
      started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE,
      total_duration_ms INTEGER,
      age INTEGER,
      gender VARCHAR(50),
      user_agent TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;
  console.log('Created sessions table');

  // Create trials table
  await sql`
    CREATE TABLE IF NOT EXISTS trials (
      id SERIAL PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES sessions(session_id),
      trial_number INTEGER NOT NULL,
      pair_id VARCHAR(100) NOT NULL,
      position VARCHAR(2) NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 0 AND rating <= 100),
      response_time_ms INTEGER NOT NULL,
      is_catch_trial BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(session_id, trial_number)
    )
  `;
  console.log('Created trials table');

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_prolific_pid ON sessions(prolific_pid)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_completed ON sessions(completed_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_trials_session ON trials(session_id)`;
  console.log('Created indexes');

  console.log('Database setup complete!');
}

setupDatabase().catch(err => {
  console.error('Database setup failed:', err);
  process.exit(1);
});
