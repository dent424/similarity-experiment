-- Experiment Database Schema
-- Neon Postgres - supports multiple experiment types via JSONB

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prolific_pid TEXT,
  study_id TEXT,
  session_id_param TEXT,
  experiment_name TEXT NOT NULL,
  user_agent TEXT,
  age INTEGER,
  gender TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  total_duration_ms INTEGER
);

-- Trials table (flexible schema via JSONB data column)
CREATE TABLE IF NOT EXISTS trials (
  session_id UUID NOT NULL REFERENCES sessions(session_id),
  trial_number INTEGER NOT NULL,
  pair_id TEXT,                    -- nullable for non-pair experiments
  position TEXT,                   -- nullable for non-pair experiments
  rating INTEGER,
  response_time_ms INTEGER NOT NULL,
  is_catch_trial BOOLEAN DEFAULT FALSE,
  data JSONB,                      -- flexible storage for experiment-specific fields
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (session_id, trial_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_prolific_pid ON sessions(prolific_pid);
CREATE INDEX IF NOT EXISTS idx_sessions_completed ON sessions(completed_at);
CREATE INDEX IF NOT EXISTS idx_sessions_experiment ON sessions(experiment_name);
CREATE INDEX IF NOT EXISTS idx_trials_session ON trials(session_id);
