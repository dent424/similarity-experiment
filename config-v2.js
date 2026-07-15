const CONFIG = {
  // X = regular product pairs shown per participant (plus 1 catch trial when
  // CATCH_TRIAL is on). Design: 10 pairs/participant over 15 brands — each rates
  // 10 of the C(15,2)=105 possible pairs. 105 pairs x 2 left/right arrangements =
  // 210 cells, so one full coverage pass is 21 participants and 525 completes
  // (25 clean passes) puts 25 ratings on each cell — i.e. 50 per brand pair once
  // the two arrangements are collapsed, and 700 ratings mentioning each brand.
  // Direction is a counterbalancing nuisance factor, not a factor of interest;
  // 25/cell is the deliberate target. The full matrix is reconstructed across the
  // sample, not within a participant.
  N_PAIRS: 10,

  // Loads stimuli/<EXPERIMENT_NAME>/stimuli.json (text positioning statements; no
  // images). The "provided brand positioning" study: 15 fictitious brands x 20
  // first-person brand-voice variants each (300 instances), compiled from
  // "Generated Stimulus Study - BrandVoice2/" via `node compile-stimuli.js`.
  // This is the full BrandVoice2 set. A 12-brand subset arm (minus Pell/Avor/Mott,
  // brand-08/09/13) ran briefly on 2026-07-14 and was retired without launching:
  // the anti-keyword criterion does not survive subsetting — 0 content lemmas at
  // |r| >= 0.6 over the full 15, but 16 crossings at 12, and an exhaustive scan of
  // all C(15,3)=455 drop-sets found none that preserve it. See that folder's AUDIT.md.
  EXPERIMENT_NAME: 'provided-brand-positioning-brandvoice2-2026-07-09',

  // Internal-trial study selector: the `?exp=<key>` URL param picks one of these by
  // key; when absent or unknown, experiment-v2.js falls back to EXPERIMENT_NAME
  // above. Only the live arm is listed here; past arms are retired.
  EXPERIMENTS: {
    brandvoice2: 'provided-brand-positioning-brandvoice2-2026-07-09',
  },

  // Include one catch trial (same item + same variant on both sides) as an
  // attention check. Set false for a 0-catch run (no code change needed).
  CATCH_TRIAL: true,

  // Prolific completion URL - participants redirect here after completing.
  // Reuses the previous (cereal / image-only) study's completion code, per design.
  PROLIFIC_COMPLETION_URL: 'https://app.prolific.com/submissions/complete?cc=CGLVD50R',
};

export default CONFIG;
