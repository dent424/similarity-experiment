const CONFIG = {
  // X = regular product pairs shown per participant (plus 1 catch trial when
  // CATCH_TRIAL is on). Design: 15 pairs/participant over 15 brands — each rates
  // 15 of the C(15,2)=105 possible pairs; the full matrix is reconstructed across
  // the ~450-participant sample.
  N_PAIRS: 15,

  // Loads stimuli/<EXPERIMENT_NAME>/stimuli.json (text positioning statements; no
  // images). The "provided brand positioning" study: 15 fictitious brands x 10
  // variants each, compiled from "Generated Stimulus Study/brands/".
  EXPERIMENT_NAME: 'provided-brand-positioning-2026-06-29',

  // Include one catch trial (same item + same variant on both sides) as an
  // attention check. Set false for a 0-catch run (no code change needed).
  CATCH_TRIAL: true,

  // Prolific completion URL - participants redirect here after completing.
  // Reuses the previous (cereal / image-only) study's completion code, per design.
  PROLIFIC_COMPLETION_URL: 'https://app.prolific.com/submissions/complete?cc=CGLVD50R',
};

export default CONFIG;
