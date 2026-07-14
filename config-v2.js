const CONFIG = {
  // X = regular product pairs shown per participant (plus 1 catch trial when
  // CATCH_TRIAL is on). Design: 10 pairs/participant over 12 brands — each rates
  // 10 of the C(12,2)=66 possible pairs. 66 pairs x 2 left/right arrangements =
  // 132 cells, so one full coverage pass is ~13 participants and ~660 completes
  // puts ~50 ratings on each pair-direction. The full matrix is reconstructed
  // across the sample, not within a participant.
  N_PAIRS: 10,

  // Loads stimuli/<EXPERIMENT_NAME>/stimuli.json (text positioning statements; no
  // images). The "provided brand positioning" study: 12 fictitious brands x 20
  // first-person brand-voice variants each, compiled from
  // "Generated Stimulus Study - BrandVoice2/" via `node compile-stimuli.js --subset`.
  // The 12 are the BrandVoice2 15 minus Pell/Avor/Mott (brand-08/09/13), dropped as
  // the least informative about the coordinate space — see that folder's AUDIT.md.
  // Brand ids keep their original numbering, so there are gaps at 08/09/13.
  EXPERIMENT_NAME: 'provided-brand-positioning-brandvoice2-12brand-2026-07-14',

  // Internal-trial study selector: the `?exp=<key>` URL param picks one of these by
  // key; when absent or unknown, experiment-v2.js falls back to EXPERIMENT_NAME
  // above. Only the live arm is listed here; past arms are retired.
  EXPERIMENTS: {
    brandvoice2_12: 'provided-brand-positioning-brandvoice2-12brand-2026-07-14',
  },

  // Include one catch trial (same item + same variant on both sides) as an
  // attention check. Set false for a 0-catch run (no code change needed).
  CATCH_TRIAL: true,

  // Prolific completion URL - participants redirect here after completing.
  // Reuses the previous (cereal / image-only) study's completion code, per design.
  PROLIFIC_COMPLETION_URL: 'https://app.prolific.com/submissions/complete?cc=CGLVD50R',
};

export default CONFIG;
