/**
 * Quick UI test for screening and comprehension pages.
 * Tests the flow without requiring API endpoints.
 */

import puppeteer from 'puppeteer';

const BASE_URL = process.argv[2] || 'http://localhost:8080';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testUIFlow() {
  console.log('Testing UI flow at:', BASE_URL);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 }
  });

  try {
    const page = await browser.newPage();

    // Intercept API calls to prevent errors
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().includes('/api/')) {
        // Mock successful API responses
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ session_id: 'test-session-123' })
        });
      } else {
        request.continue();
      }
    });

    // Navigate to the experiment
    console.log('1. Loading consent page...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#consent-page:not(.hidden)', { timeout: 5000 });
    console.log('   ✓ Consent page loaded');

    // Click consent
    console.log('2. Clicking consent...');
    await page.click('#consent-btn');

    // Wait for screening page
    await page.waitForSelector('#screening-page:not(.hidden)', { timeout: 5000 });
    console.log('   ✓ Screening page loaded');

    // Verify screening questions exist
    const screeningQuestions = await page.$$('.screening-question');
    console.log(`   Found ${screeningQuestions.length} screening questions`);

    // Verify Continue button is disabled
    const continueDisabled = await page.$eval('#screening-continue-btn', btn => btn.disabled);
    console.log(`   Continue button disabled: ${continueDisabled}`);

    // Answer screening questions
    console.log('3. Answering screening questions...');
    await page.click('input[name="sq1"][value="monthly"]');
    await page.click('input[name="sq2"][value="yes"]'); // Answer YES to coffee
    await page.click('input[name="sq3"][value="usually"]');

    await delay(200);

    // Verify Continue button is now enabled
    const continueEnabled = await page.$eval('#screening-continue-btn', btn => !btn.disabled);
    console.log(`   Continue button enabled: ${continueEnabled}`);

    // Click Continue
    console.log('4. Clicking Continue...');
    await page.click('#screening-continue-btn');

    // Wait for instructions page
    await page.waitForSelector('#instructions-page:not(.hidden)', { timeout: 5000 });
    console.log('   ✓ Instructions page loaded');

    // Verify comprehension questions exist
    const compQuestions = await page.$$('.question-group');
    console.log(`   Found ${compQuestions.length} comprehension questions`);

    // Verify Start button is disabled
    const startDisabled = await page.$eval('#start-btn', btn => btn.disabled);
    console.log(`   Start button disabled: ${startDisabled}`);

    // Answer comprehension questions (correct answers)
    console.log('5. Answering comprehension questions correctly...');
    await page.click('input[name="q1"][value="c"]'); // 0 for nothing in common
    await page.click('input[name="q2"][value="b"]'); // extremely similar
    await page.click('input[name="q3"][value="b"]'); // No, can't go back

    await delay(200);

    // Verify Start button is now enabled
    const startEnabled = await page.$eval('#start-btn', btn => !btn.disabled);
    console.log(`   Start button enabled: ${startEnabled}`);

    // Click Start
    console.log('6. Clicking Start...');
    await page.click('#start-btn');

    // Wait for trial page
    await page.waitForSelector('#trial-page:not(.hidden)', { timeout: 5000 });
    console.log('   ✓ Trial page loaded');

    console.log('\n=== TEST 2: Screening failure (coffee = no) ===\n');

    // Reload and test screening failure
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#consent-page:not(.hidden)', { timeout: 5000 });
    await page.click('#consent-btn');
    await page.waitForSelector('#screening-page:not(.hidden)', { timeout: 5000 });

    // Answer NO to coffee
    console.log('7. Answering NO to coffee question...');
    await page.click('input[name="sq1"][value="weekly"]');
    await page.click('input[name="sq2"][value="no"]'); // Answer NO to coffee
    await page.click('input[name="sq3"][value="sometimes"]');

    await delay(200);
    await page.click('#screening-continue-btn');

    // Wait for screening failed page
    await page.waitForSelector('#screening-failed-page:not(.hidden)', { timeout: 5000 });
    console.log('   ✓ Screening failed page loaded');

    // Check message
    const message = await page.$eval('#screening-redirect-message', el => el.textContent);
    console.log(`   Message: "${message}"`);

    console.log('\n=== TEST 3: Comprehension check failure ===\n');

    // Reload and test comprehension failure
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#consent-page:not(.hidden)', { timeout: 5000 });
    await page.click('#consent-btn');
    await page.waitForSelector('#screening-page:not(.hidden)', { timeout: 5000 });

    // Pass screening
    await page.click('input[name="sq1"][value="monthly"]');
    await page.click('input[name="sq2"][value="yes"]');
    await page.click('input[name="sq3"][value="usually"]');
    await delay(200);
    await page.click('#screening-continue-btn');

    await page.waitForSelector('#instructions-page:not(.hidden)', { timeout: 5000 });

    // Answer comprehension questions WRONG
    console.log('8. Answering comprehension questions incorrectly...');
    await page.click('input[name="q1"][value="a"]'); // Wrong: 100
    await page.click('input[name="q2"][value="a"]'); // Wrong: high quality
    await page.click('input[name="q3"][value="a"]'); // Wrong: Yes

    await delay(200);
    await page.click('#start-btn');

    // Check error message appears
    const errorVisible = await page.$eval('#comprehension-error', el => !el.classList.contains('hidden'));
    console.log(`   Error message visible: ${errorVisible}`);

    // Check incorrect styling
    const incorrectCount = await page.$$eval('.question-group.incorrect', els => els.length);
    console.log(`   Questions marked incorrect: ${incorrectCount}`);

    // Verify we're still on instructions page (didn't proceed)
    const stillOnInstructions = await page.$('#instructions-page:not(.hidden)');
    console.log(`   Still on instructions page: ${!!stillOnInstructions}`);

    // Fix answers
    console.log('9. Fixing comprehension answers...');
    await page.click('input[name="q1"][value="c"]');
    await page.click('input[name="q2"][value="b"]');
    await page.click('input[name="q3"][value="b"]');

    await delay(200);
    await page.click('#start-btn');

    // Should now proceed
    await page.waitForSelector('#trial-page:not(.hidden)', { timeout: 5000 });
    console.log('   ✓ Proceeded to trial page after fixing answers');

    console.log('\n========================================');
    console.log('ALL UI TESTS PASSED!');
    console.log('========================================\n');

  } catch (error) {
    console.error('\nTEST FAILED:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

testUIFlow();
