# Analysis Data Pipeline

How to get analysis-ready data out of the experiment database.

```
node scripts/make-analysis-tables.js                  # default experiment (from config-image-only.js)
node scripts/make-analysis-tables.js --list           # what's in the database
node scripts/make-analysis-tables.js --dry-run        # validate + report, write nothing
```

The script pulls the live Neon database (`POSTGRES_URL` from `.env.local`), validates every
row against the experiment's design invariants, and writes **three CSVs sharing the
`session_id` key** to `data/exports/` (gitignored — exports contain participant data and the
repo is public; the script refuses to write to any non-gitignored directory inside the repo).

## The three tables

### 1. `<experiment>_similarity_long.csv` — one row per similarity trial

| Column | Notes |
|---|---|
| `session_id` | Join key (UUID, server-generated — independent of Prolific PID) |
| `completed` | 0/1 — session finished. **All sessions are included; filter this yourself** |
| `trial_number` | Within-session presentation order (1..16 = 15 pairs + 1 catch), usable directly for order effects |
| `pair_id` | Alphabetically sorted ids joined by `_` (e.g. `cheerios-plain_life`) |
| `product_a`, `product_b` | `pair_id` split apart; `a` < `b` alphabetically |
| `product_a_idx`, `product_b_idx` | Stable 1..N indices in stimuli.json order (for matrix building) |
| `left_product_id`, `right_product_id` | What was actually on screen |
| `position` | `AB` = alphabetically-first product on the left, `BA` = reversed |
| `is_catch_trial` | 0/1 — catch trials (same product both sides) are **included, flagged**. Filter before building matrices |
| `rating` | 0–100 slider |
| `response_time_ms` | Per trial |

### 2. `<experiment>_users_wide.csv` — one row per session

| Column | Notes |
|---|---|
| `session_id` | Join key |
| `prolific_pid_hash` | SHA-256 of the Prolific PID (hashed in the participant's browser; raw PID never stored). Empty if no PID in URL. To find a specific participant: hash their PID and search |
| `experiment_name`, `completed`, `started_at`, `completed_at`, `total_duration_ms` | Session metadata; timestamps ISO 8601 UTC |
| `age`, `gender` | Demographics |
| `n_similarity_trials` | Count of **regular** (non-catch) trials; 0 for instant dropouts |
| `median_similarity_rt_ms`, `sd_similarity_rating`, `n_rating_eq_50` | Engagement/exclusion variables over regular trials only (50 = the slider's default → soft non-engagement signal). Empty when not computable |
| `catch_rating` | Raw rating on the catch trial (same product twice; should be ~100) |
| `catch_passed` | **Three-state**: 1 (≥ threshold, default 80), 0 (below), empty (no catch trial — reads as NA, don't count as a failure). Re-threshold from `catch_rating` or via `--catch-threshold` |
| `cereal_days_past_week` | 0–7 |
| `cereal_days_rt_ms`, `familiarity_page_rt_ms` | Page-level response times |
| `familiarity_<product>` × N | 1–7 per product, columns in stimuli.json order, values matched by product id (display order was randomized). Missing → empty, never 0 |

### 3. `<experiment>_products.csv` — product lookup

`product_idx, product_id, product_name, image_filename, familiarity_column` — the factor
universe in stimuli.json order. Use for matrix dimnames, plot labels, and joining familiarity
columns back to products.

## Standard recipe

```r
long <- read.csv("data/exports/<exp>_similarity_long.csv")
wide <- read.csv("data/exports/<exp>_users_wide.csv")
df   <- merge(subset(long, completed == 1 & is_catch_trial == 0),
              wide[, !names(wide) %in% c("completed", "experiment_name")], by = "session_id")
mat  <- with(df, tapply(rating, list(product_a, product_b), mean, na.rm = TRUE))
mat  <- (mat + t(mat)) / 2   # symmetrize (each pair observed in one a/b orientation)
```

```python
df  = long[(long.completed == 1) & (long.is_catch_trial == 0)].merge(
          wide.drop(columns=["completed", "experiment_name"]), on="session_id")
mat = df.pivot_table(index="product_a", columns="product_b", values="rating", aggfunc="mean")
```

Gotchas the format is designed around:
- **Filter `completed == 1` and `is_catch_trial == 0` yourself** — nothing is silently dropped.
- Empty cell = NA. Use `na.rm=TRUE`/`skipna`; never `na.omit()` whole wide rows.
- `familiarity_*` columns are experiment-specific — don't pool across experiments.

## Validation behavior

- **Hard errors** (corrupt data: pair/position inconsistencies, unknown survey questions,
  duplicate familiarity, out-of-range ratings, products not in stimuli) → prints all, writes
  **nothing**, exits 1.
- **Warnings** (completed session missing rows/demographics, values outside expected survey
  ranges, page-RT anomalies) → files are written, warnings printed in the report.
- The report always shows: session counts, rows per file, catch pass rate, pair coverage
  (distinct pairs of C(N,2), min/median/max ratings per pair), and AB/BA position balance.

## How survey responses live in the database

There is no separate survey table: post-task responses are rows in `trials` with
`trial_number >= 1001`, `pair_id`/`position` NULL, the answer in `rating`, and the question
identified in `data` (`{question: 'cereal_days_past_week'}` or
`{question: 'brand_familiarity', product_id: '...'}`). `trial_number` 1002+ reflects the
randomized display order of familiarity items; the script matches values to columns by
`product_id`, never by position. See `DATABASE.md` for the full schema.

## Older experiments

The script works on legacy experiments too (`node scripts/make-analysis-tables.js 50_word`):
stimuli load from `stimuli/<experiment>.json` (old flat convention) as a fallback to
`stimuli/<experiment>/stimuli.json`, survey columns simply come out empty, and
`prolific_pid_hash` contains the **raw** PID for pre-hashing experiments (Feb 2026 pilot and
earlier) — treat those files accordingly.
