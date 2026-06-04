# Similarity Experiment

Web-based experiment where participants rate product similarity on a 100-point slider.

## Quick Start

1. Clone this repo
2. Deploy to Vercel (push to `master` auto-deploys; deploys are silent and take a few minutes)
3. Configure the experiment in `config-image-only.js` (experiment name, trial count, Prolific completion URL)

## Getting the Data

```bash
node scripts/make-analysis-tables.js          # analysis-ready tables -> data/exports/
node scripts/make-analysis-tables.js --list   # what's in the database
```

See **`ANALYSIS.md`** for the table formats and analysis recipes, and **`DATABASE.md`** for
the schema and API endpoints.

## Generating Stimuli with Claude Code

This repo includes Claude Code slash commands for generating product descriptions. They work automatically when you open this folder in Claude Code - no setup required.

### Generate a Stimulus Set

```
/generate-stimulus-set [set-name]
```

This will:
- Read product data from `data/products.csv`
- Generate 50-word descriptions for each product (via web search)
- Save to `stimuli/[set-name].json`

### CSV Format

The source CSV (`data/products.csv`) must have:
- `title` - Product name
- `asin` - Amazon product ID
- `current_price` - Price string
- `Include` - "X" to include product

## Project Structure

```
similarity-experiment/
├── .claude/commands/      # Claude Code slash commands
├── data/products.csv      # Source product data
├── stimuli/               # Generated stimuli & images
├── tests/                 # Puppeteer tests
├── index.html             # Experiment UI
├── experiment.js          # Experiment logic
├── config.js              # Configuration
└── README.md              # This file
```

## Configuration

Edit `config.js`:
- `N_PAIRS`: Number of pairs per participant (default: 10)
- `QUALTRICS_URL`: Redirect URL after completion
- `STIMULUS_SET`: Which JSON file to load

## Testing

```bash
npm install
npm test
```
