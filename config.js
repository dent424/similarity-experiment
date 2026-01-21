const CONFIG = {
  N_PAIRS: 30, // Number of regular product pairs (plus 1 catch trial = 31 total)
  EXPERIMENT_NAME: '25-word', // Which JSON file to load from stimuli/
  MAX_DESCRIPTION_WORDS: 50, // Word limit for generated descriptions

  // Prolific completion URL - participants redirect here after completing
  // Format: https://app.prolific.com/submissions/complete?cc=XXXXXXXX
  PROLIFIC_COMPLETION_URL: '',

  // URL to redirect if participant fails screening (set to Prolific redirect URL)
  SCREENING_FAIL_URL: null,
};

export default CONFIG;
