import CONFIG from './config-v2.js';

// Adjust zoom for smaller viewports (laptops)
function adjustZoomForViewport() {
  // v2 shows text (not fixed-height images), so the image-era zoom-shrink is
  // dropped — it needlessly hurt legibility of the primary stimulus. Text
  // reflows and the page scrolls if a short viewport needs it.
  document.body.style.zoom = '100%';
}

// Apply on load and resize
adjustZoomForViewport();
window.addEventListener('resize', adjustZoomForViewport);

let products = [];
let trials = [];
let currentTrial = 0;
let results = [];
let startTime = null;
let sliderMoved = false;

// New state for database integration
let sessionId = null;
let prolificPid = null;
let studyId = null;
let sessionIdParam = null;
let trialStartTime = null;

// Background write tracking: server writes are not awaited in click handlers
// (serverless cold starts made the UI freeze for seconds) — they run in the
// background and are awaited together before the session is marked complete.
let sessionCreationPromise = null;
const pendingWrites = [];

// localStorage key for tracking completion — scoped by experiment so the
// old coffee study and this image-only study don't share a completion flag.
const COMPLETION_KEY = `similarity_experiment_completed_${CONFIG.EXPERIMENT_NAME}`;

// DOM elements
const consentPage = document.getElementById('consent-page');
const noConsentPage = document.getElementById('no-consent-page');
const alreadyCompletedPage = document.getElementById('already-completed-page');
const instructionsPage = document.getElementById('instructions-page');
const trialPage = document.getElementById('trial-page');
const demographicsPage = document.getElementById('demographics-page');
const completePage = document.getElementById('complete-page');

const consentBtn = document.getElementById('consent-btn');
const noConsentBtn = document.getElementById('no-consent-btn');
const comprehensionError = document.getElementById('comprehension-error');
const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn');
const demographicsSubmitBtn = document.getElementById('demographics-submit-btn');

const progressText = document.getElementById('progress-text');
const productLeftDesc = document.getElementById('product-left-desc');
const productRightDesc = document.getElementById('product-right-desc');
const slider = document.getElementById('similarity-slider');
const sliderValue = document.getElementById('slider-value');
const ageInput = document.getElementById('age-input');
const genderSelect = document.getElementById('gender-select');
const redirectMessage = document.getElementById('redirect-message');

// Extract URL parameters
function extractUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  prolificPid = urlParams.get('PROLIFIC_PID') || urlParams.get('prolific_pid') || null;
  studyId = urlParams.get('STUDY_ID') || urlParams.get('study_id') || null;
  sessionIdParam = urlParams.get('SESSION_ID') || urlParams.get('session_id') || null;
}

// One-way hash (SHA-256) for Prolific identifiers, so the stored values can't
// be traced back to a Prolific account — per the consent form's promise not to
// collect information that could associate participants with their responses.
// Hashing is deterministic, so the server-side repeat-participation check
// still works, and a specific PID can still be verified by hashing it.
async function hashId(id) {
  if (!id) return null;
  if (!window.crypto || !crypto.subtle) return null; // never store the raw ID
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Check if user has already completed the study (localStorage)
function hasAlreadyCompletedLocally() {
  try {
    return localStorage.getItem(COMPLETION_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

// Check if user has already completed on server
async function hasAlreadyCompletedOnServer() {
  if (!prolificPid) return false;

  try {
    const response = await fetch(`/api/session?prolific_pid=${encodeURIComponent(prolificPid)}`);
    const data = await response.json();
    return data.completed === true;
  } catch (e) {
    console.error('Failed to check session status:', e);
    return false;
  }
}

// Mark study as completed locally
function markAsCompletedLocally() {
  try {
    localStorage.setItem(COMPLETION_KEY, 'true');
  } catch (e) {
    // localStorage might be disabled
  }
}

// Create a new session on the server
async function createSession() {
  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prolific_pid: prolificPid,
        study_id: studyId,
        session_id_param: sessionIdParam,
        experiment_name: CONFIG.EXPERIMENT_NAME,
        user_agent: navigator.userAgent
      })
    });

    const data = await response.json();
    if (data.session_id) {
      sessionId = data.session_id;
      return true;
    }
    return false;
  } catch (e) {
    console.error('Failed to create session:', e);
    return false;
  }
}

// Record a trial response to the server
async function recordTrialToServer(trialData) {
  try {
    await fetch('/api/trial-v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        trial_number: trialData.trialNumber,
        pair_id: trialData.pairId,
        position: trialData.position,
        left_product_id: trialData.leftProductId,
        right_product_id: trialData.rightProductId,
        left_variant: trialData.leftVariant,
        right_variant: trialData.rightVariant,
        rating: trialData.rating,
        response_time_ms: trialData.responseTime,
        is_catch_trial: trialData.isCatchTrial
      })
    });
  } catch (e) {
    console.error('Failed to record trial:', e);
  }
}

// Save demographics to server
async function saveDemographics(age, gender) {
  try {
    await fetch('/api/demographics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        age: age,
        gender: gender
      })
    });
  } catch (e) {
    console.error('Failed to save demographics:', e);
  }
}

// Complete the session on server
async function completeSession(totalDuration) {
  try {
    const response = await fetch('/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        total_duration_ms: totalDuration
      })
    });

    const data = await response.json();
    return data.redirect_url || null;
  } catch (e) {
    console.error('Failed to complete session:', e);
    return null;
  }
}

// Initialize
async function init() {
  // Extract URL parameters first
  extractUrlParams();

  // Replace Prolific identifiers with one-way hashes before any server calls,
  // so the raw IDs never leave the participant's browser.
  prolificPid = await hashId(prolificPid);
  sessionIdParam = await hashId(sessionIdParam);

  // Check for repeat visit (server-side first, then localStorage)
  const completedOnServer = await hasAlreadyCompletedOnServer();
  if (completedOnServer || hasAlreadyCompletedLocally()) {
    showPage(alreadyCompletedPage);
    return;
  }

  // Load products — each experiment keeps its stimuli (JSON + images) in
  // its own folder: stimuli/<EXPERIMENT_NAME>/
  try {
    const response = await fetch(`./stimuli/${CONFIG.EXPERIMENT_NAME}/stimuli.json`);
    const data = await response.json();
    products = data.products;
  } catch (e) {
    console.error('Failed to load stimuli:', e);
    alert('Failed to load experiment data. Please refresh the page.');
    return;
  }

  if (products.length < 2) {
    alert('Not enough products loaded. Need at least 2 products.');
    return;
  }

  // Validate each item, then assign this participant's variant per item. Per the
  // v2 design each item gets ONE variant for the whole session (held constant),
  // drawn independently and uniformly at random. The chosen text/variant ride on
  // the product object, so every consumer (regular trials, the catch trial, and
  // the random fallback) stays consistent automatically — the same object
  // instance is reused on every recurrence.
  for (const p of products) {
    if (!p.id || /_/.test(p.id)) {
      alert('Failed to load experiment data: an item id is missing or contains "_".');
      throw new Error(`Invalid product id: ${JSON.stringify(p && p.id)}`);
    }
    if (!Array.isArray(p.variants) || p.variants.length < 1) {
      alert('Failed to load experiment data: an item has no variants.');
      throw new Error(`Product ${p.id} has no variants`);
    }
    const seen = new Set();
    for (const v of p.variants) {
      if (!Number.isInteger(v.variant) || seen.has(v.variant)) {
        alert('Failed to load experiment data: variant numbers must be unique integers within an item.');
        throw new Error(`Product ${p.id} has a missing or duplicate variant number`);
      }
      seen.add(v.variant);
      if (typeof v.text !== 'string' || v.text.trim() === '') {
        alert('Failed to load experiment data: a variant has empty text.');
        throw new Error(`Product ${p.id} variant ${v.variant} has empty text`);
      }
    }
    const chosen = p.variants[Math.floor(Math.random() * p.variants.length)];
    p.chosenText = chosen.text;        // displayed
    p.chosenVariant = chosen.variant;  // recorded (declared integer, not the array index)
  }

  await generateTrials();
  setupEventListeners();
}

// Ask the server for a balanced assignment: the least-rated pairs, each with
// its less-seen left/right arrangement. Returns null if unavailable.
async function fetchBalancedAssignments() {
  try {
    const response = await fetch('/api/assign-pairs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experiment_name: CONFIG.EXPERIMENT_NAME,
        product_ids: products.map(p => p.id),
        n_pairs: CONFIG.N_PAIRS
      })
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data.assignments) || data.assignments.length === 0) return null;

    const byId = new Map(products.map(p => [p.id, p]));
    const regularTrials = [];
    for (const a of data.assignments) {
      const left = byId.get(a.left_product_id);
      const right = byId.get(a.right_product_id);
      if (!left || !right) return null; // stimulus mismatch — fall back
      regularTrials.push({
        left: left,
        right: right,
        pairId: a.pair_id,
        position: a.position,
        isCatchTrial: false
      });
    }
    return regularTrials;
  } catch (e) {
    console.error('Balanced assignment unavailable, falling back to random:', e);
    return null;
  }
}

// Fallback: random pairs with coin-flip left/right (original behavior)
function generateRandomPairs() {
  const pairs = [];

  // Generate all possible pairs (no self-comparisons)
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      pairs.push([products[i], products[j]]);
    }
  }

  // Shuffle and take N_PAIRS for regular trials
  shuffleArray(pairs);

  return pairs.slice(0, CONFIG.N_PAIRS).map(([productA, productB]) => {
    // Randomly assign left/right
    const aOnLeft = Math.random() < 0.5;
    const leftProduct = aOnLeft ? productA : productB;
    const rightProduct = aOnLeft ? productB : productA;

    // Position is AB if the alphabetically first ID is on the left
    // This must match how pairId is constructed (alphabetically sorted)
    const [sortedFirst] = [productA.id, productB.id].sort();

    return {
      left: leftProduct,
      right: rightProduct,
      pairId: [productA.id, productB.id].sort().join('_'),
      position: leftProduct.id === sortedFirst ? 'AB' : 'BA',
      isCatchTrial: false
    };
  });
}

// Build the trial list: balanced server assignment (random fallback)
// plus one catch trial, in randomized order
async function generateTrials() {
  const regularTrials = (await fetchBalancedAssignments()) || generateRandomPairs();

  trials = [...regularTrials];

  // Optionally add one catch trial (identical item AND variant on both sides —
  // the chosen variant rides on the product object, so left === right here).
  if (CONFIG.CATCH_TRIAL) {
    const catchProduct = products[Math.floor(Math.random() * products.length)];
    trials.push({
      left: catchProduct,
      right: catchProduct,
      pairId: `${catchProduct.id}_${catchProduct.id}`,
      position: 'AB',
      isCatchTrial: true
    });
  }

  // Shuffle to randomize trial order (including catch position)
  shuffleArray(trials);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// Comprehension: enable Start button when all answered (don't check correctness yet)
// NOTE: scope to the instructions page — the post-task survey also uses
// .question-group for styling and must not be counted here.
function enableStartIfAllAnswered() {
  const questionGroups = instructionsPage.querySelectorAll('.question-group');
  const allAnswered = Array.from(questionGroups).every((group, index) => {
    return group.querySelector(`input[name="q${index + 1}"]:checked`);
  });
  startBtn.disabled = !allAnswered;
}

// Comprehension: check answers on Start click, show feedback only then
function checkComprehension() {
  const questionGroups = instructionsPage.querySelectorAll('.question-group');
  let allCorrect = true;

  questionGroups.forEach((group, index) => {
    const correctAnswer = group.dataset.correct;
    const selectedInput = group.querySelector(`input[name="q${index + 1}"]:checked`);

    group.classList.remove('incorrect');

    if (selectedInput.value !== correctAnswer) {
      group.classList.add('incorrect');
      allCorrect = false;
    }
  });

  comprehensionError.classList.toggle('hidden', allCorrect);
  return allCorrect;
}

function setupEventListeners() {
  consentBtn.addEventListener('click', () => {
    // Start session creation in the background and navigate immediately —
    // awaiting the (possibly cold) serverless function here froze the click
    // for several seconds. Failure is handled at the Start button instead.
    sessionCreationPromise = createSession();
    showPage(instructionsPage);
  });

  noConsentBtn.addEventListener('click', () => {
    showPage(noConsentPage);
  });

  // Comprehension: enable Start when all answered (no correctness check yet)
  instructionsPage.querySelectorAll('.question-group input').forEach(input => {
    input.addEventListener('change', enableStartIfAllAnswered);
  });

  startBtn.addEventListener('click', async () => {
    // Check answers on click - only proceed if all correct
    if (!checkComprehension()) return;

    // Session creation began at consent; by now it has almost always
    // resolved, so this await is imperceptible. Retry once on failure.
    let sessionOk = await sessionCreationPromise;
    if (!sessionOk) {
      sessionCreationPromise = createSession();
      sessionOk = await sessionCreationPromise;
    }
    if (!sessionOk) {
      alert('Failed to start the experiment. Please refresh and try again.');
      return;
    }

    startTime = Date.now();
    showPage(trialPage);
    showTrial();
  });

  nextBtn.addEventListener('click', () => {
    recordResponse(); // server write runs in the background (pendingWrites)
    currentTrial++;

    if (currentTrial < trials.length) {
      showTrial();
    } else {
      // No post-task survey in v2 — go straight to demographics
      showPage(demographicsPage);
    }
  });

  slider.addEventListener('input', () => {
    sliderValue.textContent = slider.value;
    sliderMoved = true;
    nextBtn.disabled = false;
  });

  // Demographics form validation
  function validateDemographics() {
    const ageValid = ageInput.value && parseInt(ageInput.value) >= 18 && parseInt(ageInput.value) <= 120;
    const genderValid = genderSelect.value !== '';
    demographicsSubmitBtn.disabled = !(ageValid && genderValid);
  }

  ageInput.addEventListener('input', validateDemographics);
  genderSelect.addEventListener('change', validateDemographics);

  demographicsSubmitBtn.addEventListener('click', async () => {
    demographicsSubmitBtn.disabled = true;
    demographicsSubmitBtn.textContent = 'Submitting...';

    const age = parseInt(ageInput.value);
    const gender = genderSelect.value;

    await saveDemographics(age, gender);
    await complete();
  });

  // Prevent back navigation
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
  });
}

function showPage(page) {
  [consentPage, noConsentPage, alreadyCompletedPage, instructionsPage, trialPage, demographicsPage, completePage].forEach(p => {
    p.classList.add('hidden');
  });
  page.classList.remove('hidden');
  window.scrollTo(0, 0);
}

function showTrial() {
  const trial = trials[currentTrial];

  progressText.textContent = `Pair ${currentTrial + 1} of ${trials.length}`;

  // Text-only display: the chosen variant's text is the sole stimulus
  // (no product name or price shown).
  productLeftDesc.textContent = trial.left.chosenText;
  productRightDesc.textContent = trial.right.chosenText;

  // Reset slider and disable Next button
  slider.value = 50;
  sliderValue.textContent = '50';
  sliderMoved = false;
  nextBtn.disabled = true;

  // Start timing for this trial
  trialStartTime = Date.now();
}

function recordResponse() {
  const trial = trials[currentTrial];
  const responseTime = Date.now() - trialStartTime;
  const rating = parseInt(slider.value);

  // Record locally (for redundancy)
  results.push({
    pairId: trial.pairId,
    position: trial.position,
    rating: rating,
    responseTime: responseTime,
    isCatchTrial: trial.isCatchTrial
  });

  // Send to server in the background; awaited together at completion.
  // The per-item variant is read HERE (trial is in scope) and threaded into
  // trialData — recordTrialToServer must NOT reference `trial` (no binding there).
  pendingWrites.push(recordTrialToServer({
    trialNumber: currentTrial + 1,
    pairId: trial.pairId,
    position: trial.position,
    leftProductId: trial.left.id,
    rightProductId: trial.right.id,
    leftVariant: trial.left.chosenVariant,
    rightVariant: trial.right.chosenVariant,
    rating: rating,
    responseTime: responseTime,
    isCatchTrial: trial.isCatchTrial
  }));
}

async function complete() {
  showPage(completePage);
  markAsCompletedLocally();

  const duration = Date.now() - startTime;

  // Make sure all background trial/survey writes have landed before the
  // session is marked complete (completed sessions drive balance counts)
  await Promise.allSettled(pendingWrites);

  // Complete session on server (response ignored for redirect — see below)
  await completeSession(duration);

  // Always use the client-side config URL so this study can have its own
  // Prolific completion code without touching the shared /api/complete env var
  // that the old study depends on.
  const redirectUrl = CONFIG.PROLIFIC_COMPLETION_URL;

  if (redirectUrl) {
    setTimeout(() => {
      window.location.href = redirectUrl;
    }, 1500);
  } else {
    // For testing: show message instead of redirecting
    redirectMessage.textContent = 'Testing mode: Your responses have been saved. You may close this window.';
    console.log('Session completed. Results:', results);
  }
}

// Start
init();
