import CONFIG from './config.js';

let products = [];
let trials = [];
let currentTrial = 0;
let results = [];
let startTime = null;

// DOM elements
const consentPage = document.getElementById('consent-page');
const instructionsPage = document.getElementById('instructions-page');
const trialPage = document.getElementById('trial-page');
const completePage = document.getElementById('complete-page');

const consentBtn = document.getElementById('consent-btn');
const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn');

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

// Initialize
async function init() {
  const response = await fetch(`./stimuli/${CONFIG.STIMULUS_SET}.json`);
  const data = await response.json();
  products = data.products;

  if (products.length < 2) {
    alert('Not enough products loaded. Need at least 2 products.');
    return;
  }

  generateTrials();
  setupEventListeners();
}

// Generate random pairs
function generateTrials() {
  const pairs = [];

  // Generate all possible pairs
  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      pairs.push([products[i], products[j]]);
    }
  }

  // Shuffle and take N_PAIRS
  shuffleArray(pairs);
  trials = pairs.slice(0, CONFIG.N_PAIRS);

  // Randomize left/right for each trial
  trials = trials.map(pair => {
    // Sort pair by ID alphabetically to get consistent pairId
    const sorted = [pair[0], pair[1]].sort((a, b) => a.id.localeCompare(b.id));
    const [productA, productB] = sorted;

    // Randomly assign left/right
    const aOnLeft = Math.random() < 0.5;
    return {
      left: aOnLeft ? productA : productB,
      right: aOnLeft ? productB : productA,
      pairId: `${productA.id}_${productB.id}`,
      position: aOnLeft ? 'AB' : 'BA' // AB means A was left, BA means B was left
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
  consentBtn.addEventListener('click', () => {
    showPage(instructionsPage);
  });

  startBtn.addEventListener('click', () => {
    startTime = Date.now();
    showPage(trialPage);
    showTrial();
  });

  nextBtn.addEventListener('click', () => {
    recordResponse();
    currentTrial++;

    if (currentTrial < trials.length) {
      showTrial();
    } else {
      complete();
    }
  });

  slider.addEventListener('input', () => {
    sliderValue.textContent = slider.value;
  });
}

function showPage(page) {
  [consentPage, instructionsPage, trialPage, completePage].forEach(p => {
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

  // Reset slider
  slider.value = 50;
  sliderValue.textContent = '50';
}

function recordResponse() {
  const trial = trials[currentTrial];
  results.push({
    pairId: trial.pairId,
    position: trial.position,
    rating: parseInt(slider.value)
  });
}

function complete() {
  showPage(completePage);

  const duration = Date.now() - startTime;

  // Build URL parameters
  const params = new URLSearchParams();

  results.forEach((result, i) => {
    params.append(`pair_${i + 1}`, result.pairId);
    params.append(`pos_${i + 1}`, result.position);
    params.append(`rating_${i + 1}`, result.rating);
  });

  params.append('duration_ms', duration);

  // Redirect to Qualtrics
  if (CONFIG.QUALTRICS_URL) {
    const redirectUrl = `${CONFIG.QUALTRICS_URL}?${params.toString()}`;
    setTimeout(() => {
      window.location.href = redirectUrl;
    }, 1500);
  } else {
    // For testing: log the params
    console.log('Would redirect with params:', params.toString());
    document.querySelector('#complete-page p').textContent =
      'Testing mode: Check console for redirect params.';
  }
}

// Start
init();
