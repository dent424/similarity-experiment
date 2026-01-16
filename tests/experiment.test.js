import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Test configuration
const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;
const N_PAIRS = 10; // Must match config.js

// Simple test framework
let testResults = { passed: 0, failed: 0, tests: [] };

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name, fn) {
  try {
    await fn();
    testResults.passed++;
    testResults.tests.push({ name, passed: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    testResults.failed++;
    testResults.tests.push({ name, passed: false, error: error.message });
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
  }
}

function describe(name) {
  console.log(`\n${name}`);
}

// Simple static file server
function createServer() {
  return http.createServer((req, res) => {
    let filePath = path.join(PROJECT_ROOT, req.url === '/' ? 'index.html' : req.url);

    const extname = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
    };

    const contentType = contentTypes[extname] || 'text/plain';

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code === 'ENOENT') {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          res.writeHead(500);
          res.end('Server Error');
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
}

// Helper to wait
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to move slider using JavaScript (more reliable than mouse clicks)
async function moveSlider(page, targetValue = 75) {
  await page.evaluate((val) => {
    const slider = document.getElementById('similarity-slider');
    slider.value = val;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, targetValue);
  await delay(50);
}

// Helper to complete a full trial
async function completeTrial(page, rating = 75) {
  await moveSlider(page, rating);
  await page.click('#next-btn');
  await delay(100);
}

// Helper to create a fresh page with cleared localStorage
async function createFreshPage(browser) {
  const page = await browser.newPage();
  // Clear localStorage before navigating
  await page.evaluateOnNewDocument(() => {
    localStorage.removeItem('similarity_experiment_completed');
  });
  return page;
}

// Main test runner
async function runTests() {
  console.log('Starting Similarity Experiment Test Suite\n');
  console.log('='.repeat(50));

  // Start server
  const server = createServer();
  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(`\nTest server running on ${BASE_URL}`);

  let browser;

  try {
    browser = await puppeteer.launch({ headless: 'new' });

    // =========================================
    // PAGE FLOW TESTS
    // =========================================
    describe('Page Flow');

    await test('loads consent page correctly', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      const consentVisible = await page.$eval('#consent-page', el => !el.classList.contains('hidden'));
      assert(consentVisible, 'Consent page should be visible');

      const consentBtn = await page.$('#consent-btn');
      assert(consentBtn, 'Consent button should exist');

      await page.close();
    });

    await test('navigates from consent to instructions', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);

      const instructionsVisible = await page.$eval('#instructions-page', el => !el.classList.contains('hidden'));
      assert(instructionsVisible, 'Instructions page should be visible');

      const consentHidden = await page.$eval('#consent-page', el => el.classList.contains('hidden'));
      assert(consentHidden, 'Consent page should be hidden');

      await page.close();
    });

    await test('navigates from instructions to first trial', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      const trialVisible = await page.$eval('#trial-page', el => !el.classList.contains('hidden'));
      assert(trialVisible, 'Trial page should be visible');

      const progressText = await page.$eval('#progress-text', el => el.textContent);
      assert(progressText === 'Pair 1 of 10', `Progress should show "Pair 1 of 10", got "${progressText}"`);

      await page.close();
    });

    await test('completes all 10 trials and shows completion page', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      // Navigate to trials
      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Complete all trials
      for (let i = 0; i < N_PAIRS; i++) {
        await completeTrial(page, 50 + i * 5);
      }

      await delay(200);

      const completeVisible = await page.$eval('#complete-page', el => !el.classList.contains('hidden'));
      assert(completeVisible, 'Completion page should be visible');

      await page.close();
    });

    // =========================================
    // DATA INTEGRITY TESTS
    // =========================================
    describe('Data Integrity');

    await test('no self-comparisons across all trials', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      for (let i = 0; i < N_PAIRS; i++) {
        const leftName = await page.$eval('#product-left-name', el => el.textContent);
        const rightName = await page.$eval('#product-right-name', el => el.textContent);

        assert(leftName !== rightName, `Trial ${i + 1}: Left and right products should be different`);

        await completeTrial(page);
      }

      await page.close();
    });

    await test('pair IDs are alphabetically sorted', async () => {
      const page = await createFreshPage(browser);

      // Intercept console logs to capture redirect params
      const consoleLogs = [];
      page.on('console', msg => consoleLogs.push(msg.text()));

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Complete all trials
      for (let i = 0; i < N_PAIRS; i++) {
        await completeTrial(page);
      }

      await delay(500);

      // Find the params log
      const paramsLog = consoleLogs.find(log => log.includes('Would redirect with params:'));
      assert(paramsLog, 'Should log redirect params in test mode');

      // Extract pair IDs and verify alphabetical ordering
      const paramsStr = paramsLog.replace('Would redirect with params: ', '');
      const params = new URLSearchParams(paramsStr);

      for (let i = 1; i <= N_PAIRS; i++) {
        const pairId = params.get(`pair_${i}`);
        assert(pairId, `pair_${i} should exist`);

        const [idA, idB] = pairId.split('_');
        assert(idA < idB, `Pair ${i}: IDs should be alphabetically sorted (${idA} < ${idB})`);
      }

      await page.close();
    });

    await test('position tracking is AB or BA', async () => {
      const page = await createFreshPage(browser);

      const consoleLogs = [];
      page.on('console', msg => consoleLogs.push(msg.text()));

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      for (let i = 0; i < N_PAIRS; i++) {
        await completeTrial(page);
      }

      await delay(500);

      const paramsLog = consoleLogs.find(log => log.includes('Would redirect with params:'));
      const paramsStr = paramsLog.replace('Would redirect with params: ', '');
      const params = new URLSearchParams(paramsStr);

      for (let i = 1; i <= N_PAIRS; i++) {
        const pos = params.get(`pos_${i}`);
        assert(pos === 'AB' || pos === 'BA', `pos_${i} should be AB or BA, got "${pos}"`);
      }

      await page.close();
    });

    await test('all 10 pairs are unique', async () => {
      const page = await createFreshPage(browser);

      const consoleLogs = [];
      page.on('console', msg => consoleLogs.push(msg.text()));

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      for (let i = 0; i < N_PAIRS; i++) {
        await completeTrial(page);
      }

      await delay(500);

      const paramsLog = consoleLogs.find(log => log.includes('Would redirect with params:'));
      const paramsStr = paramsLog.replace('Would redirect with params: ', '');
      const params = new URLSearchParams(paramsStr);

      const pairIds = new Set();
      for (let i = 1; i <= N_PAIRS; i++) {
        const pairId = params.get(`pair_${i}`);
        assert(!pairIds.has(pairId), `Duplicate pair found: ${pairId}`);
        pairIds.add(pairId);
      }

      assert(pairIds.size === N_PAIRS, `Should have ${N_PAIRS} unique pairs`);

      await page.close();
    });

    await test('ratings are recorded correctly', async () => {
      const page = await createFreshPage(browser);

      const consoleLogs = [];
      page.on('console', msg => consoleLogs.push(msg.text()));

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Use specific ratings
      const expectedRatings = [10, 25, 40, 55, 70, 85, 90, 15, 50, 75];
      for (let i = 0; i < N_PAIRS; i++) {
        await completeTrial(page, expectedRatings[i]);
      }

      await delay(500);

      const paramsLog = consoleLogs.find(log => log.includes('Would redirect with params:'));
      const paramsStr = paramsLog.replace('Would redirect with params: ', '');
      const params = new URLSearchParams(paramsStr);

      for (let i = 1; i <= N_PAIRS; i++) {
        const rating = params.get(`rating_${i}`);
        assert(rating !== null, `rating_${i} should exist`);
        const ratingNum = parseInt(rating);
        assert(ratingNum >= 0 && ratingNum <= 100, `rating_${i} should be 0-100, got ${ratingNum}`);
      }

      await page.close();
    });

    await test('duration_ms is recorded', async () => {
      const page = await createFreshPage(browser);

      const consoleLogs = [];
      page.on('console', msg => consoleLogs.push(msg.text()));

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      for (let i = 0; i < N_PAIRS; i++) {
        await completeTrial(page);
      }

      await delay(500);

      const paramsLog = consoleLogs.find(log => log.includes('Would redirect with params:'));
      const paramsStr = paramsLog.replace('Would redirect with params: ', '');
      const params = new URLSearchParams(paramsStr);

      const duration = params.get('duration_ms');
      assert(duration !== null, 'duration_ms should exist');

      const durationNum = parseInt(duration);
      assert(durationNum > 0, `duration_ms should be positive, got ${durationNum}`);

      await page.close();
    });

    // =========================================
    // UI ELEMENTS TESTS
    // =========================================
    describe('UI Elements');

    await test('product images have valid src paths', async () => {
      const page = await createFreshPage(browser);

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(200);

      // Check first trial images loaded
      const leftImgSrc = await page.$eval('#product-left-img', el => el.src);
      const rightImgSrc = await page.$eval('#product-right-img', el => el.src);

      assert(leftImgSrc.includes('.png'), 'Left image src should be set');
      assert(rightImgSrc.includes('.png'), 'Right image src should be set');

      await page.close();
    });

    await test('slider updates displayed value', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Initial value should be 50
      let displayedValue = await page.$eval('#slider-value', el => el.textContent);
      assert(displayedValue === '50', `Initial value should be 50, got ${displayedValue}`);

      // Move slider
      await moveSlider(page, 25);
      await delay(100);

      displayedValue = await page.$eval('#slider-value', el => el.textContent);
      const value = parseInt(displayedValue);
      assert(value >= 15 && value <= 35, `After moving to 25%, value should be ~25, got ${value}`);

      await page.close();
    });

    await test('progress counter updates each trial', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      for (let i = 1; i <= 5; i++) {
        const progressText = await page.$eval('#progress-text', el => el.textContent);
        assert(progressText === `Pair ${i} of 10`, `Progress should show "Pair ${i} of 10", got "${progressText}"`);
        await completeTrial(page);
      }

      await page.close();
    });

    await test('product names and prices are displayed', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      const leftName = await page.$eval('#product-left-name', el => el.textContent);
      const rightName = await page.$eval('#product-right-name', el => el.textContent);
      const leftPrice = await page.$eval('#product-left-price', el => el.textContent);
      const rightPrice = await page.$eval('#product-right-price', el => el.textContent);

      assert(leftName.length > 0, 'Left product name should be displayed');
      assert(rightName.length > 0, 'Right product name should be displayed');
      assert(leftPrice.length > 0, 'Left product price should be displayed');
      assert(rightPrice.length > 0, 'Right product price should be displayed');

      await page.close();
    });

    // =========================================
    // SURVEY ENFORCEMENT TESTS
    // =========================================
    describe('Survey Enforcement');

    await test('Next button is disabled until slider is moved', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Check button is initially disabled
      const isDisabled = await page.$eval('#next-btn', el => el.disabled);
      assert(isDisabled === true, 'Next button should be disabled initially');

      // Move slider
      await moveSlider(page, 60);
      await delay(100);

      // Check button is now enabled
      const isEnabled = await page.$eval('#next-btn', el => !el.disabled);
      assert(isEnabled === true, 'Next button should be enabled after moving slider');

      await page.close();
    });

    await test('Next button is disabled again on new trial', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Complete first trial
      await completeTrial(page);

      // Check button is disabled on second trial
      const isDisabled = await page.$eval('#next-btn', el => el.disabled);
      assert(isDisabled === true, 'Next button should be disabled on new trial');

      await page.close();
    });

    await test('cannot proceed without moving slider (button click has no effect)', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Try to click disabled button (using evaluate to force click even if disabled)
      await page.evaluate(() => {
        document.getElementById('next-btn').click();
      });
      await delay(100);

      // Should still be on trial 1
      const progressText = await page.$eval('#progress-text', el => el.textContent);
      assert(progressText === 'Pair 1 of 10', 'Should still be on Pair 1 after clicking disabled button');

      await page.close();
    });

    await test('back button does not return to previous trial', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Complete first trial
      await completeTrial(page);

      // Verify we're on trial 2
      let progressText = await page.$eval('#progress-text', el => el.textContent);
      assert(progressText === 'Pair 2 of 10', 'Should be on Pair 2');

      // Try to go back
      await page.goBack();
      await delay(300);

      // Should still be on trial 2 (or trial page visible)
      const trialVisible = await page.$eval('#trial-page', el => !el.classList.contains('hidden'));
      assert(trialVisible, 'Trial page should still be visible after back button');

      progressText = await page.$eval('#progress-text', el => el.textContent);
      assert(progressText === 'Pair 2 of 10', 'Should still be on Pair 2 after back button');

      await page.close();
    });

    await test('slider at extreme values (0 and 100) works', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Move to 0
      await moveSlider(page, 0);
      await delay(100);

      let value = await page.$eval('#slider-value', el => parseInt(el.textContent));
      assert(value <= 10, `Slider at 0 should show ~0, got ${value}`);

      let isEnabled = await page.$eval('#next-btn', el => !el.disabled);
      assert(isEnabled, 'Next button should be enabled at value 0');

      await page.click('#next-btn');
      await delay(100);

      // Move to 100
      await moveSlider(page, 100);
      await delay(100);

      value = await page.$eval('#slider-value', el => parseInt(el.textContent));
      assert(value >= 90, `Slider at 100 should show ~100, got ${value}`);

      isEnabled = await page.$eval('#next-btn', el => !el.disabled);
      assert(isEnabled, 'Next button should be enabled at value 100');

      await page.close();
    });

    // =========================================
    // URL PARAMS FORMAT TEST
    // =========================================
    describe('URL Params Format');

    await test('redirect URL contains all required parameters', async () => {
      const page = await createFreshPage(browser);

      const consoleLogs = [];
      page.on('console', msg => consoleLogs.push(msg.text()));

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      for (let i = 0; i < N_PAIRS; i++) {
        await completeTrial(page, 30 + i * 7);
      }

      await delay(500);

      const paramsLog = consoleLogs.find(log => log.includes('Would redirect with params:'));
      assert(paramsLog, 'Should log redirect params');

      const paramsStr = paramsLog.replace('Would redirect with params: ', '');
      const params = new URLSearchParams(paramsStr);

      // Check all required params exist
      for (let i = 1; i <= N_PAIRS; i++) {
        assert(params.has(`pair_${i}`), `Missing pair_${i}`);
        assert(params.has(`pos_${i}`), `Missing pos_${i}`);
        assert(params.has(`rating_${i}`), `Missing rating_${i}`);
      }
      assert(params.has('duration_ms'), 'Missing duration_ms');

      await page.close();
    });

    // =========================================
    // CONSENT AND REPEAT VISIT TESTS
    // =========================================
    describe('Consent and Repeat Visit');

    await test('clicking No Consent shows no-consent page', async () => {
      const page = await createFreshPage(browser);
      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      // Click the no consent button
      await page.click('#no-consent-btn');
      await delay(100);

      const noConsentVisible = await page.$eval('#no-consent-page', el => !el.classList.contains('hidden'));
      assert(noConsentVisible, 'No consent page should be visible');

      const consentHidden = await page.$eval('#consent-page', el => el.classList.contains('hidden'));
      assert(consentHidden, 'Consent page should be hidden');

      await page.close();
    });

    await test('repeat visit shows already-completed page', async () => {
      const page = await browser.newPage();

      // Set localStorage before navigating
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('similarity_experiment_completed', 'true');
      });

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      const alreadyCompletedVisible = await page.$eval('#already-completed-page', el => !el.classList.contains('hidden'));
      assert(alreadyCompletedVisible, 'Already completed page should be visible');

      const consentHidden = await page.$eval('#consent-page', el => el.classList.contains('hidden'));
      assert(consentHidden, 'Consent page should be hidden');

      await page.close();
    });

    await test('completing study sets localStorage flag', async () => {
      const page = await browser.newPage();

      // Clear localStorage before test
      await page.evaluateOnNewDocument(() => {
        localStorage.removeItem('similarity_experiment_completed');
      });

      await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

      await page.click('#consent-btn');
      await delay(100);
      await page.click('#start-btn');
      await delay(100);

      // Complete all trials
      for (let i = 0; i < N_PAIRS; i++) {
        await completeTrial(page);
      }

      await delay(300);

      // Check localStorage was set
      const isCompleted = await page.evaluate(() => {
        return localStorage.getItem('similarity_experiment_completed') === 'true';
      });

      assert(isCompleted, 'localStorage should be set to completed after finishing');

      await page.close();
    });

  } catch (error) {
    console.error('\nTest suite error:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
    }
    server.close();
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('\nTest Summary:');
  console.log(`  Passed: ${testResults.passed}`);
  console.log(`  Failed: ${testResults.failed}`);
  console.log(`  Total:  ${testResults.passed + testResults.failed}`);

  if (testResults.failed > 0) {
    console.log('\nFailed tests:');
    testResults.tests
      .filter(t => !t.passed)
      .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
    process.exit(1);
  } else {
    console.log('\nAll tests passed!');
    process.exit(0);
  }
}

// Run tests
runTests();
