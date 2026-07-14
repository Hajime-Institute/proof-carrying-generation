/**
 * B1: strong-judge sweep on the OFF-EDF universal obligations (the Theorem-2 zone).
 * We ask five judge models -- including two reasoning models (o3-mini, o4-mini) --
 * whether each generated implementation satisfies a UNIVERSAL-over-infinite-domain
 * claim ("f is correct for EVERY input"). By the lower bound no finite-execution
 * certifier can decide these, and the certificate correctly abstains (out-of-fragment).
 * The judges instead read the source and return a confident verdict. We measure, per
 * judge, how often it returns a confident (non-abstain) verdict and how often it
 * contradicts itself across runs; and ACROSS judges, how often the five disagree on
 * the same yes/no question -- direct evidence they are guessing, since a decidable
 * fact would not split five strong models.
 *
 * Reuses the SAME generated implementations as codegen_frontier.mjs (server/codegen/tmp).
 *   node papers/01_AAAI_PROOFCARRY/server/codegen/judge_sweep.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
for (const l of readFileSync(REPO + ".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m) process.env[m[1]] ||= m[2].replace(/^["']|["']$/g, "");
}
const N = Number(process.env.SWEEP_RUNS || 3);

// the 7 specs carrying an infinite-domain universal obligation (weekday is finite => excluded)
const SPECS = [
  { id: "email", func: "is_valid_email", desc: "Return True iff s is a syntactically valid email (exactly one '@', non-empty local part, domain with >=1 dot and non-empty labels), else False.",
    universal: "returns the spec-correct verdict for EVERY one of the infinitely many strings" },
  { id: "parseint", func: "parse_int_safe", desc: "Return the int value of s if s is an optionally sign-prefixed base-10 integer with no surrounding whitespace and no other characters, else None.",
    universal: "returns None for EVERY one of the infinitely many non-integer strings" },
  { id: "dedupe", func: "dedupe", desc: "Return xs with duplicates removed, keeping first occurrence and original order.",
    universal: "produces a duplicate-free order-preserving output for EVERY one of the infinitely many input lists" },
  { id: "clamp", func: "clamp", desc: "Return x limited to [lo,hi]: lo if x<lo, hi if x>hi, else x (lo<=hi assumed).",
    universal: "returns a value within [lo,hi] for EVERY one of the infinitely many (x,lo,hi) with lo<=hi" },
  { id: "rle", func: "rle_encode", desc: "Run-length encode s: each maximal run of char c length n -> c then decimal n. 'aaabb'->'a3b2', ''->''.",
    universal: "is invertible (a matching decoder recovers s) for EVERY one of the infinitely many strings" },
  { id: "ordinal", func: "ordinal", desc: "Ordinal string for positive int n: suffix 'st'/'nd'/'rd' for last digit 1/2/3 EXCEPT last two digits 11/12/13 use 'th'.",
    universal: "produces the correct ordinal for EVERY one of the infinitely many positive integers" },
  { id: "truncate", func: "truncate", desc: "If len(s)<=n return s; else s[:n-3]+'...' so the result length is exactly n (n>=3).",
    universal: "returns a string of length at most n for EVERY one of the infinitely many (s,n) with n>=3" },
];
const GEN = [["gpt-4o-mini", "gpt4omini"], ["gemini-2.5-flash", "gemini25flash"], ["gpt-4o", "gpt4o"]];

const JUDGES = [
  { name: "gemini-2.5-flash", make: () => google("gemini-2.5-flash"), temp: 0 },
  { name: "gpt-4o",           make: () => openai("gpt-4o"),           temp: 0 },
  { name: "gemini-2.5-pro",   make: () => google("gemini-2.5-pro"),   temp: 0 },
  { name: "o4-mini",          make: () => openai("o4-mini"),          temp: null },
  { name: "o3-mini",          make: () => openai("o3-mini"),          temp: null },
];

const stripFuture = (c) => c.replace(/^from __future__ import annotations\n/, "");
function code(specId, tag) { return stripFuture(readFileSync(HERE + `tmp/${specId}_${tag}.py`, "utf8")); }

async function ask(judge, question) {
  try {
    const opts = { model: judge.make(), maxOutputTokens: 16000,
      prompt: `You are an expert code reviewer. Answer with YES, NO, or UNKNOWN as the very first word. Say UNKNOWN if this cannot be decided by bounded testing.\n${question}` };
    if (judge.temp != null) opts.temperature = judge.temp;
    const r = await generateText(opts);
    const t = (r.text || "").trim();
    const m = t.match(/\b(yes|no|unknown|undetermined|cannot)\b/i);
    if (!m) return null;
    const w = m[1].toLowerCase();
    return (w === "yes" || w === "no") ? (w === "yes") : "abstain";
  } catch (e) { return null; }
}
async function pool(items, k, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(k, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); }
  }));
  return out;
}
const maj = (rs) => { const y = rs.filter(x => x === true).length, n = rs.filter(x => x === false).length; return (y === 0 && n === 0) ? null : y >= n; };

// build the 21 universal obligations (spec x gen-model)
const obls = [];
for (const s of SPECS) for (const [, tag] of GEN) obls.push({ spec: s.id, tag, desc: s.desc, universal: s.universal, code: code(s.id, tag) });

// judge x obligation x N
const records = [];
for (const judge of JUDGES) {
  process.stderr.write(`[${judge.name}] `);
  const rows = await pool(obls, 6, async (o) => {
    const q = `Specification: ${o.desc}\n\nCandidate implementation:\n\`\`\`python\n${o.code}\n\`\`\`\nClaim: this implementation ${o.universal}. Does the claim hold? Remember: answer YES, NO, or UNKNOWN.`;
    const runs = []; for (let i = 0; i < N; i++) runs.push(await ask(judge, q));
    return { spec: o.spec, tag: o.tag, runs, majority: maj(runs) };
  });
  records.push({ judge: judge.name, rows });
}
process.stderr.write("\n");

// per-judge metrics
const perJudge = records.map(r => {
  let confident = 0, inconsistent = 0, abstain = 0;
  for (const row of r.rows) {
    const anyAbstain = row.runs.some(x => x === "abstain");
    if (row.majority === null || anyAbstain) abstain++; else confident++;
    const y = row.runs.filter(x => x === true).length, n = row.runs.filter(x => x === false).length;
    if (y > 0 && n > 0) inconsistent++;
  }
  return { judge: r.judge, confident: `${confident}/${r.rows.length}`, inconsistent: `${inconsistent}/${r.rows.length}`, abstained: `${abstain}/${r.rows.length}` };
});

// cross-model disagreement per obligation
const byObl = {};
for (const r of records) for (const row of r.rows) {
  const key = `${row.spec}:${row.tag}`;
  (byObl[key] ||= {})[r.judge] = row.majority;
}
let split = 0, unanimous = 0, total = 0;
for (const key of Object.keys(byObl)) {
  total++;
  const verdicts = JUDGES.map(j => byObl[key][j.name]).filter(v => v !== null && v !== undefined);
  const yes = verdicts.filter(v => v === true).length, no = verdicts.filter(v => v === false).length;
  if (yes > 0 && no > 0) split++; else unanimous++;
}

const summary = {
  judges: JUDGES.map(j => j.name), runsPerObligation: N, universalObligations: obls.length,
  certificate: { confidentVerdicts: `0/${obls.length}`, note: "all reported out-of-fragment, deterministic" },
  perJudge,
  crossModel: { obligationsWhereJudgesSplit: `${split}/${total}`, unanimous: `${unanimous}/${total}` },
};
writeFileSync(HERE + "judge_sweep_abstain_results.json", JSON.stringify({ summary, byObl, records }, null, 2));
console.log(JSON.stringify(summary, null, 2));
