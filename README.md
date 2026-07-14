# Proof-Carrying Generation — code & data

Reproducibility artifact for the paper *Proof-Carrying Generation: A Judge-Free
Certifiability Frontier for Evaluating Generative Models, Instantiated on Web UI*.
Every load-bearing number in the paper is produced by the scripts here and is
committed as a result file, so the paper's claims can be checked without re-running
any model. Re-generation needs API keys; verification does not.

## Layout

```
server/
  codegen/            code-generation modality (§ second modality)
    codegen_frontier.mjs   8 specs × 3 models → codegen_results.json
    judge_sweep.mjs        5 judges × 21 off-EDF universals → judge_sweep_results.json
    judge_sweep_abstain.mjs  same, with an explicit abstain option → judge_sweep_abstain_results.json
    compute_fleiss.mjs     Fleiss κ over the judge sweep (main + abstain)
    harness.py             deterministic Python test harness (the code analogue of the UI harness)
  data/
    hard_bench/
      hard_bench.mjs         hard multi-screen UI benchmark → results.json / summary.json
      hard_bench_bsweep.mjs  2026-frontier re-run + B=5 repair sweep → bsweep_results.json
      best_of_n.mjs          best-of-N: certificate- vs VLM-judge-ranking → best_of_n_results.json
      l_extension.mjs        L-extension demo (accessibility-tree oracle) → l_extension_results.json
      analyze_bsweep.mjs     aggregation for the B-sweep
    edf_corpus/
      obligations.json       153 behavioral obligations + rule-based EDF classification (82.4%)
      annotation/            human EDF/non-EDF labels (2 annotators, blind) + IAA
        edf_coverage_responses.csv   153 × 2 labels (annotators anonymized A/B)
        compute_iaa_from_export.mjs  Fleiss/Cohen κ + human vs classifier coverage
        wellformed_coverage.mjs      per-subset coverage breakdown
    vlm_baseline_records.json, pilot_results/   VLM-judge baseline and issuer pilots
  lib/                spec / fault-injection / issuer / generator helpers
  judge_vs_cert*.mjs  certificate vs screenshot-VLM-judge comparison (Table 2)
  out/                committed result files (judge_vs_cert*.json)
```

## Verify (no API keys)

```
node data/hard_bench/analyze_bsweep.mjs                 # 2026-frontier validation 4/27, per-model 11–22%
node codegen/compute_fleiss.mjs                         # judge Fleiss κ = 0.41, split 12/21
node data/edf_corpus/annotation/compute_iaa_from_export.mjs \
     data/edf_corpus/annotation/edf_coverage_responses.csv   # human κ, 65% vs 82% coverage
```

## Re-generate (needs API keys)

Put `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`), and
`ANTHROPIC_API_KEY` in a `.env` at the repo root, then `npm install` (ai, @ai-sdk/*,
playwright) and run the `*.mjs` drivers. All runs are deterministic given the same
generated artifacts; the committed `*_results.json` are the exact outputs used in
the paper.

## License

Released for research use.
