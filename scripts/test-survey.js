/**
 * End-to-end validation test for the similarity experiment survey.
 *
 * Usage: node scripts/test-survey.js <url> [api-key]
 *
 * This script:
 * 1. Fetches stimuli from the deployed experiment
 * 2. Completes the full survey with screenshots
 * 3. Validates displayed products against stimuli JSON
 * 4. Downloads and validates exported data
 * 5. Generates validation reports
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for waiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Wait for all images to load
const waitForImages = async (page) => {
  await page.evaluate(async () => {
    const images = document.querySelectorAll('img');
    await Promise.all(
      Array.from(images)
        .filter(img => !img.complete)
        .map(img => new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve; // Don't block on broken images
        }))
    );
  });
};

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node scripts/test-survey.js <url> [api-key]');
  console.error('Example: node scripts/test-survey.js http://localhost:3000 my-key');
  process.exit(1);
}

const BASE_URL = args[0].replace(/\/$/, ''); // Remove trailing slash
const API_KEY = args[1] || 'test-key';

// Create timestamped output directory
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_DIR = path.join(__dirname, '..', 'test-results', timestamp);

// Validation results
const validationResults = {
  timestamp: new Date().toISOString(),
  baseUrl: BASE_URL,
  stimuliUrl: null,
  stimuliValid: false,
  trialsCompleted: 0,
  trialValidations: [],
  exportValidations: [],
  errors: [],
  passed: 0,
  failed: 0,
  summary: ''
};

// Observed trial data
const observedTrials = [];

// Stimuli data
let stimuli = null;
let stimuliMap = {};

/**
 * Create output directory structure
 */
function setupOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

/**
 * Take a screenshot and save to output directory
 */
async function screenshot(page, name) {
  await waitForImages(page);
  const filepath = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  Screenshot: ${name}.png`);
}

/**
 * Fetch stimuli from the experiment URL
 */
async function fetchStimuli() {
  // First, we need to get the EXPERIMENT_NAME from config.js
  // We'll fetch the config.js file and parse it
  console.log('\n=== Phase 1: Fetching Configuration ===');

  try {
    const configResponse = await fetch(`${BASE_URL}/config.js`);
    const configText = await configResponse.text();

    // Extract EXPERIMENT_NAME from config
    const match = configText.match(/EXPERIMENT_NAME:\s*['"]([^'"]+)['"]/);
    if (!match) {
      throw new Error('Could not find EXPERIMENT_NAME in config.js');
    }
    const experimentName = match[1];
    console.log(`  Experiment name: ${experimentName}`);

    // Fetch stimuli JSON
    validationResults.stimuliUrl = `${BASE_URL}/stimuli/${experimentName}.json`;
    console.log(`  Fetching: ${validationResults.stimuliUrl}`);

    const stimuliResponse = await fetch(validationResults.stimuliUrl);
    if (!stimuliResponse.ok) {
      throw new Error(`Failed to fetch stimuli: ${stimuliResponse.status}`);
    }

    stimuli = await stimuliResponse.json();

    // Build lookup map by product ID
    for (const product of stimuli.products) {
      stimuliMap[product.id] = product;
    }

    console.log(`  Loaded ${stimuli.products.length} products`);
    validationResults.stimuliValid = true;

    // Save stimuli snapshot
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'stimuli-snapshot.json'),
      JSON.stringify(stimuli, null, 2)
    );

    return experimentName;
  } catch (error) {
    validationResults.errors.push(`Stimuli fetch error: ${error.message}`);
    console.error(`  ERROR: ${error.message}`);
    throw error;
  }
}

/**
 * Extract product ID from image src (e.g., "./stimuli/B00CH9QWOU.png" -> "B00CH9QWOU")
 */
function extractProductIdFromSrc(src) {
  const match = src.match(/([A-Z0-9]{10})\.png$/i);
  return match ? match[1] : null;
}

/**
 * Validate a displayed product against stimuli
 */
function validateProduct(observed, side) {
  const validation = {
    side,
    productId: observed.id,
    checks: []
  };

  const expected = stimuliMap[observed.id];
  if (!expected) {
    validation.checks.push({
      check: 'product_exists',
      passed: false,
      message: `Product ${observed.id} not found in stimuli`
    });
    return validation;
  }

  // Check name
  const nameMatch = observed.name === expected.name;
  validation.checks.push({
    check: 'name',
    passed: nameMatch,
    expected: expected.name,
    observed: observed.name
  });

  // Check price
  const priceMatch = observed.price === expected.price;
  validation.checks.push({
    check: 'price',
    passed: priceMatch,
    expected: expected.price,
    observed: observed.price
  });

  // Check description
  const descMatch = observed.description === expected.description;
  validation.checks.push({
    check: 'description',
    passed: descMatch,
    expected: expected.description?.substring(0, 50) + '...',
    observed: observed.description?.substring(0, 50) + '...'
  });

  // Check image
  const imageMatch = observed.imageSrc.includes(expected.id);
  validation.checks.push({
    check: 'image',
    passed: imageMatch,
    expected: `contains ${expected.id}`,
    observed: observed.imageSrc
  });

  return validation;
}

/**
 * Calculate expected position based on product IDs
 */
function expectedPosition(leftId, rightId) {
  const [idA, idB] = [leftId, rightId].sort();
  return leftId === idA ? 'AB' : 'BA';
}

/**
 * Calculate expected pair_id (alphabetically sorted)
 */
function expectedPairId(leftId, rightId) {
  return [leftId, rightId].sort().join('_');
}

/**
 * Run the full survey test
 */
async function runSurvey() {
  console.log('\n=== Phase 2: Running Survey ===');

  const browser = await puppeteer.launch({
    headless: false, // Show browser for visibility
    defaultViewport: { width: 1280, height: 900 }
  });

  try {
    const page = await browser.newPage();

    // Navigate to the experiment
    console.log(`  Navigating to ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });

    // Wait for consent page
    await page.waitForSelector('#consent-page:not(.hidden)', { timeout: 10000 });
    await screenshot(page, 'consent');

    // Click consent
    console.log('  Clicking consent...');
    await page.click('#consent-btn');

    // Wait for screening page
    await page.waitForSelector('#screening-page:not(.hidden)', { timeout: 10000 });
    await screenshot(page, 'screening');

    // Answer screening questions
    console.log('  Answering screening questions...');
    // Q1: How often do you shop online? - select "monthly"
    await page.click('input[name="sq1"][value="monthly"]');
    // Q2: Do you drink coffee? - select "yes" (required to pass screening)
    await page.click('input[name="sq2"][value="yes"]');
    // Q3: Do you read product reviews? - select "usually"
    await page.click('input[name="sq3"][value="usually"]');

    // Wait for Continue button to be enabled and click
    await delay(200);
    await page.click('#screening-continue-btn');

    // Wait for instructions page
    await page.waitForSelector('#instructions-page:not(.hidden)', { timeout: 10000 });
    await screenshot(page, 'instructions');

    // Answer comprehension questions
    console.log('  Answering comprehension questions...');
    // Q1: If two products have nothing in common, what rating? - answer "0" (value="c")
    await page.click('input[name="q1"][value="c"]');
    // Q2: What does a rating of 100 mean? - answer "extremely similar" (value="b")
    await page.click('input[name="q2"][value="b"]');
    // Q3: Can you go back and change a previous rating? - answer "No" (value="b")
    await page.click('input[name="q3"][value="b"]');

    // Wait for Start button to be enabled
    await delay(200);

    // Click start
    console.log('  Starting trials...');
    await page.click('#start-btn');

    // Wait for trial page
    await page.waitForSelector('#trial-page:not(.hidden)', { timeout: 10000 });

    // Complete each trial
    let trialNum = 0;
    const sliderValues = [0, 25, 50, 75, 100]; // Varying values for testing

    while (true) {
      trialNum++;
      const paddedNum = String(trialNum).padStart(2, '0');

      // Check if we're still on trial page
      const isTrialPage = await page.$('#trial-page:not(.hidden)');
      if (!isTrialPage) break;

      console.log(`  Trial ${trialNum}...`);

      // Extract displayed product data
      const trialData = await page.evaluate(() => {
        const leftImg = document.querySelector('#product-left-img');
        const rightImg = document.querySelector('#product-right-img');

        return {
          left: {
            imageSrc: leftImg ? leftImg.src : null,
            name: document.querySelector('#product-left-name')?.textContent || null,
            price: document.querySelector('#product-left-price')?.textContent || null,
            description: document.querySelector('#product-left-desc')?.textContent || null
          },
          right: {
            imageSrc: rightImg ? rightImg.src : null,
            name: document.querySelector('#product-right-name')?.textContent || null,
            price: document.querySelector('#product-right-price')?.textContent || null,
            description: document.querySelector('#product-right-desc')?.textContent || null
          },
          progressText: document.querySelector('#progress-text')?.textContent || null
        };
      });

      // Extract product IDs from image sources
      const leftId = extractProductIdFromSrc(trialData.left.imageSrc);
      const rightId = extractProductIdFromSrc(trialData.right.imageSrc);

      trialData.left.id = leftId;
      trialData.right.id = rightId;

      // Determine if this is a catch trial (same product on both sides)
      const isCatchTrial = leftId === rightId;

      // Calculate expected values
      const sliderValue = sliderValues[(trialNum - 1) % sliderValues.length];
      const expPosition = expectedPosition(leftId, rightId);
      const expPairId = expectedPairId(leftId, rightId);

      // Record observed trial
      const observed = {
        trialNumber: trialNum,
        leftProductId: leftId,
        rightProductId: rightId,
        leftName: trialData.left.name,
        rightName: trialData.right.name,
        expectedPosition: expPosition,
        expectedPairId: expPairId,
        isCatchTrial: isCatchTrial,
        sliderValue: sliderValue
      };
      observedTrials.push(observed);

      // Validate products
      const leftValidation = validateProduct(trialData.left, 'left');
      const rightValidation = validateProduct(trialData.right, 'right');

      validationResults.trialValidations.push({
        trialNumber: trialNum,
        leftProduct: leftValidation,
        rightProduct: rightValidation,
        isCatchTrial: isCatchTrial
      });

      // Take screenshot
      await screenshot(page, `trial-${paddedNum}`);

      // Move slider to test value
      await page.evaluate((value) => {
        const slider = document.querySelector('#similarity-slider');
        slider.value = value;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, sliderValue);

      // Wait a moment for UI update
      await delay(200);

      // Click next
      await page.click('#next-btn');

      // Wait for the progress text to change (indicates new trial loaded)
      const currentProgress = trialData.progressText;
      await page.waitForFunction(
        (prevProgress) => {
          const progressEl = document.querySelector('#progress-text');
          const trialPage = document.querySelector('#trial-page');
          // Either progress changed (new trial) or we left trial page (demographics)
          return !trialPage || trialPage.classList.contains('hidden') ||
                 (progressEl && progressEl.textContent !== prevProgress);
        },
        { timeout: 5000 },
        currentProgress
      );

      // Small additional delay for any animations
      await delay(100);

      validationResults.trialsCompleted++;
    }

    console.log(`  Completed ${trialNum - 1} trials`);

    // Demographics page
    await page.waitForSelector('#demographics-page:not(.hidden)', { timeout: 10000 });
    await screenshot(page, 'demographics');

    // Fill demographics
    console.log('  Filling demographics...');
    await page.type('#age-input', '30');
    await page.select('#gender-select', 'prefer-not');

    // Wait for button to enable
    await delay(200);

    // Submit demographics
    await page.click('#demographics-submit-btn');

    // Wait for completion page
    await page.waitForSelector('#complete-page:not(.hidden)', { timeout: 10000 });
    await screenshot(page, 'completion');

    console.log('  Survey completed!');

    // Save observed trials
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'observed-trials.json'),
      JSON.stringify(observedTrials, null, 2)
    );

  } finally {
    await browser.close();
  }
}

/**
 * Export and validate data
 */
async function validateExport() {
  console.log('\n=== Phase 3: Validating Export ===');

  try {
    const exportUrl = `${BASE_URL}/api/export?key=${API_KEY}`;
    console.log(`  Fetching: ${exportUrl}`);

    const response = await fetch(exportUrl);
    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }

    const csvText = await response.text();

    // Save CSV
    fs.writeFileSync(path.join(OUTPUT_DIR, 'exported_data.csv'), csvText);
    console.log('  Saved exported_data.csv');

    // Parse CSV (handles quoted fields)
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
      console.log('  No data rows in export (might be first test)');
      return;
    }

    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(line => {
      const values = parseCSVLine(line);
      const row = {};
      headers.forEach((h, i) => row[h] = values[i]);
      return row;
    });

    // Find the most recent session's trials (last N rows where N = trialsCompleted)
    const recentRows = rows.slice(-validationResults.trialsCompleted);

    console.log(`  Found ${rows.length} total rows, checking last ${recentRows.length}`);

    // Validate each trial
    for (let i = 0; i < recentRows.length && i < observedTrials.length; i++) {
      const row = recentRows[i];
      const observed = observedTrials[i];

      const validation = {
        trialNumber: i + 1,
        checks: []
      };

      // Check pair_id format (should be alphabetically sorted)
      const expPairId = observed.isCatchTrial
        ? `${observed.leftProductId}_${observed.leftProductId}`
        : expectedPairId(observed.leftProductId, observed.rightProductId);

      validation.checks.push({
        check: 'pair_id',
        passed: row.pair_id === expPairId,
        expected: expPairId,
        observed: row.pair_id
      });

      // Check position
      validation.checks.push({
        check: 'position',
        passed: row.position === observed.expectedPosition,
        expected: observed.expectedPosition,
        observed: row.position
      });

      // Check left_product_id
      validation.checks.push({
        check: 'left_product_id',
        passed: row.left_product_id === observed.leftProductId,
        expected: observed.leftProductId,
        observed: row.left_product_id
      });

      // Check right_product_id
      validation.checks.push({
        check: 'right_product_id',
        passed: row.right_product_id === observed.rightProductId,
        expected: observed.rightProductId,
        observed: row.right_product_id
      });

      // Check rating
      validation.checks.push({
        check: 'rating',
        passed: parseInt(row.rating) === observed.sliderValue,
        expected: observed.sliderValue,
        observed: parseInt(row.rating)
      });

      // Check is_catch_trial
      const expectedCatch = observed.isCatchTrial ? 'true' : 'false';
      validation.checks.push({
        check: 'is_catch_trial',
        passed: row.is_catch_trial === expectedCatch,
        expected: expectedCatch,
        observed: row.is_catch_trial
      });

      validationResults.exportValidations.push(validation);
    }

  } catch (error) {
    validationResults.errors.push(`Export validation error: ${error.message}`);
    console.error(`  ERROR: ${error.message}`);
  }
}

/**
 * Generate validation reports
 */
function generateReports() {
  console.log('\n=== Phase 4: Generating Reports ===');

  // Count passed/failed checks
  let passed = 0;
  let failed = 0;

  // Trial validations
  for (const trial of validationResults.trialValidations) {
    for (const product of [trial.leftProduct, trial.rightProduct]) {
      for (const check of product.checks) {
        if (check.passed) passed++;
        else failed++;
      }
    }
  }

  // Export validations
  for (const trial of validationResults.exportValidations) {
    for (const check of trial.checks) {
      if (check.passed) passed++;
      else failed++;
    }
  }

  validationResults.passed = passed;
  validationResults.failed = failed;
  validationResults.summary = `${passed} passed, ${failed} failed, ${validationResults.errors.length} errors`;

  // Save JSON report
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'report.json'),
    JSON.stringify(validationResults, null, 2)
  );

  // Generate text report
  let report = [];
  report.push('='.repeat(60));
  report.push('SIMILARITY EXPERIMENT - VALIDATION REPORT');
  report.push('='.repeat(60));
  report.push('');
  report.push(`Timestamp: ${validationResults.timestamp}`);
  report.push(`Base URL: ${validationResults.baseUrl}`);
  report.push(`Stimuli URL: ${validationResults.stimuliUrl}`);
  report.push('');
  report.push('-'.repeat(60));
  report.push('SUMMARY');
  report.push('-'.repeat(60));
  report.push(`Trials Completed: ${validationResults.trialsCompleted}`);
  report.push(`Checks Passed: ${passed}`);
  report.push(`Checks Failed: ${failed}`);
  report.push(`Errors: ${validationResults.errors.length}`);
  report.push('');

  if (failed > 0) {
    report.push('-'.repeat(60));
    report.push('FAILED CHECKS');
    report.push('-'.repeat(60));

    // Trial validation failures
    for (const trial of validationResults.trialValidations) {
      for (const product of [trial.leftProduct, trial.rightProduct]) {
        for (const check of product.checks) {
          if (!check.passed) {
            report.push(`Trial ${trial.trialNumber} - ${product.side} - ${check.check}:`);
            report.push(`  Expected: ${check.expected}`);
            report.push(`  Observed: ${check.observed}`);
            report.push('');
          }
        }
      }
    }

    // Export validation failures
    for (const trial of validationResults.exportValidations) {
      for (const check of trial.checks) {
        if (!check.passed) {
          report.push(`Export Trial ${trial.trialNumber} - ${check.check}:`);
          report.push(`  Expected: ${check.expected}`);
          report.push(`  Observed: ${check.observed}`);
          report.push('');
        }
      }
    }
  }

  if (validationResults.errors.length > 0) {
    report.push('-'.repeat(60));
    report.push('ERRORS');
    report.push('-'.repeat(60));
    for (const error of validationResults.errors) {
      report.push(`- ${error}`);
    }
    report.push('');
  }

  report.push('-'.repeat(60));
  report.push('CATCH TRIALS');
  report.push('-'.repeat(60));
  const catchTrials = observedTrials.filter(t => t.isCatchTrial);
  if (catchTrials.length > 0) {
    for (const trial of catchTrials) {
      report.push(`Trial ${trial.trialNumber}: ${trial.leftProductId} (identical products)`);
    }
  } else {
    report.push('No catch trials detected (unexpected)');
  }
  report.push('');

  report.push('-'.repeat(60));
  report.push('OUTPUT FILES');
  report.push('-'.repeat(60));
  report.push(`- consent.png`);
  report.push(`- screening.png`);
  report.push(`- instructions.png`);
  for (let i = 1; i <= validationResults.trialsCompleted; i++) {
    report.push(`- trial-${String(i).padStart(2, '0')}.png`);
  }
  report.push(`- demographics.png`);
  report.push(`- completion.png`);
  report.push(`- stimuli-snapshot.json`);
  report.push(`- observed-trials.json`);
  report.push(`- exported_data.csv`);
  report.push(`- report.json`);
  report.push(`- report.txt`);
  report.push('');
  report.push('='.repeat(60));

  const reportText = report.join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.txt'), reportText);

  // Print to console
  console.log('');
  console.log(reportText);
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('SIMILARITY EXPERIMENT - END-TO-END VALIDATION');
  console.log('='.repeat(60));
  console.log(`URL: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY}`);

  setupOutputDir();

  try {
    await fetchStimuli();
    await runSurvey();
    await validateExport();
    generateReports();

    // Exit with appropriate code
    process.exit(validationResults.failed > 0 || validationResults.errors.length > 0 ? 1 : 0);

  } catch (error) {
    console.error(`\nFATAL ERROR: ${error.message}`);
    validationResults.errors.push(`Fatal: ${error.message}`);
    generateReports();
    process.exit(1);
  }
}

main();
