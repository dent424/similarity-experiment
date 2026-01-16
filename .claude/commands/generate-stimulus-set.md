# Generate Stimulus Set

Generate product descriptions for all included products in the CSV file.

## Usage

```
/generate-stimulus-set [set-name]
```

## Process

1. **Read the CSV file**: `../Experiment/amazon_reviews_Kitchen_&_Dining_Coffee,_Tea_&_Espresso_top_products.csv`
2. **Filter products**: Only process rows where `Include` column = "X"
3. **For each product**, spawn a sub-agent via the Task tool with:
   - Product title (from `title` column)
   - ASIN (from `asin` column) - used as product ID
   - Price (from `current_price` column)
   - Word limit: 50
4. **Collect results** into `stimuli/[set-name].json`

## Sub-Agent Prompt Template

For each product, spawn a Task with `subagent_type: "general-purpose"` and this prompt:

```
Generate a product description for the similarity experiment.

Product: "[TITLE]"
ASIN: [ASIN]
Price: [PRICE]

Instructions:
1. Search the web for this product to understand its key features
   IMPORTANT: Use only the search result snippets to write the description.
   Do NOT fetch individual web pages.
2. Generate a description that is:
   - Under 50 words
   - Factual and descriptive
   - Focused on key features and use cases
   - Neutral in tone (no marketing language)
3. Return ONLY a JSON object (no markdown, no explanation):

{"id": "[ASIN]", "name": "[SHORT_NAME]", "description": "[DESCRIPTION]", "price": "[PRICE]", "image": "[ASIN].png"}

Where:
- id: The ASIN exactly as provided
- name: A shortened display name (brand + model, no dimensions/colors)
- description: Your generated 50-word description
- price: The price exactly as provided
- image: The ASIN + ".png"
```

## Parallelization

- Launch sub-agents in parallel batches (e.g., 5 at a time) to speed up generation
- Use `run_in_background: true` for sub-agents, then collect results

## Output Format

Save to `stimuli/[set-name].json`:

```json
{
  "products": [
    {
      "id": "B00CH9QWOU",
      "name": "Breville Barista Express Espresso Machine",
      "description": "Semi-automatic espresso machine with built-in conical burr grinder...",
      "price": "$676.00",
      "image": "B00CH9QWOU.png"
    }
  ],
  "metadata": {
    "created": "YYYY-MM-DD",
    "source": "amazon_reviews_Kitchen_&_Dining_Coffee,_Tea_&_Espresso_top_products.csv",
    "word_limit": 50
  }
}
```

## Example

```
/generate-stimulus-set coffee-espresso
```

This will:
1. Read CSV, filter to 29 included products (where `Include` = "X")
2. Generate descriptions for each via parallel sub-agents
3. Save to `stimuli/coffee-espresso.json`

## CSV Columns Used

- `title`: Full product name
- `asin`: Amazon Standard Identification Number (product ID)
- `current_price`: Price string (e.g., "$676.00")
- `Include`: "X" if product should be included

## Notes

- Images already exist in `stimuli/` as `[ASIN].png` files
- The ASIN is used as the product ID because it's unique and stable
- Set name argument ($ARGUMENTS) determines output filename
