"""
Generate stimulus set JSON from CSV with product descriptions.

This script:
1. Updates the source CSV with generated descriptions (if needed)
2. Generates the stimulus JSON file from the CSV
"""

import csv
import json
from datetime import date
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
CSV_PATH = SCRIPT_DIR.parent / "Experiment" / "amazon_reviews_Kitchen_&_Dining_Coffee,_Tea_&_Espresso_top_products.csv"
STIMULI_DIR = SCRIPT_DIR / "stimuli"

# Generated descriptions keyed by ASIN
DESCRIPTIONS = {
    "B000F49XXG": {
        "name": "DeLonghi EC155 Espresso Machine",
        "description": "Entry-level 15-bar pump espresso machine with stainless steel boiler and dual thermostats for optimal brewing temperature. Features manual steam wand for frothing milk, dual filter holder for ground coffee or ESE pods, cup warmer, and removable 35-ounce water tank. Compact countertop design."
    },
    "B00CH9QWOU": {
        "name": "Breville Barista Express",
        "description": "Semi-automatic espresso machine with integrated conical burr grinder featuring 16 grind settings. Includes 15-bar Italian pump, PID temperature control, and 360-degree swivel steam wand for milk frothing. Features 67oz water tank, volumetric shot control, and 54mm portafilter with included tamper and accessories."
    },
    "B007K9OIMU": {
        "name": "Mr. Coffee Cafe Barista",
        "description": "Semi-automatic 3-in-1 espresso, cappuccino, and latte maker with a 15-bar pump for rich extraction. Features one-touch controls for single or double shots, an automatic milk frother with adjustable settings, and removable water and milk reservoirs for easy filling and cleaning."
    },
    "B00YCP71VK": {
        "name": "De'Longhi ECP3120 Espresso Machine",
        "description": "Entry-level espresso machine with 15-bar pressure pump for extraction. Features an Advanced Cappuccino System with manual steam wand for frothing milk. Includes three-in-one filter holder for single shots, double shots, or ESE pods. Self-priming for quick startup. Compact design with removable water tank."
    },
    "B06ZYSM2GR": {
        "name": "Nespresso Essenza Mini with Aeroccino",
        "description": "Compact single-serve espresso machine with 19-bar pressure pump for espresso and lungo. Features 20.3 oz removable water tank, 30-second heat-up, and auto shut-off. Includes Aeroccino 3 milk frother for hot or cold frothed milk. Uses Nespresso Original capsules."
    },
    "B01MG4VZCT": {
        "name": "Nespresso Inissia Bundle with Aeroccino",
        "description": "Compact single-serve espresso machine with 19-bar pressure extraction and 25-second heat-up time. Features two programmable buttons for espresso and lungo sizes, auto shut-off, and folding drip tray. Includes Aeroccino milk frother for hot or cold frothed milk."
    },
    "B085SC16LF": {
        "name": "Nespresso Vertuo Next with Aeroccino",
        "description": "Single-serve coffee and espresso machine using Centrifusion technology that spins capsules at 7,000 RPM for extraction. Offers four cup sizes from espresso to mug. Features 30-second heat-up, Bluetooth connectivity, and automatic capsule ejection. Includes Aeroccino3 frother for hot or cold milk foam."
    },
    "B07STXCNXW": {
        "name": "Calphalon Temp iQ Espresso Machine",
        "description": "Semi-automatic espresso machine with dual thermoblock heating for simultaneous brewing and steaming. Features 15-bar Italian pump, PID temperature control, and 58mm commercial portafilter. Includes steam wand for frothing milk, pressure gauge, 2L water reservoir, and cup warming tray."
    },
    "B00DS476HU": {
        "name": "Breville Infuser Espresso Machine",
        "description": "Semi-automatic espresso machine with low-pressure pre-infusion to evenly extract flavor. Features 15-bar Italian pump, PID temperature control adjustable in 2°F increments, pressure gauge, and 1600W thermocoil heating. Includes steam wand for milk frothing, 61oz removable water tank, and dual-wall filter baskets."
    },
    "B01LWUI6B8": {
        "name": "EspressoWorks 7-Piece Barista Bundle",
        "description": "Complete espresso setup with 15-bar pump machine, built-in steam wand for milk frothing, and electric grinder. Includes portafilter with single and double shot baskets, frothing pitcher, tamper, and two ceramic cups. Features 45-second heat-up via thermoblock system, 1.25L removable water tank, and auto shut-off."
    },
    "B07D53TTFD": {
        "name": "STARESSO Portable Espresso Maker",
        "description": "Manual portable espresso maker compatible with Nespresso-style capsules and ground coffee. Features 15-18 bar pressure, 80ml water tank, and stainless steel construction. No batteries required. Compact bottle-sized design weighing 1.1 pounds, suitable for travel, camping, and office use."
    },
    "B08C96BG9H": {
        "name": "De'Longhi Stilosa Espresso Machine",
        "description": "Compact manual espresso machine with 15-bar pump pressure for optimal extraction. Features a stainless steel boiler, manual steam wand for frothing milk, and ergonomic portafilter with single and double shot filters. Includes tamper. Two-level cup holder accommodates various cup sizes."
    },
    "B07VFY4MXM": {
        "name": "Philips 3200 LatteGo",
        "description": "Fully automatic espresso machine with LatteGo milk frother using cyclonic technology for creamy foam. Features 100% ceramic grinder with 12 settings, intuitive touch display, and five drink options including cappuccino and latte macchiato. AquaClean filter allows up to 5,000 cups without descaling."
    },
    "B00VTA9F6U": {
        "name": "WACACO Minipresso GR",
        "description": "Compact handheld espresso maker requiring no electricity or cartridges. Features a semi-automatic piston pumping system generating 8 bars of pressure for authentic espresso with crema. Holds 70ml water and 8g ground coffee. Weighs 360g with built-in cup and scoop. Ideal for camping, hiking, and travel."
    },
    "B001QTVXCI": {
        "name": "Capresso 4-Cup Espresso Machine",
        "description": "Entry-level 4-cup espresso and cappuccino machine with 800W steam/boiler system. Features adjustable coffee strength selector, swivel frother for steaming milk, and illuminated controls. Includes glass carafe and removable drip tray. Brews up to 4 cups in under 5 minutes."
    },
    "B07CJ3CYF7": {
        "name": "Mr. Coffee One-Touch CoffeeHouse+",
        "description": "Semi-automatic espresso machine with one-touch controls for espresso, cappuccinos, and lattes. Features a 19-bar Italian pump for flavor extraction, automatic milk frother with selectable froth levels, and 18oz removable milk reservoir. Includes visual progress bar, adjustable cup tray, and ESE pod compatibility."
    },
    "B01M68FHZ4": {
        "name": "Nespresso CitiZ Espresso Machine",
        "description": "Compact single-serve espresso machine with retro-modern design. Features 19-bar pump pressure and 25-second heat-up time. Two programmable buttons for espresso and lungo. Includes 34-ounce removable water tank, folding cup tray, and automatic shut-off after 9 minutes. Comes with 14-capsule tasting kit."
    },
    "B003XV31IG": {
        "name": "Gaggia Brera Super-Automatic",
        "description": "Compact super-automatic espresso machine with ceramic burr grinder and bypass doser for pre-ground coffee. Features Pannarello wand for milk frothing, 15-bar pump pressure, pre-infusion, and adaptive grind adjustment. Offers programmable cup sizes, three brew strengths, and five grind settings. Front-loading design fits under cabinets."
    },
    "B07ZG44HGR": {
        "name": "Mixpresso Nespresso Espresso Machine",
        "description": "Single-serve espresso maker compatible with Nespresso OriginalLine capsules. Features a 19-bar Italian pressure pump for barista-style extraction, 27oz removable water tank, and programmable buttons for espresso and lungo sizes. Compact 1400W design with one-touch operation and automatic shut-off."
    },
    "B0B7P81K6S": {
        "name": "Philips 3200 LatteGo with Iced Coffee",
        "description": "Fully automatic espresso machine with LatteGo milk frother using cyclonic technology for silky foam. Features 5 coffee varieties including dedicated iced coffee mode, 100% ceramic grinder with 12 settings, intuitive touch display, and AquaClean filter eliminating descaling for up to 5000 cups."
    },
    "B078WMLXXG": {
        "name": "Breville Barista Touch",
        "description": "Automatic espresso machine with touchscreen interface and integrated conical burr grinder featuring 30 settings. Includes ThermoJet heating system for 3-second heat-up, automatic steam wand with adjustable milk texture and temperature, and 54mm portafilter. Stores up to 8 personalized coffee recipes."
    },
    "B08KTK5L3P": {
        "name": "Chefman 6-in-1 Espresso Machine",
        "description": "A 15-bar pump espresso machine with built-in milk frother for cappuccinos and lattes. Features one-touch digital controls for single or double shots, removable 1.8-liter water reservoir, self-cleaning function, and dishwasher-safe parts. Compact stainless steel design at 1350W."
    },
    "B07Y2Q7YXZ": {
        "name": "Nespresso VertuoPlus by Breville",
        "description": "Single-serve coffee and espresso machine using Centrifusion technology that spins capsules at 7,000 RPM to extract coffee with crema. Brews five cup sizes from espresso to 14 oz alto. Features 40 oz water tank, 15-second heat-up, motorized head, and automatic capsule ejection."
    },
    "B077ND88HQ": {
        "name": "WACACO Nanopresso",
        "description": "Compact hand-operated portable espresso maker generating up to 18 bars of pressure without electricity. Weighs 0.74 lbs with 80ml water tank and 8g coffee capacity. Produces espresso with dense crema. Includes carrying pouch, cup, and cleaning accessories. Ideal for travel, camping, and office use."
    },
    "B01M4J94WY": {
        "name": "WACACO Minipresso NS",
        "description": "Compact, handheld espresso maker compatible with Nespresso Original capsules. Manually operated semi-automatic piston generates up to 8 bars of pressure without batteries or electricity. Weighs 350g with 70ml water tank capacity, producing up to 45ml espresso shots. Includes built-in cup and carrying pouch for travel."
    },
    "B07VW5YGSC": {
        "name": "Flair Espresso Maker Classic",
        "description": "Manual lever espresso machine requiring no electricity. Brews 6-9 bar espresso with up to 18g doses yielding 40ml shots. Includes pressure gauge for visual feedback, stainless steel tamper, and padded carrying case. Detachable brewing head for easy cleaning. Compact aluminum and steel construction."
    },
    "B07KY229WP": {
        "name": "EspressoWorks 10-Piece Espresso Maker",
        "description": "Complete 10-piece espresso bundle with 19-bar pump machine, built-in milk frother, and electric coffee grinder. Features one-touch control panel with LED indicators for espresso, latte, cappuccino, or frothed milk. Includes portafilter with single and double shot baskets, four double-walled cups, and tamper. 1250W with 45-second heat-up time."
    },
    "B07RQ3NL76": {
        "name": "Gaggia Classic Evo Pro",
        "description": "Italian-made semi-automatic espresso machine with commercial-grade 58mm portafilter and 9-bar extraction pressure. Features a professional two-hole steam wand for microfoam, 3-way solenoid valve for dry pucks, and single boiler with quick heat-up. Includes pressurized and unpressurized filter baskets."
    },
}


def update_csv_with_descriptions(csv_path: Path = CSV_PATH) -> None:
    """
    Update the source CSV file with generated descriptions.
    Adds 'short_name' and 'description' columns while preserving all existing columns.
    """
    rows = []
    fieldnames = None

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames)

        # Add new columns if they don't exist (insert before last column or append)
        if 'short_name' not in fieldnames:
            fieldnames.append('short_name')
        if 'description' not in fieldnames:
            fieldnames.append('description')

        for row in reader:
            asin = row.get('asin', '')
            if asin in DESCRIPTIONS:
                row['short_name'] = DESCRIPTIONS[asin]['name']
                row['description'] = DESCRIPTIONS[asin]['description']
            else:
                # Preserve existing values or set empty
                if 'short_name' not in row:
                    row['short_name'] = ''
                if 'description' not in row:
                    row['description'] = ''
            rows.append(row)

    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Updated {csv_path} with {len(DESCRIPTIONS)} descriptions")


def generate_stimulus_json(
    csv_path: Path = CSV_PATH,
    output_name: str = "default",
    word_limit: int = 50
) -> Path:
    """
    Generate stimulus JSON file from the CSV.

    Args:
        csv_path: Path to the source CSV file
        output_name: Name for the output JSON file (without extension)
        word_limit: Word limit used for descriptions (for metadata)

    Returns:
        Path to the generated JSON file
    """
    products = []

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Only include products marked with "X" in Include column
            if row.get('Include', '').strip() != 'X':
                continue

            asin = row.get('asin', '')
            if not asin:
                continue

            # Get description from CSV (should have been added by update_csv_with_descriptions)
            description = row.get('description', '')
            short_name = row.get('short_name', '')

            if not description:
                print(f"Warning: No description for {asin}")
                continue

            products.append({
                "id": asin,
                "name": short_name,
                "description": description,
                "price": row.get('current_price', '').strip(),
                "image": f"{asin}.png"
            })

    # Create output structure
    output = {
        "products": products,
        "metadata": {
            "created": date.today().isoformat(),
            "source": csv_path.name,
            "word_limit": word_limit
        }
    }

    # Ensure output directory exists
    STIMULI_DIR.mkdir(exist_ok=True)

    # Write JSON file
    output_path = STIMULI_DIR / f"{output_name}.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f"Generated {output_path} with {len(products)} products")
    return output_path


if __name__ == "__main__":
    # First update CSV with descriptions
    update_csv_with_descriptions()

    # Then generate JSON from CSV
    generate_stimulus_json(output_name="with 50 words", word_limit=50)
