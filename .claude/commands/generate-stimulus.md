# Generate Stimulus (Sub-Agent Instructions)

This file documents the sub-agent instructions used by `/generate-stimulus-set`. It is not invoked directly.

## Sub-Agent Task

When the orchestrator spawns a sub-agent for a product, it receives:
- Product title
- ASIN (product ID)
- Price
- Word limit (default: 50)

## Sub-Agent Process

1. **Web search** for the product to understand key features
2. **Generate description** that is:
   - Under the word limit (default 50 words)
   - Factual and descriptive
   - Focused on key features and use cases
   - Neutral in tone (no marketing language)
3. **Return JSON** with the product entry

## Output Format

Return ONLY a JSON object (no markdown code blocks, no explanation):

```json
{
  "id": "B00CH9QWOU",
  "name": "Breville Barista Express",
  "description": "Semi-automatic espresso machine with built-in conical burr grinder. Features 15-bar Italian pump, precise temperature control, and steam wand for milk frothing.",
  "price": "$676.00",
  "image": "B00CH9QWOU.png"
}
```

## Field Guidelines

- **id**: Use the ASIN exactly as provided
- **name**: Shortened display name (brand + model). Remove dimensions, colors, and marketing phrases
- **description**: Neutral, feature-focused. Mention:
  - Product type/category
  - Key distinguishing features
  - Capacity or size if relevant
  - Notable functionality
- **price**: Use exactly as provided
- **image**: ASIN + ".png"

## Example

Input:
```
Product: "Breville Barista Express Espresso Machine, Brushed Stainless Steel, BES870XL"
ASIN: B00CH9QWOU
Price: $676.00
```

Output:
```json
{"id": "B00CH9QWOU", "name": "Breville Barista Express", "description": "Semi-automatic espresso machine with integrated conical burr grinder. Features 15-bar Italian pump, precise PID temperature control, steam wand for milk frothing, and programmable shot volumes.", "price": "$676.00", "image": "B00CH9QWOU.png"}
```
