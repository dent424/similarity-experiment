const CONFIG = {
  N_PAIRS: 24, // Number of regular franchise pairs (plus 1 catch trial = 25 total); pair space is C(16,2)=120, so 50 ratings per pair-direction = exactly 500 completes
  EXPERIMENT_NAME: 'movie-franchise-text-2026-07-07', // Loads stimuli/<EXPERIMENT_NAME>/stimuli.json (text-only, no images)

  // Prolific completion URL - participants redirect here after completing.
  // Reuses the previous (cereal / image-only) study's completion code, per design.
  PROLIFIC_COMPLETION_URL: 'https://app.prolific.com/submissions/complete?cc=CGLVD50R',
};

export default CONFIG;
