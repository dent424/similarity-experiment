# Database Documentation

## Overview

This project uses **Neon Postgres** (serverless) to store experiment data. The schema supports multiple experiment types through flexible JSONB columns.

## Connection

- **Provider**: Neon (neon.tech)
- **Project**: `experiment_database`
- **Database**: `neondb`
- **Region**: AWS US East 1 (N. Virginia)

### Connection String

Set in Vercel as `POSTGRES_URL`:
```
postgresql://neondb_owner:<password>@ep-old-resonance-ahmkf8od-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
```

## Schema

### sessions

Stores one row per participant session.

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | UUID | Primary key, auto-generated |
| `prolific_pid` | TEXT | Prolific participant ID (nullable) |
| `study_id` | TEXT | Prolific study ID (nullable) |
| `session_id_param` | TEXT | Prolific session ID (nullable) |
| `experiment_name` | TEXT | **Required**. Identifies the experiment (e.g., "similarity-v1") |
| `user_agent` | TEXT | Browser user agent string |
| `age` | INTEGER | Participant age (from demographics) |
| `gender` | TEXT | Participant gender (from demographics) |
| `started_at` | TIMESTAMP | Session start time (auto-set) |
| `completed_at` | TIMESTAMP | Session completion time |
| `total_duration_ms` | INTEGER | Total experiment duration in milliseconds |

### trials

Stores one row per trial response.

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | UUID | Foreign key to sessions |
| `trial_number` | INTEGER | Trial sequence number (1-indexed) |
| `pair_id` | TEXT | Product pair identifier (nullable for non-pair experiments) |
| `position` | TEXT | Display order "AB" or "BA" (nullable) |
| `rating` | INTEGER | Participant's rating (0-100) |
| `response_time_ms` | INTEGER | Time to respond in milliseconds |
| `is_catch_trial` | BOOLEAN | Whether this was an attention check |
| `data` | JSONB | **Flexible storage** for experiment-specific fields |
| `created_at` | TIMESTAMP | Record creation time |

Primary key: `(session_id, trial_number)`

## Multi-Experiment Support

The schema supports multiple experiments in a single database:

1. **Identify by `experiment_name`**: Each experiment uses a unique name (e.g., "similarity-v1", "ranking-v1")

2. **Use `data` JSONB for custom fields**: Store experiment-specific trial data:
   ```sql
   -- Similarity experiment
   INSERT INTO trials (session_id, trial_number, response_time_ms, data)
   VALUES ('...', 1, 2500, '{"pair_id": "A_B", "rating": 75, "position": "AB"}');

   -- Ranking experiment
   INSERT INTO trials (session_id, trial_number, response_time_ms, data)
   VALUES ('...', 1, 3200, '{"items": ["A","B","C"], "ranking": [2,1,3]}');
   ```

3. **Query by experiment**:
   ```sql
   SELECT * FROM sessions WHERE experiment_name = 'similarity-v1';
   ```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | POST | Create new session |
| `/api/session` | GET | Check if participant completed study |
| `/api/trial` | POST | Record trial response |
| `/api/demographics` | POST | Save age/gender |
| `/api/complete` | POST | Mark session complete |
| `/api/export` | GET | Export data as CSV (requires API key) |

## Export

Download experiment data:
```
GET /api/export?key=YOUR_EXPORT_API_KEY
```

Set `EXPORT_API_KEY` in Vercel environment variables.

## Environment Variables (Vercel)

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` | Neon connection string |
| `EXPORT_API_KEY` | Secret key for data export |
| `PROLIFIC_COMPLETION_URL` | Redirect URL after completion |

## Neon Console

Access the database: https://console.neon.tech

- SQL Editor: Run queries directly
- Tables: Browse/edit data
- Branches: Create dev/staging copies (Neon feature)
