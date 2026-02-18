const CONFIG = {
  N_PAIRS: 10, // Number of regular product pairs (plus 1 catch trial = 11 total)
  EXPERIMENT_NAME: '5-product-pilot-2026-02-18', // Which JSON file to load from stimuli/
  MAX_DESCRIPTION_WORDS: 50, // Word limit for generated descriptions

  // Prolific completion URL - participants redirect here after completing
  // Format: https://app.prolific.com/submissions/complete?cc=XXXXXXXX
  PROLIFIC_COMPLETION_URL: 'https://app.prolific.com/submissions/complete?cc=C6E35AK0',

  // URL to redirect if participant fails screening (set to Prolific redirect URL)
  SCREENING_FAIL_URL: 'https://app.prolific.com/submissions/complete?cc=CQ0Z9XNV',
};

export default CONFIG;
