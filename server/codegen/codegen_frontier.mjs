/**
 * Second-modality instantiation of Proof-Carrying Generation: NL spec -> Python
 * function, with the SAME certified/refuted/out-of-fragment frontier as the web-UI
 * study. The ID contract becomes an INTERFACE contract (the spec mandates named
 * functions; the code must expose them as callables). The deterministic harness is
 * a Python test runner (harness.py). Example obligations are existential/bounded
 * (EDF) and are certified by execution with a replayable witness or refuted with a
 * concrete counterexample; universal-over-infinite obligations are out-of-fragment
 * (Thm 2); one finite-domain universal (weekday_name) is EDF by enumeration (Thm 1b).
 *
 * We generate each spec with three current models (gpt-4o-mini, gemini-2.5-flash,
 * gpt-4o), certify, run one certify-or-repair step, and contrast the deterministic
 * certificate with an LLM-as-judge (gemini-2.5-flash) reading the code, on the SAME
 * obligations. GROUND TRUTH for example obligations = the certificate (real
 * execution). Local, authorized, deterministic given the same generations.
 *
 *   node papers/01_AAAI_PROOFCARRY/server/codegen/codegen_frontier.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
for (const l of readFileSync(REPO + ".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m) process.env[m[1]] ||= m[2].replace(/^["']|["']$/g, "");
}
mkdirSync(HERE + "tmp", { recursive: true });

const GEN_MODELS = [
  ["gpt-4o-mini", () => openai("gpt-4o-mini")],
  ["gemini-2.5-flash", () => google("gemini-2.5-flash")],
  ["gpt-4o", () => openai("gpt-4o")],
];
const JUDGE = () => google("gemini-2.5-flash");
const N = Number(process.env.JUDGE_RUNS || 3);

// ---- corpus: each spec has a mandated function, EDF example obligations,
//      one universal-infinite obligation (off-EDF), and optionally a
//      finite-universal one (EDF by enumeration). ----
const SPECS = [
  { id: "email", func: "is_valid_email", sig: "is_valid_email(s: str) -> bool",
    desc: "Return True iff s is a syntactically valid email: exactly one '@', a non-empty local part before it, and after it a domain containing at least one '.', with every dot-separated domain label non-empty. Otherwise return False.",
    examples: [ [["a@b.com"], true], [["x.y@sub.domain.org"], true], [["plainaddress"], false],
                [["a@b"], false], [["@b.com"], false], [["a@.com"], false] ],
    universal: "returns the spec-correct verdict for EVERY one of the infinitely many strings" },
  { id: "parseint", func: "parse_int_safe", sig: "parse_int_safe(s: str) -> int | None",
    desc: "Return the integer value of s if s is an optionally sign-prefixed base-10 integer with no surrounding whitespace and no other characters (e.g. '42', '-7', '+3'); otherwise return None.",
    examples: [ [["42"], 42], [["-7"], -7], [["+3"], 3], [["  5"], null], [["3.5"], null], [["abc"], null], [[""], null] ],
    universal: "returns None for EVERY one of the infinitely many non-integer strings" },
  { id: "dedupe", func: "dedupe", sig: "dedupe(xs: list) -> list",
    desc: "Return a new list containing the elements of xs with duplicates removed, keeping the FIRST occurrence of each element and the original relative order.",
    examples: [ [[[1,1,2,3,2]], [1,2,3]], [[[]], []], [[["a","a","b"]], ["a","b"]], [[[3,2,1,2,3]], [3,2,1]] ],
    universal: "produces a duplicate-free order-preserving output for EVERY one of the infinitely many input lists" },
  { id: "clamp", func: "clamp", sig: "clamp(x: float, lo: float, hi: float) -> float",
    desc: "Return x limited to the closed interval [lo, hi]: lo if x < lo, hi if x > hi, else x. Assume lo <= hi.",
    examples: [ [[5,0,10], 5], [[-3,0,10], 0], [[99,0,10], 10], [[7,7,7], 7] ],
    universal: "returns a value within [lo,hi] for EVERY one of the infinitely many (x,lo,hi) with lo<=hi" },
  { id: "rle", func: "rle_encode", sig: "rle_encode(s: str) -> str",
    desc: "Run-length encode s: for each maximal run of a character c of length n, append c followed by the decimal count n. E.g. 'aaabb' -> 'a3b2', 'abc' -> 'a1b1c1', '' -> ''.",
    examples: [ [["aaabb"], "a3b2"], [["abc"], "a1b1c1"], [[""], ""], [["x"], "x1"], [["zzzz"], "z4"] ],
    universal: "is invertible (a matching decoder recovers s) for EVERY one of the infinitely many strings" },
  { id: "ordinal", func: "ordinal", sig: "ordinal(n: int) -> str",
    desc: "Return the ordinal string for a positive integer n: the number followed by its English suffix. Use 'st','nd','rd' for numbers ending in 1,2,3 EXCEPT numbers whose last two digits are 11,12,13, which use 'th'.",
    examples: [ [[1], "1st"], [[2], "2nd"], [[3], "3rd"], [[4], "4th"], [[11], "11th"], [[13], "13th"], [[21], "21st"], [[111], "111th"], [[112], "112th"] ],
    universal: "produces the correct ordinal for EVERY one of the infinitely many positive integers" },
  { id: "truncate", func: "truncate", sig: "truncate(s: str, n: int) -> str",
    desc: "If len(s) <= n, return s unchanged. Otherwise return the first characters of s followed by '...' so that the TOTAL length of the result is exactly n (that is, s[:n-3] + '...'). Assume n >= 3.",
    examples: [ [["hello world", 8], "hello..."], [["hi", 8], "hi"], [["abcdef", 6], "abcdef"], [["abcdefg", 6], "abc..."], [["exactly", 7], "exactly"] ],
    universal: "returns a string of length at most n for EVERY one of the infinitely many (s,n) with n>=3" },
  { id: "weekday", func: "weekday_name", sig: "weekday_name(n: int) -> str",
    desc: "Map an integer day index to its English name, where 0->'Monday', 1->'Tuesday', 2->'Wednesday', 3->'Thursday', 4->'Friday', 5->'Saturday', 6->'Sunday'. The input is always in 0..6.",
    examples: [ [[0], "Monday"], [[6], "Sunday"], [[3], "Thursday"] ],
    // FINITE-universal: the whole domain {0..6} is enumerable -> EDF (Thm 1b)
    finiteUniversal: { domain: [[0],[1],[2],[3],[4],[5],[6]],
      expected: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
      claim: "is correct for EVERY day index n in the finite domain 0..6" } },
];

const stripCode = (t) => {
  const m = (t || "").match(/```(?:python)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : t || "").trim();
};
async function gen(modelFn, spec, prior) {
  const base = `You are given a specification. Implement it in Python 3.\n\nSpecification:\n- Define EXACTLY this function: ${spec.sig}\n- Behavior: ${spec.desc}\n\nRequirements: define the function with that exact name and signature at module top level. Output ONLY one \`\`\`python code block, no prose.`;
  const prompt = prior
    ? `${base}\n\nYour previous attempt was:\n\`\`\`python\n${prior.code}\n\`\`\`\nIt FAILED this check: ${prior.cex}\nReturn a corrected version. Output ONLY one \`\`\`python code block.`
    : base;
  const r = await generateText({ model: modelFn(), prompt, temperature: 0, maxOutputTokens: 20000 });
  return stripCode(r.text);
}
function certify(spec, code, tag) {
  const codeFile = HERE + `tmp/${spec.id}_${tag}.py`;
  const checksFile = HERE + `tmp/${spec.id}_${tag}.checks.json`;
  // Lazy annotations so PEP-604 unions (int | None) load on Python 3.9; behavior unchanged.
  writeFileSync(codeFile, "from __future__ import annotations\n" + code);
  const checks = { requiredFuncs: [spec.func], checks: [] };
  spec.examples.forEach((e, i) => checks.checks.push({ id: `${spec.id}:ex${i}`, kind: "example", func: spec.func, args: e[0], expected: e[1] }));
  if (spec.finiteUniversal) checks.checks.push({ id: `${spec.id}:fin`, kind: "finite_universal", func: spec.func, domain: spec.finiteUniversal.domain, expected: spec.finiteUniversal.expected });
  writeFileSync(checksFile, JSON.stringify(checks));
  try {
    const out = execFileSync("python3", [HERE + "harness.py", codeFile, checksFile], { timeout: 15000, encoding: "utf8" });
    return JSON.parse(out);
  } catch (e) {
    return { kappa: false, kappaMissing: [spec.func], results: checks.checks.map(c => ({ id: c.id, kind: c.kind, verdict: "refuted", detail: "harness timeout/crash" })) };
  }
}
async function judge(question) {
  try {
    const r = await generateText({ model: JUDGE(), temperature: 0.7, maxOutputTokens: 20000,
      prompt: `You are a code reviewer. Answer with YES or NO as the very first word, then one short clause.\n${question}` });
    const t = (r.text || "").trim();
    return /^\s*yes/i.test(t) ? true : (/^\s*no/i.test(t) ? false : null);
  } catch { return null; }
}
async function pool(items, k, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(k, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); }
  }));
  return out;
}
const maj = (rs) => { const y = rs.filter(x => x === true).length, n = rs.filter(x => x === false).length; return (y === 0 && n === 0) ? null : y >= n; };

const records = [];
for (const spec of SPECS) {
  process.stderr.write(`[${spec.id}] `);
  for (const [mname, mfn] of GEN_MODELS) {
    let code = await gen(mfn, spec);
    let cert = certify(spec, code, mname.replace(/\W/g, ""));
    const preVerdicts = Object.fromEntries(cert.results.map(r => [r.id, r.verdict]));
    // one certify-or-repair step if any example refuted
    let repaired = false, postVerdicts = preVerdicts;
    const firstRef = cert.results.find(r => r.kind === "example" && r.verdict === "refuted");
    if (firstRef) {
      const code2 = await gen(mfn, spec, { code, cex: firstRef.detail });
      const cert2 = certify(spec, code2, mname.replace(/\W/g, "") + "_r");
      postVerdicts = Object.fromEntries(cert2.results.map(r => [r.id, r.verdict]));
      repaired = true; code = code2;
    }
    // judge on example obligations (ground truth = pre-repair certificate)
    const exObls = spec.examples.map((e, i) => ({ id: `${spec.id}:ex${i}`, args: e[0], exp: e[1] }));
    const jrows = await pool(exObls, 5, async (o) => {
      const q = `Specification: ${spec.desc}\n\nCandidate implementation:\n\`\`\`python\n${code}\n\`\`\`\nClaim: calling ${spec.func}(${o.args.map(a => JSON.stringify(a)).join(", ")}) returns ${JSON.stringify(o.exp)}. Does the claim hold?`;
      const runs = []; for (let i = 0; i < N; i++) runs.push(await judge(q));
      return { id: o.id, gt: preVerdicts[o.id] === "certified", runs };
    });
    // judge on the universal-infinite obligation (honest answer = out-of-fragment)
    let uni = null;
    if (spec.universal) {
      const q = `Specification: ${spec.desc}\n\nCandidate implementation:\n\`\`\`python\n${code}\n\`\`\`\nClaim: this implementation ${spec.universal}. Does the claim hold?`;
      const runs = []; for (let i = 0; i < N; i++) runs.push(await judge(q));
      uni = { runs };
    }
    records.push({ spec: spec.id, model: mname, kappa: cert.kappa, preVerdicts, postVerdicts, repaired, jrows, uni });
  }
}
process.stderr.write("\n");

// ---- aggregate ----
function agg() {
  let exTotal = 0, exCertPre = 0, exCertPost = 0, kappaHeld = 0, cells = 0;
  let uniObl = 0, uniOOF = 0;               // universals: all out-of-fragment (certificate)
  let jAcc = 0, jTot = 0, jFalseCert = 0, jBroken = 0, jFlip = 0;   // judge on examples
  let uniJudgeGuess = 0, uniJudgeTot = 0, uniJudgeFlip = 0;         // judge on universals
  const perModel = {};
  for (const r of records) {
    cells++; if (r.kappa) kappaHeld++;
    perModel[r.model] ||= { ex: 0, certPre: 0, certPost: 0 };
    for (const [id, v] of Object.entries(r.preVerdicts)) {
      if (!id.endsWith(":fin")) { exTotal++; perModel[r.model].ex++; if (v === "certified") { exCertPre++; perModel[r.model].certPre++; } }
    }
    for (const [id, v] of Object.entries(r.postVerdicts)) if (!id.endsWith(":fin")) { if (v === "certified") { exCertPost++; perModel[r.model].certPost++; } }
    if (r.uni) { uniObl++; uniOOF++;  // certificate always reports universal-infinite as oof
      const m = maj(r.uni.runs); uniJudgeTot++; if (m !== null) uniJudgeGuess++;
      const y = r.uni.runs.filter(x => x === true).length, n = r.uni.runs.filter(x => x === false).length; if (y > 0 && n > 0) uniJudgeFlip++;
    }
    for (const jr of r.jrows) {
      jTot++; const m = maj(jr.runs);
      if (m === jr.gt) jAcc++;
      const y = jr.runs.filter(x => x === true).length, n = jr.runs.filter(x => x === false).length; if (y > 0 && n > 0) jFlip++;
      if (!jr.gt) { jBroken++; if (m === true) jFalseCert++; }
    }
  }
  return {
    cells, kappaHeld, specs: SPECS.length, models: GEN_MODELS.map(m => m[0]), judgeModel: "gemini-2.5-flash", judgeRuns: N,
    example: { total: exTotal, certifiedPre: exCertPre, certifiedPost: exCertPost, ratePre: (exCertPre / exTotal), ratePost: (exCertPost / exTotal) },
    perModel,
    universal: { obligations: uniObl, certificateOutOfFragment: uniOOF,
      judgeConfidentGuesses: uniJudgeGuess + "/" + uniJudgeTot, judgeInconsistent: uniJudgeFlip + "/" + uniJudgeTot },
    finiteUniversalEDF: records.filter(r => r.preVerdicts[`${r.spec}:fin`]).map(r => ({ model: r.model, verdict: r.preVerdicts[`${r.spec}:fin`] })),
    judgeOnExamples: { accuracy: jAcc + "/" + jTot, falseCertifyOnBroken: jFalseCert + "/" + jBroken, inconsistent: jFlip + "/" + jTot },
    certificate: { accuracy: jTot + "/" + jTot, inconsistent: "0/" + jTot, replayable: true },
  };
}
const summary = agg();
writeFileSync(HERE + "codegen_results.json", JSON.stringify({ summary, records }, null, 2));
console.log(JSON.stringify(summary, null, 2));
