import CONFIG from './config.js';

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

// localStorage key for tracking completion
const COMPLETION_KEY = 'similarity_experiment_completed';

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
const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn');
const demographicsSubmitBtn = document.getElementById('demographics-submit-btn');

const progressText = document.getElementById('progress-text');
const productLeftImg = document.getElementById('product-left-img');
const productLeftName = document.getElementById('product-left-name');
const productLeftPrice = document.getElementById('product-left-price');
const productLeftDesc = document.getElementById('product-left-desc');
const productRightImg = document.getElementById('product-right-img');
const productRightName = document.getElementById('product-right-name');
const productRightPrice = document.getElementById('product-right-price');
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
    await fetch('/api/trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        trial_number: trialData.trialNumber,
        pair_id: trialData.pairId,
        position: trialData.position,
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

  // Check for repeat visit (server-side first, then localStorage)
  // DISABLED FOR TESTING - uncomment for production
  // const completedOnServer = await hasAlreadyCompletedOnServer();
  // if (completedOnServer || hasAlreadyCompletedLocally()) {
  //   showPage(alreadyCompletedPage);
  //   return;
  // }

  // Load products
  try {
    const response = await fetch(`./stimuli/${CONFIG.EXPERIMENT_NAME}.json`);
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

  generateTrials();
  setupEventListeners();
}

// Generate random pairs including one catch trial
function generateTrials() {
  const pairs = [];

  // Generate all possible pairs (no self-comparisons)
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      pairs.push({ products: [products[i], products[j]], isCatchTrial: false });
    }
  }

  // Shuffle and take N_PAIRS for regular trials
  shuffleArray(pairs);
  const regularTrials = pairs.slice(0, CONFIG.N_PAIRS);

  // Create one catch trial (identical product on both sides)
  const catchProduct = products[Math.floor(Math.random() * products.length)];
  const catchTrial = { products: [catchProduct, catchProduct], isCatchTrial: true };

  // Combine regular trials and catch trial
  const allTrials = [...regularTrials, catchTrial];

  // Shuffle again to randomize catch trial position
  shuffleArray(allTrials);

  // Format trials with randomized left/right positions
  trials = allTrials.map(trial => {
    const [productA, productB] = trial.products;

    // For catch trials, both products are the same, so pairId uses it twice
    const pairId = trial.isCatchTrial
      ? `${productA.id}_${productA.id}`
      : [productA.id, productB.id].sort().join('_');

    // Randomly assign left/right
    const aOnLeft = Math.random() < 0.5;
    return {
      left: aOnLeft ? productA : productB,
      right: aOnLeft ? productB : productA,
      pairId: pairId,
      position: aOnLeft ? 'AB' : 'BA',
      isCatchTrial: trial.isCatchTrial
    };
  });
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function setupEventListeners() {
  consentBtn.addEventListener('click', async () => {
    // Create session on server when user consents
    const success = await createSession();
    if (!success) {
      alert('Failed to start the experiment. Please refresh and try again.');
      return;
    }
    showPage(instructionsPage);
  });

  noConsentBtn.addEventListener('click', () => {
    showPage(noConsentPage);
  });

  startBtn.addEventListener('click', () => {
    startTime = Date.now();
    showPage(trialPage);
    showTrial();
  });

  nextBtn.addEventListener('click', async () => {
    await recordResponse();
    currentTrial++;

    if (currentTrial < trials.length) {
      showTrial();
    } else {
      // Go to demographics page instead of completing
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
}

function showTrial() {
  const trial = trials[currentTrial];

  progressText.textContent = `Pair ${currentTrial + 1} of ${trials.length}`;

  // Left product
  productLeftImg.src = `./stimuli/${trial.left.image}`;
  productLeftImg.alt = trial.left.name;
  productLeftName.textContent = trial.left.name;
  productLeftPrice.textContent = trial.left.price;
  productLeftDesc.textContent = trial.left.description;

  // Right product
  productRightImg.src = `./stimuli/${trial.right.image}`;
  productRightImg.alt = trial.right.name;
  productRightName.textContent = trial.right.name;
  productRightPrice.textContent = trial.right.price;
  productRightDesc.textContent = trial.right.description;

  // Reset slider and disable Next button
  slider.value = 50;
  sliderValue.textContent = '50';
  sliderMoved = false;
  nextBtn.disabled = true;

  // Start timing for this trial
  trialStartTime = Date.now();
}

async function recordResponse() {
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

  // Send to server immediately
  await recordTrialToServer({
    trialNumber: currentTrial + 1,
    pairId: trial.pairId,
    position: trial.position,
    rating: rating,
    responseTime: responseTime,
    isCatchTrial: trial.isCatchTrial
  });
}

async function complete() {
  showPage(completePage);
  markAsCompletedLocally();

  const duration = Date.now() - startTime;

  // Complete session on server and get redirect URL
  const serverRedirectUrl = await completeSession(duration);

  // Use server URL if available, otherwise fall back to config
  const redirectUrl = serverRedirectUrl || CONFIG.PROLIFIC_COMPLETION_URL;

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
