# Test Survey

Run end-to-end validation of the similarity experiment against a deployed URL.

## Usage
```
/test-survey <url> [api-key]
```

Examples:
- `/test-survey https://similarity-experiment.vercel.app`
- `/test-survey http://localhost:3000 my-export-key`

## Parameters
- **url**: The base URL of the deployed experiment (required)
- **api-key**: The EXPORT_API_KEY for downloading CSV data (optional, defaults to `test-key`)

## What This Does

1. **Fetches stimuli** from `{url}/stimuli/{EXPERIMENT_NAME}.json`
2. **Completes the full survey** (consent → instructions → 11 trials → demographics → completion)
3. **Takes screenshots** of each step
4. **Validates displayed products** against the stimuli JSON (name, price, description, image)
5. **Downloads exported data** via `/api/export` and verifies:
   - `pair_id` is alphabetically sorted
   - `position` (AB/BA) matches actual display order
   - `rating` matches slider values used
   - `is_catch_trial` correctly identifies identical products
6. **Generates reports** with validation results

## Process

Run the test script:
```bash
cd similarity-experiment && node scripts/test-survey.js <url> [api-key]
```

The script creates a timestamped output directory with:
```
test-results/YYYY-MM-DD_HH-MM-SS/
  consent.png
  instructions.png
  trial-01.png through trial-11.png
  demographics.png
  completion.png
  stimuli-snapshot.json
  observed-trials.json
  exported_data.csv
  report.json
  report.txt
```

## Validation Checks

| Check | Description |
|-------|-------------|
| Stimuli Match | Each displayed product's name/price/description matches JSON |
| Image Match | Image src contains correct product ID |
| Position Tracking | Exported AB/BA matches actual left/right display |
| Pair IDs | Alphabetically sorted in export |
| Catch Trial | Marked correctly when both products identical |
| Ratings | Match slider values used during test |

## Requirements

- Node.js with Puppeteer installed: `npm install puppeteer`
- The experiment must be running at the specified URL
- For data export validation, provide a valid API key

## After Running

1. Check `test-results/` for screenshots and reports
2. Open `report.txt` for a human-readable summary
3. Check `report.json` for structured validation results
4. If any checks failed, investigate the corresponding screenshots
