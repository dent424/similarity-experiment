# Generate Stimulus Set

Generate product descriptions and save to CSV.

## Usage
```
/generate-stimulus-set [column-name] [word-limit]
```

Example: `/generate-stimulus-set 50_word 50`

## Parameters
- **column-name**: Name for CSV column AND stimulus set filename (e.g., `50_word`, `25_word`)
- **word-limit**: Maximum words for each description (e.g., `50`, `25`, `100`)

## Critical Rules

**NEVER create JSON files directly** - always use the Python export function (Step 5).

**Product names MUST come from CSV's `Study Name` column** - sub-agents only generate descriptions, never names.

## Process

**Step 1: Check if column exists**
```bash
python scripts/read_products.py check [column-name]
```
Returns: `{"exists": true/false, "has_data": true/false, "count": N}`

- If `has_data` is true: **STOP** and tell the user the column already exists. They must choose a different column name.
- If not, proceed to Step 2

**Step 2: Read products**
```bash
python scripts/read_products.py read
```
Returns: [{asin, name, price, title}, ...]

**Step 3: Generate descriptions** (via sub-agents in batches of 5) using this prompt:
```
Generate a product description for the similarity experiment.

Product: "[TITLE]"
ASIN: [ASIN]

Instructions:
1. Web search for key features (use snippets only, don't fetch pages)
2. Write under [WORD-LIMIT] words, factual, feature-focused, neutral tone
3. Return ONLY: [ASIN]: description text
4. Do NOT include product name, price, or any other fields
5. Do NOT return JSON or markdown formatting

Output format: [ASIN]: Your description here as plain text.

Example output:
B00CH9QWOU: Semi-automatic espresso machine with integrated burr grinder. Features 15-bar pump, PID temperature control, and steam wand for milk frothing.
```

**Step 4: Write to CSV**
```bash
python scripts/read_products.py write [column-name] '{"ASIN": "description", ...}'
```
Adds column `[column-name]` to CSV with descriptions.

**Step 5: Export JSON**
```bash
python scripts/read_products.py export [column-name] [word-limit]
```
Creates `stimuli/[column-name].json`:
```json
{
  "products": [
    {"id": "ASIN", "name": "Study Name", "description": "...", "price": "$X", "image": "ASIN.png"}
  ],
  "metadata": {"created": "YYYY-MM-DD", "word_limit": [WORD-LIMIT]}
}
```

**Step 6: Validate output**
1. Read the exported JSON file
2. Run `python scripts/read_products.py read` to get CSV data
3. Compare each product's `name` in JSON against the `name` from CSV
4. Report any mismatches - if found, the JSON was not created correctly

This validation ensures names came from the CSV's `Study Name` column, not from sub-agent generation.

## Parallelization
Launch sub-agents in synchronous parallel batches of 5-6:
1. Send a single message with 5-6 Task tool calls (no `run_in_background`)
2. Results return directly in the response
3. Collect results, then launch next batch
4. Repeat until all products are processed

Do NOT use `run_in_background: true` - output files may be empty.

## Notes
- `name` comes from `Study Name` column
- `price` comes from `current_price` column
- Only products with `Include` = "X" are processed
- Images must exist as `stimuli/[ASIN].png`
