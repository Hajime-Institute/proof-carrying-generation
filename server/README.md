# Code and data — layout

The generation pipeline, the judge-free certificate issuer, and every evaluation
script with its committed result file, so the paper's numbers can be re-checked
without re-running a model. See the top-level `README.md` for the verify and
re-generate commands.

## Layout

```
server/
  lib/
    spec.mjs        canonical reservation spec (screens, components, ID contract)
    generator.mjs   prompt -> spec -> self-contained HTML (LLM), plus a repair pass
    issuer.mjs      judge-free certificate: reachability + transition + kappa (Playwright)
    faults.mjs      obligation-aligned navigation-fault injection
  codegen/          code-generation modality (second modality)
    codegen_frontier.mjs      8 specs x 3 models -> codegen_results.json
    judge_sweep.mjs           5 judges x 21 off-EDF universals -> judge_sweep_results.json
    judge_sweep_abstain.mjs   same, with an explicit abstain option -> judge_sweep_abstain_results.json
    compute_fleiss.mjs        Fleiss kappa over the judge sweep
    harness.py                deterministic Python test harness
  data/
    hard_bench/     multi-screen UI benchmark: *.mjs drivers, *_results.json, apps/
    edf_corpus/     obligations.json, spec_0..7.md, edf_coverage.json
      annotation/   human EDF labels (edf_coverage_responses.csv), gold_hidden.json, IAA scripts
    pilot_results/  issuer soundness / regression / closed-loop committed results
    vlm_baseline_records.json
  judge_vs_cert.mjs, judge_vs_cert_multi.mjs   certificate vs screenshot-VLM judge (Table 2)
  out/            committed result files (judge_vs_cert*.json)
```

## Requirements

Node >= 18. Verification reads the committed result files and needs no API keys.
Re-generation needs `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `ANTHROPIC_API_KEY` in a
`.env`, plus `npm install` (ai, @ai-sdk/*, playwright). Set the model with `PCG_MODEL=...`.
