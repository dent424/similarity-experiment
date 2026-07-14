/**
 * End-to-end Puppeteer verification for the v2 experiment flow (text-only
 * stimuli, no post-task survey, N_PAIRS regular pairs + 1 catch trial, straight
 * to demographics after trials, redirect to Prolific on completion).
 *
 * Usage: node scripts/test-v2-flow.js <baseUrl> [prolificPid]
 * Example: node scripts/test-v2-flow.js https://example.vercel.app
 *
 * This does NOT check the database — see scripts/verify-v2-session.js for
 * the DB-side spot check (session/trial rows, held-constant variants, etc.).
 *
 * This script:
 * 1. Fetches stimuli.json for the live arm named in config-v2.js and validates
 *    its shape (12 products x 20 variants), building the set of valid texts.
 * 2. Drives consent -> instructions/comprehension -> N_PAIRS + 1 catch trials ->
 *    demographics -> completion -> Prolific redirect.
 * 3. Validates every displayed trial text against the stimuli set, detects
 *    the catch trial, and checks slider/button gating along the way.
 * 4. Writes screenshots, report.json, and report.txt to
 *    test-results/v2-<timestamp>/, and exits 0 only if every check passed.
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.join(__dirname, '..');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ---- args ----
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node scripts/test-v2-flow.js <baseUrl> [prolificPid]');
  console.error('Example: node scripts/test-v2-flow.js https://example.vercel.app');
  process.exit(1);
}
const BASE_URL = args[0].replace(/\/$/, ''); // remove trailing slash
const RUN_STAMP = Date.now();
const PROLIFIC_PID = args[1] || `test-puppeteer-${RUN_STAMP}`;
const STUDY_ID = 'test-study';
const SESSION_ID_PARAM = `test-session-${RUN_STAMP}`;

// ---- expectations ----
// The arm and the trial count are READ from config-v2.js rather than restated
// here: hardcoding them means every study swap leaves this test asserting a
// retired arm's shape. EXPECTED_PRODUCTS stays explicit — it's the design claim
// under test (this arm ships 12 brands), which config doesn't know.
const CONFIG = (await import(pathToFileURL(path.join(repoDir, 'config-v2.js')).href)).default;
const EXPERIMENT_DIR = CONFIG.EXPERIMENT_NAME;
const EXPECTED_PRODUCTS = 12;
const EXPECTED_VARIANTS_PER_PRODUCT = 20;
const EXPECTED_CATCH_COUNT = CONFIG.CATCH_TRIAL ? 1 : 0;
const EXPECTED_TOTAL_TRIALS = CONFIG.N_PAIRS + EXPECTED_CATCH_COUNT;
const PROLIFIC_URL_SUBSTRING = 'app.prolific.com';
const PROLIFIC_COMPLETION_CODE = 'cc=CGLVD50R';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_DIR = path.join(repoDir, 'test-results', `v2-${timestamp}`);

const report = {
  timestamp: new Date().toISOString(),
  baseUrl: BASE_URL,
  prolificPid: PROLIFIC_PID,
  targetUrl: null,
  stimuliUrl: null,
  finalUrl: null,
  trials: [],
  catchTrialCount: 0,
  checks: [],
  errors: [],
  summary: ''
};

function check(name, passed, detail = '') {
  const ok = !!passed;
  report.checks.push({ name, passed: ok, detail: String(detail || '') });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  return ok;
}

function firstChars(s, n = 40) {
  return String(s || '').slice(0, n);
}

function setupOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

async function screenshot(page, name) {
  const filepath = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  Screenshot: ${name}.png`);
}

// Fetch and validate the stimuli set up front so trial texts displayed
// during the run can be checked against a known-good corpus.
async function fetchValidTexts() {
  report.stimuliUrl = `${BASE_URL}/stimuli/${EXPERIMENT_DIR}/stimuli.json`;
  console.log(`\n=== Phase 0: Stimuli ===`);
  console.log(`  Fetching: ${report.stimuliUrl}`);

  const res = await fetch(report.stimuliUrl);
  if (!res.ok) {
    throw new Error(`Stimuli fetch failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  const products = data.products;
  if (!Array.isArray(products) || products.length !== EXPECTED_PRODUCTS) {
    throw new Error(`Expected ${EXPECTED_PRODUCTS} products, got ${Array.isArray(products) ? products.length : typeof products}`);
  }
  const validTexts = new Set();
  for (const p of products) {
    if (!Array.isArray(p.variants) || p.variants.length !== EXPECTED_VARIANTS_PER_PRODUCT) {
      throw new Error(`Product ${p.id} has ${p.variants ? p.variants.length : 0} variants, expected ${EXPECTED_VARIANTS_PER_PRODUCT}`);
    }
    for (const v of p.variants) {
      if (typeof v.text !== 'string' || v.text.trim() === '') {
        throw new Error(`Product ${p.id} variant ${v.variant} has empty text`);
      }
      validTexts.add(v.text);
    }
  }
  const expectedTotal = EXPECTED_PRODUCTS * EXPECTED_VARIANTS_PER_PRODUCT;
  if (validTexts.size !== expectedTotal) {
    throw new Error(`Expected ${expectedTotal} unique variant texts, got ${validTexts.size}`);
  }
  console.log(`  Loaded ${products.length} products x ${EXPECTED_VARIANTS_PER_PRODUCT} variants = ${validTexts.size} valid texts`);
  return validTexts;
}

// Click consent repeatedly until the page transitions. Known quirk: the
// consent button's click listener only attaches once init() finishes
// (stimuli fetch + assign-pairs can take several seconds on a cold
// serverless deploy), so an early click can silently do nothing.
async function clickConsentUntilTransition(page, overallTimeoutMs = 30000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < overallTimeoutMs) {
    try {
      await page.click('#consent-btn');
    } catch (e) {
      lastErr = e;
    }
    try {
      await page.waitForSelector('#instructions-page:not(.hidden)', { timeout: 1000 });
      return; // transitioned
    } catch (e) {
      lastErr = e;
      // not yet transitioned — loop and retry the click
    }
  }
  throw new Error(`Consent click never transitioned to instructions page within ${overallTimeoutMs}ms${lastErr ? `: ${lastErr.message}` : ''}`);
}

// Ratings for regular (non-catch) trials: guarantee a 0 and a 100 appear
// somewhere in the run (trial order is randomized by the app, so this just
// needs to hit the first two regular trials encountered); everything else
// is random. The catch trial always gets a fixed, easy-to-spot rating.
function pickRating(regularIndex, isCatch) {
  if (isCatch) return 95;
  if (regularIndex === 0) return 0;
  if (regularIndex === 1) return 100;
  return Math.floor(Math.random() * 101);
}

async function run() {
  setupOutputDir();
  const validTexts = await fetchValidTexts();

  const targetUrl = `${BASE_URL}/?PROLIFIC_PID=${encodeURIComponent(PROLIFIC_PID)}&STUDY_ID=${encodeURIComponent(STUDY_ID)}&SESSION_ID=${encodeURIComponent(SESSION_ID_PARAM)}`;
  report.targetUrl = targetUrl;

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 }
  });

  try {
    const page = await browser.newPage();

    console.log(`\n=== Phase 1: Consent ===`);
    console.log(`  Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#consent-page:not(.hidden)', { timeout: 15000 });
    await screenshot(page, '01-consent');

    await clickConsentUntilTransition(page);
    check('consent click transitions to instructions page', true);
    await screenshot(page, '02-instructions');

    console.log(`\n=== Phase 2: Comprehension check ===`);
    const correctAnswers = await page.$$eval('#instructions-page .question-group', groups =>
      groups.map((g, i) => ({ name: `q${i + 1}`, value: g.dataset.correct }))
    );
    check('found 3 comprehension questions with data-correct answers', correctAnswers.length === 3, `found ${correctAnswers.length}`);

    for (const { name, value } of correctAnswers) {
      await page.click(`input[name="${name}"][value="${value}"]`);
    }
    await delay(200);
    const startEnabled = await page.$eval('#start-btn', btn => !btn.disabled);
    check('#start-btn enabled after answering comprehension correctly', startEnabled);

    await page.click('#start-btn');
    await page.waitForSelector('#trial-page:not(.hidden)', { timeout: 15000 });
    check('Start transitions to trial page', true);

    console.log(`\n=== Phase 3: Trials ===`);
    let trialIndex = 0;
    let regularIndex = 0;
    let catchCount = 0;
    let sawZero = false;
    let sawHundred = false;

    while (true) {
      const trialVisible = await page.$('#trial-page:not(.hidden)');
      if (!trialVisible) break;

      const progressText = await page.$eval('#progress-text', el => el.textContent);
      const expectedProgress = `Pair ${trialIndex + 1} of ${EXPECTED_TOTAL_TRIALS}`;
      check(`trial ${trialIndex + 1}: progress text is "${expectedProgress}"`, progressText === expectedProgress, `got "${progressText}"`);

      const leftText = await page.$eval('#product-left-desc', el => el.textContent);
      const rightText = await page.$eval('#product-right-desc', el => el.textContent);

      const leftValid = validTexts.has(leftText);
      const rightValid = validTexts.has(rightText);
      check(`trial ${trialIndex + 1}: left text is a valid brandvoice2 variant`, leftValid, leftValid ? '' : `unmatched text: "${firstChars(leftText)}..."`);
      check(`trial ${trialIndex + 1}: right text is a valid brandvoice2 variant`, rightValid, rightValid ? '' : `unmatched text: "${firstChars(rightText)}..."`);

      const isCatch = leftText === rightText;
      if (isCatch) catchCount++;

      const rating = pickRating(regularIndex, isCatch);
      if (!isCatch) regularIndex++;
      if (rating === 0) sawZero = true;
      if (rating === 100) sawHundred = true;

      await screenshot(page, `trial-${String(trialIndex + 1).padStart(2, '0')}`);

      await page.$eval('#similarity-slider', (el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, rating);

      const nextEnabled = await page.$eval('#next-btn', btn => !btn.disabled);
      check(`trial ${trialIndex + 1}: #next-btn enabled after moving slider`, nextEnabled);

      report.trials.push({
        trialNumber: trialIndex + 1,
        isCatchTrial: isCatch,
        rating,
        leftTextPreview: firstChars(leftText),
        rightTextPreview: firstChars(rightText),
        leftValid,
        rightValid
      });

      const prevProgress = progressText;
      await page.click('#next-btn');

      await page.waitForFunction(
        (prev) => {
          const trialPage = document.querySelector('#trial-page');
          const progressEl = document.querySelector('#progress-text');
          return !trialPage || trialPage.classList.contains('hidden') ||
                 (progressEl && progressEl.textContent !== prev);
        },
        { timeout: 10000 },
        prevProgress
      );

      trialIndex++;
      if (trialIndex > EXPECTED_TOTAL_TRIALS + 2) {
        throw new Error(`Trial loop exceeded expected count (${EXPECTED_TOTAL_TRIALS}) without reaching demographics — possible infinite loop.`);
      }
    }

    check(`exactly ${EXPECTED_TOTAL_TRIALS} trials completed`, trialIndex === EXPECTED_TOTAL_TRIALS, `completed ${trialIndex}`);
    check(`exactly ${EXPECTED_CATCH_COUNT} catch trial`, catchCount === EXPECTED_CATCH_COUNT, `saw ${catchCount}`);
    check('at least one rating of 0 was used', sawZero);
    check('at least one rating of 100 was used', sawHundred);
    report.catchTrialCount = catchCount;

    console.log(`\n=== Phase 4: Demographics (v2 has no post-task survey) ===`);
    await page.waitForSelector('#demographics-page:not(.hidden)', { timeout: 15000 });
    check('trials flow directly into demographics page (no survey)', true);
    await screenshot(page, '03-demographics');

    await page.type('#age-input', '30');
    await page.select('#gender-select', 'prefer-not');
    await delay(200);
    const submitEnabled = await page.$eval('#demographics-submit-btn', btn => !btn.disabled);
    check('#demographics-submit-btn enabled after filling age + gender', submitEnabled);

    await page.click('#demographics-submit-btn');

    console.log(`\n=== Phase 5: Completion + Prolific redirect ===`);
    await page.waitForSelector('#complete-page:not(.hidden)', { timeout: 15000 });
    check('completion page shown', true);
    await screenshot(page, '04-complete');

    // The redirect fires ~1.5s after the complete page shows (see complete()
    // in experiment-v2.js), via window.location.href — a real top-level
    // navigation. Set up the wait before it fires; tolerate the target
    // (app.prolific.com with a fake PID) being a network dead end, since
    // only the attempted URL is being asserted here.
    console.log('  Waiting for redirect to Prolific (~1.5s)...');
    const navResult = await page.waitForNavigation({ timeout: 10000, waitUntil: 'domcontentloaded' })
      .then(() => ({ ok: true }))
      .catch(e => ({ ok: false, error: e.message }));
    if (!navResult.ok) {
      console.log(`  (waitForNavigation did not resolve cleanly: ${navResult.error} — checking final URL anyway)`);
    }

    const finalUrl = page.url();
    report.finalUrl = finalUrl;
    check('redirected to app.prolific.com', finalUrl.includes(PROLIFIC_URL_SUBSTRING), finalUrl);
    check(`redirect URL contains completion code (${PROLIFIC_COMPLETION_CODE})`, finalUrl.includes(PROLIFIC_COMPLETION_CODE), finalUrl);

  } catch (e) {
    report.errors.push(e.message);
    console.error(`\nFATAL: ${e.message}`);
  } finally {
    await browser.close();
  }
}

function generateReports() {
  const passed = report.checks.filter(c => c.passed).length;
  const failed = report.checks.length - passed;
  report.summary = `${passed}/${report.checks.length} checks passed, ${report.errors.length} errors`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

  const lines = [];
  lines.push('='.repeat(60));
  lines.push('V2 EXPERIMENT FLOW - END-TO-END VERIFICATION');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Base URL: ${report.baseUrl}`);
  lines.push(`Target URL: ${report.targetUrl}`);
  lines.push(`Prolific PID (fake, unhashed): ${report.prolificPid}`);
  lines.push(`Stimuli URL: ${report.stimuliUrl}`);
  lines.push(`Final URL: ${report.finalUrl}`);
  lines.push('');
  lines.push('-'.repeat(60));
  lines.push('SUMMARY');
  lines.push('-'.repeat(60));
  lines.push(`Checks Passed: ${passed}`);
  lines.push(`Checks Failed: ${failed}`);
  lines.push(`Errors: ${report.errors.length}`);
  lines.push(`Trials recorded: ${report.trials.length}`);
  lines.push(`Catch trials seen: ${report.catchTrialCount}`);
  lines.push('');

  lines.push('-'.repeat(60));
  lines.push('TRIALS');
  lines.push('-'.repeat(60));
  for (const t of report.trials) {
    lines.push(`#${String(t.trialNumber).padStart(2)}  rating=${String(t.rating).padStart(3)}${t.isCatchTrial ? '  [CATCH]' : '         '}  valid(L/R)=${t.leftValid}/${t.rightValid}`);
    lines.push(`      L: ${t.leftTextPreview}...`);
    lines.push(`      R: ${t.rightTextPreview}...`);
  }
  lines.push('');

  if (failed > 0) {
    lines.push('-'.repeat(60));
    lines.push('FAILED CHECKS');
    lines.push('-'.repeat(60));
    for (const c of report.checks) {
      if (!c.passed) lines.push(`- ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
    }
    lines.push('');
  }

  if (report.errors.length > 0) {
    lines.push('-'.repeat(60));
    lines.push('ERRORS');
    lines.push('-'.repeat(60));
    for (const e of report.errors) lines.push(`- ${e}`);
    lines.push('');
  }

  lines.push('-'.repeat(60));
  lines.push('ALL CHECKS');
  lines.push('-'.repeat(60));
  for (const c of report.checks) {
    lines.push(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  lines.push('');
  lines.push('='.repeat(60));

  const reportText = lines.join('\n');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.txt'), reportText);

  console.log('');
  console.log(reportText);
}

async function main() {
  console.log('='.repeat(60));
  console.log('V2 EXPERIMENT FLOW - END-TO-END VERIFICATION');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Prolific PID: ${PROLIFIC_PID}`);

  try {
    await run();
  } catch (e) {
    report.errors.push(`Fatal: ${e.message}`);
    console.error(`\nFATAL ERROR: ${e.message}`);
  }

  generateReports();

  const allPassed = report.checks.length > 0 && report.checks.every(c => c.passed) && report.errors.length === 0;
  process.exit(allPassed ? 0 : 1);
}

main();
