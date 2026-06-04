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

### Survey responses (post-task questions)

Post-task survey answers are stored as `trials` rows, not in a separate table:

- `trial_number >= 1001` (1001 = category question; 1002+ = per-brand familiarity in randomized display order)
- `pair_id` and `position` are NULL
- `rating` holds the response (0–7 for cereal days; 1–7 for familiarity)
- `data` identifies the question: `{"question": "cereal_days_past_week"}` or `{"question": "brand_familiarity", "product_id": "<id>"}`

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
| `/api/session` | GET | Check if participant completed study (by hashed PID) |
| `/api/assign-pairs` | POST | Balanced trial assignment: least-rated pairs + less-seen left/right side (counts completed + in-flight <30 min sessions) |
| `/api/trial` | POST | Record trial response |
| `/api/survey` | POST | Record post-task survey responses (stored as trials rows, trial_number >= 1001) |
| `/api/demographics` | POST | Save age/gender |
| `/api/complete` | POST | Mark session complete |
| `/api/export` | GET | Export raw data as CSV (requires API key) |

## Export

Raw dump over HTTP:
```
GET /api/export?key=YOUR_EXPORT_API_KEY
```

Set `EXPORT_API_KEY` in Vercel environment variables.

**For analysis, use the local script instead** — it validates the data and produces
analysis-ready tables (long similarity table + wide user table + product lookup):

```
node scripts/make-analysis-tables.js
```

See **`ANALYSIS.md`** for full documentation. (`scripts/export_data.js` is the older raw-dump
script; `pull_data.js` prints a quick per-session summary.)

Note on identifiers: since the image-only experiments (June 2026), `prolific_pid` holds a
SHA-256 hash computed in the participant's browser — the raw PID never reaches the server.
Earlier experiments stored raw PIDs.

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
