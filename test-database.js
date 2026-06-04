/**
 * Database Test: Full Experiment Flow via Browser Automation
 *
 * Tests that all data is correctly saved to the Neon Postgres database:
 * - Session creation
 * - Trial responses (11 total: 10 pairs + 1 catch trial)
 * - Demographics
 * - Completion
 */

import puppeteer from 'puppeteer';

import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://similarity-experiment.vercel.app';
const EXPORT_API_KEY = 'my-secret-export-key-change-me';
const SCREENSHOT_DIR = './test-screenshots';

// Test configuration
const TEST_CONFIG = {
  age: 25,
  gender: 'male',
  sliderValues: [10, 25, 40, 55, 70, 85, 95, 30, 60, 80, 50] // 11 values for 11 trials
};

// Create screenshot directory
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runExperiment() {
  console.log('=== DATABASE TEST: Full Experiment Flow ===\n');
  console.log(`Testing URL: ${BASE_URL}`);
  console.log(`Export API Key: ${EXPORT_API_KEY.substring(0, 10)}...`);

  const browser = await puppeteer.launch({
    headless: false, // Set to true for headless mode
    args: ['--window-size=1400,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Track test data
  const testData = {
    sessionId: null,
    trials: [],
    startTime: Date.now()
  };

  try {
    // Step 1: Navigate to experiment
    console.log('\n[1] Navigating to experiment...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await sleep(1000);

    // Step 2: Consent page - Click "I Agree"
    console.log('[2] Completing consent...');
    await page.waitForSelector('#consent-btn', { visible: true });

    // Set up network monitoring to capture session ID
    page.on('response', async (response) => {
      if (response.url().includes('/api/session') && response.request().method() === 'POST') {
        try {
          const data = await response.json();
          if (data.session_id) {
            testData.sessionId = data.session_id;
            console.log(`   Session created: ${data.session_id}`);
          }
        } catch (e) {}
      }
    });

    await page.click('#consent-btn');
    await sleep(1500); // Wait for session creation

    // Step 3: Instructions page - Click "Start"
    console.log('[3] Starting experiment...');
    await page.waitForSelector('#start-btn', { visible: true });
    await page.click('#start-btn');
    await sleep(500);

    // Step 4: Complete all trials
    console.log('[4] Completing trials...');

    for (let i = 0; i < TEST_CONFIG.sliderValues.length; i++) {
      const sliderValue = TEST_CONFIG.sliderValues[i];

      // Wait for trial page to be visible
      await page.waitForSelector('#trial-page:not(.hidden)', { visible: true });

      // Get product names for this trial
      const leftName = await page.$eval('#product-left-name', el => el.textContent);
      const rightName = await page.$eval('#product-right-name', el => el.textContent);

      console.log(`   Trial ${i + 1}/11: "${leftName.substring(0, 30)}..." vs "${rightName.substring(0, 30)}..."`);

      // Move the slider using mouse interaction
      const sliderElement = await page.$('#similarity-slider');
      const sliderBox = await sliderElement.boundingBox();

      // First click at a different position (0) to ensure an input event fires
      // This is needed because if target=50 and default=50, no change would occur
      const resetX = sliderBox.x + 5; // Click near left edge (value ~0)
      const targetY = sliderBox.y + sliderBox.height / 2;
      await page.mouse.click(resetX, targetY);
      await sleep(100);

      // Now click at the target position
      const targetX = sliderBox.x + (sliderValue / 100) * sliderBox.width;
      await page.mouse.click(targetX, targetY);
      await sleep(200);

      // Verify the value was set
      const actualValue = await page.$eval('#slider-value', el => el.textContent);
      console.log(`           Rating: ${actualValue} (target: ${sliderValue})`);

      // Get product IDs for filename
      const leftId = await page.$eval('#product-left-img', el => {
        const src = el.src;
        const match = src.match(/([A-Z0-9]+)\.png/);
        return match ? match[1] : 'unknown';
      });
      const rightId = await page.$eval('#product-right-img', el => {
        const src = el.src;
        const match = src.match(/([A-Z0-9]+)\.png/);
        return match ? match[1] : 'unknown';
      });

      // Save screenshot with trial info
      const screenshotName = `trial-${String(i + 1).padStart(2, '0')}_${leftId}_vs_${rightId}_rating-${actualValue}.png`;
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${screenshotName}`,
        fullPage: false
      });
      console.log(`           Screenshot: ${screenshotName}`);

      // Click Next
      await page.waitForSelector('#next-btn:not([disabled])', { visible: true });
      await page.click('#next-btn');

      testData.trials.push({
        trialNumber: i + 1,
        leftProduct: leftName,
        rightProduct: rightName,
        leftId: leftId,
        rightId: rightId,
        rating: parseInt(actualValue),
        isCatchTrial: leftId === rightId,
        screenshot: screenshotName
      });

      // Wait for page transition
      await sleep(800);
    }

    // Step 5: Demographics page
    console.log('[5] Completing demographics...');
    await page.waitForSelector('#demographics-page:not(.hidden)', { visible: true });

    // Enter age
    await page.type('#age-input', TEST_CONFIG.age.toString());

    // Select gender
    await page.select('#gender-select', TEST_CONFIG.gender);

    await sleep(500);

    // Submit demographics
    await page.waitForSelector('#demographics-submit-btn:not([disabled])', { visible: true });
    await page.click('#demographics-submit-btn');
    await sleep(1500);

    // Step 6: Verify completion page
    console.log('[6] Verifying completion...');
    await page.waitForSelector('#complete-page:not(.hidden)', { visible: true });

    const completionText = await page.$eval('#complete-page', el => el.textContent);
    console.log(`   Completion page reached: ${completionText.includes('Thank you')}`);

    testData.endTime = Date.now();
    testData.totalDuration = testData.endTime - testData.startTime;

    console.log('\n=== EXPERIMENT COMPLETED ===');
    console.log(`Session ID: ${testData.sessionId}`);
    console.log(`Total trials: ${testData.trials.length}`);
    console.log(`Duration: ${Math.round(testData.totalDuration / 1000)}s`);

    // Save test data to JSON for comparison
    const testDataFile = `${SCREENSHOT_DIR}/test-data.json`;
    fs.writeFileSync(testDataFile, JSON.stringify(testData, null, 2));
    console.log(`\nTest data saved to: ${testDataFile}`);

    // Print summary of trials for easy review
    console.log('\n=== TRIAL SUMMARY ===');
    testData.trials.forEach(trial => {
      const catchLabel = trial.isCatchTrial ? ' [CATCH]' : '';
      console.log(`Trial ${trial.trialNumber}: ${trial.leftId} vs ${trial.rightId} = ${trial.rating}${catchLabel}`);
    });

    // Wait a moment before closing
    await sleep(2000);

  } catch (error) {
    console.error('\n!!! TEST FAILED !!!');
    console.error(error.message);

    // Take screenshot on failure
    await page.screenshot({ path: 'test-failure.png' });
    console.log('Screenshot saved to test-failure.png');
  } finally {
    await browser.close();
  }

  return testData;
}

async function verifyDatabaseData(sessionId) {
  console.log('\n=== VERIFYING DATABASE DATA ===\n');

  if (!sessionId) {
    console.log('No session ID captured. Fetching all recent data...');
  }

  try {
    const response = await fetch(`${BASE_URL}/api/export?key=${EXPORT_API_KEY}`);

    if (!response.ok) {
      console.error(`Export API error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(text);
      return null;
    }

    const csvData = await response.text();
    console.log('Export API Response (CSV):');
    console.log('---');
    console.log(csvData.substring(0, 2000) + (csvData.length > 2000 ? '\n...[truncated]' : ''));
    console.log('---');

    // Parse CSV to analyze data
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',');
    const rows = lines.slice(1).map(line => {
      const values = line.split(',');
      return headers.reduce((obj, header, i) => {
        obj[header] = values[i];
        return obj;
      }, {});
    });

    // Filter for our session if we have the ID
    const sessionRows = sessionId
      ? rows.filter(r => r.session_id === sessionId)
      : rows;

    console.log(`\nTotal rows in database: ${rows.length}`);
    console.log(`Rows for current session: ${sessionRows.length}`);

    if (sessionRows.length > 0) {
      // Analyze the data
      const uniqueSessions = [...new Set(sessionRows.map(r => r.session_id))];
      const catchTrials = sessionRows.filter(r => r.is_catch_trial === 'true');

      console.log(`\nSession details:`);
      console.log(`  Experiment: ${sessionRows[0].experiment_name}`);
      console.log(`  Age: ${sessionRows[0].age}`);
      console.log(`  Gender: ${sessionRows[0].gender}`);
      console.log(`  Completed: ${sessionRows[0].completed_at ? 'Yes' : 'No'}`);
      console.log(`  Total duration: ${sessionRows[0].total_duration_ms}ms`);

      console.log(`\nTrial analysis:`);
      console.log(`  Total trials: ${sessionRows.length}`);
      console.log(`  Catch trials: ${catchTrials.length}`);

      // Check for self-comparisons
      const selfComparisons = sessionRows.filter(r => {
        if (!r.pair_id) return false;
        const [a, b] = r.pair_id.split('_');
        return a === b && r.is_catch_trial !== 'true';
      });

      console.log(`  Invalid self-comparisons (non-catch): ${selfComparisons.length}`);

      // Check position randomization
      const positions = sessionRows.map(r => r.position);
      const abCount = positions.filter(p => p === 'AB').length;
      const baCount = positions.filter(p => p === 'BA').length;
      console.log(`  Position AB: ${abCount}, Position BA: ${baCount}`);

      // Check ratings
      const ratings = sessionRows.map(r => parseInt(r.rating)).filter(r => !isNaN(r));
      console.log(`  Rating range: ${Math.min(...ratings)} - ${Math.max(...ratings)}`);

      // Check response times
      const responseTimes = sessionRows.map(r => parseInt(r.response_time_ms)).filter(r => !isNaN(r));
      console.log(`  Response time range: ${Math.min(...responseTimes)}ms - ${Math.max(...responseTimes)}ms`);

      return { success: true, rows: sessionRows };
    }

    return { success: false, message: 'No data found for session' };

  } catch (error) {
    console.error('Failed to verify database:', error.message);
    return null;
  }
}

// Main execution
async function main() {
  console.log('Starting Database Test...\n');

  // Run the experiment
  const testData = await runExperiment();

  // Wait a bit for data to be committed
  await sleep(2000);

  // Verify the data
  const verification = await verifyDatabaseData(testData.sessionId);

  console.log('\n=== TEST SUMMARY ===');
  console.log(`Experiment completed: ${testData.trials.length === 11 ? 'YES' : 'NO'}`);
  console.log(`Session captured: ${testData.sessionId ? 'YES' : 'NO'}`);
  console.log(`Data verified: ${verification?.success ? 'YES' : 'NO'}`);
}

main().catch(console.error);
