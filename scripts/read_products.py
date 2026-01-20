"""
Stimulus set utilities for reading/writing product data.

Usage:
  python scripts/read_products.py read                              # Get products as JSON
  python scripts/read_products.py check <column-name>               # Check if column exists
  python scripts/read_products.py write <column-name> <json>        # Write descriptions to CSV
  python scripts/read_products.py export <column-name> [word-limit] # Export JSON stimulus file
"""

import csv
import json
import sys
from pathlib import Path
from datetime import date

# CSV path (relative to this script)
CSV_PATH = Path(__file__).parent.parent.parent / "Experiment" / "amazon_reviews_Kitchen_&_Dining_Coffee,_Tea_&_Espresso_top_products.csv"

# Output directory for stimulus JSON files
STIMULI_DIR = Path(__file__).parent.parent / "stimuli"


def read_products(csv_path=None):
    """Read products from CSV, return list of dicts for included products."""
    csv_path = Path(csv_path) if csv_path else CSV_PATH

    products = []
    with open(csv_path, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('Include', '').strip() == 'X':
                products.append({
                    'asin': row.get('asin', '').strip(),
                    'name': row.get('Study Name', '').strip(),
                    'price': row.get('current_price', '').strip(),
                    'title': row.get('title', '').strip()
                })

    return products


def check_column_exists(column_name, csv_path=None):
    """Check if a column exists in the CSV and has data for included products."""
    csv_path = Path(csv_path) if csv_path else CSV_PATH

    with open(csv_path, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        if column_name not in reader.fieldnames:
            return {'exists': False, 'has_data': False, 'count': 0}

        count = 0
        for row in reader:
            if row.get('Include', '').strip() == 'X':
                if row.get(column_name, '').strip():
                    count += 1

        return {'exists': True, 'has_data': count > 0, 'count': count}


def write_descriptions(set_name, descriptions, csv_path=None):
    """
    Write descriptions to CSV as a new column.

    Args:
        set_name: Column header name (e.g., 'coffee-espresso')
        descriptions: Dict mapping ASIN -> description text
        csv_path: Path to CSV file (optional)
    """
    csv_path = Path(csv_path) if csv_path else CSV_PATH

    # Read existing CSV
    with open(csv_path, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames.copy()
        rows = list(reader)

    # Add new column if it doesn't exist
    if set_name not in fieldnames:
        fieldnames.append(set_name)

    # Update rows with descriptions
    for row in rows:
        asin = row.get('asin', '').strip()
        if asin in descriptions:
            row[set_name] = descriptions[asin]
        elif set_name not in row:
            row[set_name] = ''

    # Write back to CSV
    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(descriptions)} descriptions to column '{set_name}'", file=sys.stderr)


def export_stimulus_json(set_name, word_limit=50, csv_path=None, output_path=None):
    """
    Export stimulus JSON file from CSV data.

    Args:
        set_name: Column name containing descriptions
        word_limit: Word limit used for descriptions (for metadata)
        csv_path: Path to CSV file (optional)
        output_path: Path for output JSON (optional, defaults to stimuli/<set_name>.json)
    """
    csv_path = Path(csv_path) if csv_path else CSV_PATH
    output_path = Path(output_path) if output_path else STIMULI_DIR / f"{set_name}.json"

    products = []
    with open(csv_path, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)

        # Check if description column exists
        if set_name not in reader.fieldnames:
            print(f"Error: Column '{set_name}' not found in CSV", file=sys.stderr)
            sys.exit(1)

        for row in reader:
            if row.get('Include', '').strip() == 'X':
                description = row.get(set_name, '').strip()
                if not description:
                    print(f"Warning: No description for ASIN {row.get('asin')}", file=sys.stderr)
                    continue

                products.append({
                    'id': row.get('asin', '').strip(),
                    'name': row.get('Study Name', '').strip(),
                    'description': description,
                    'price': row.get('current_price', '').strip(),
                    'image': row.get('asin', '').strip() + '.png'
                })

    output = {
        'products': products,
        'metadata': {
            'created': date.today().isoformat(),
            'source': CSV_PATH.name,
            'description_column': set_name,
            'word_limit': word_limit
        }
    }

    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f"Exported {len(products)} products to {output_path}", file=sys.stderr)
    return output


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command == 'read':
        # Output products as JSON
        products = read_products()
        print(json.dumps(products, indent=2))
        print(f"Found {len(products)} products with Include = 'X'", file=sys.stderr)

    elif command == 'check':
        if len(sys.argv) < 3:
            print("Usage: python read_products.py check <column-name>", file=sys.stderr)
            sys.exit(1)
        column_name = sys.argv[2]
        result = check_column_exists(column_name)
        print(json.dumps(result))

    elif command == 'write':
        if len(sys.argv) < 4:
            print("Usage: python read_products.py write <column-name> <json-string>", file=sys.stderr)
            sys.exit(1)
        set_name = sys.argv[2]
        descriptions = json.loads(sys.argv[3])  # Dict of ASIN -> description
        write_descriptions(set_name, descriptions)

    elif command == 'export':
        if len(sys.argv) < 3:
            print("Usage: python read_products.py export <column-name> [word-limit]", file=sys.stderr)
            sys.exit(1)
        set_name = sys.argv[2]
        word_limit = int(sys.argv[3]) if len(sys.argv) > 3 else 50
        output = export_stimulus_json(set_name, word_limit=word_limit)
        print(json.dumps(output, indent=2))

    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        print(__doc__)
        sys.exit(1)
