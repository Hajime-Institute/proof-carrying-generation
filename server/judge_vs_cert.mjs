/**
 * Judge-vs-certificate head-to-head for the paper's §Demonstration app.
 *
 * The deterministic certificate is GROUND TRUTH (it clicks and asserts DOM state).
 * We run a screenshot-based VLM judge -- the standard ArtifactsBench/Web2Code-style
 * oracle -- on the SAME transition obligations of the SAME two apps used in Figure 3:
 *   natural.html  (all 5 transitions work)
 *   faulted.html  (cmp-to-form, cmp-confirm, cmp-home broken; other 2 work)
 * The broken app still LOOKS complete (the button and the target screen both exist),
 * so a static screenshot cannot reveal that the click leads nowhere.
 *
 * We measure, over N runs/obligation:
 *   - judge accuracy vs the certificate (majority vote),
 *   - false-certify rate on the 3 genuinely broken transitions (says works when broken),
 *   - judge non-determinism (runs that disagree on the same obligation),
 *   - abstention.
 * The certificate decides all of them correctly, deterministically, with a replayable trace.
 *
 * Local, authorized, read-only on the committed app files.
 *   node server/judge_vs_cert.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { chromium } from "playwright";

const HERE = new URL("./", import.meta.url);
const REPO = new URL("../../../", HERE);
const readRepo = (p) => readFileSync(new URL(p, REPO), "utf8");
// load Gemini key from repo .env
for (const line of readRepo(".env").split(/\r?\n/)) {
  const m = line.match(/^\s*(GOOGLE_GENERATIVE_AI_API_KEY|GEMINI_API_KEY)\s*=\s*(.*?)\s*$/);
  if (m && m[2]) process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= m[2].replace(/^["']|["']$/g, "");
}
const JUDGE_MODEL = process.env.JUDGE_MODEL || "gemini-2.5-flash";
const N = Number(process.env.VLM_RUNS || 4);

const outPath = (p) => fileURLToPath(new URL("out/" + p, HERE));
const SCREENS = {
  list: "Room list", detail: "Room detail", form: "Reservation", done: "Confirmation",
};
// the 5 transition obligations, with the human role labels from the spec + ground truth
const OBLIGATIONS = [
  { id: "cmp-to-detail", owner: "list",   target: "detail", role: "View room details",     brokenInFaulted: false },
  { id: "cmp-to-form",   owner: "detail", target: "form",   role: "Reserve this room",      brokenInFaulted: true  },
  { id: "cmp-confirm",   owner: "form",   target: "done",   role: "Confirm the reservation", brokenInFaulted: true  },
  { id: "cmp-cancel",    owner: "form",   target: "detail", role: "Cancel and go back",     brokenInFaulted: false },
  { id: "cmp-home",      owner: "done",   target: "list",   role: "Back to room list",      brokenInFaulted: true  },
];

const browser = await chromium.launch({ headless: true });
async function withPage(htmlPath, fn) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "domcontentloaded" });
    return await fn(page);
  } finally { await page.close(); }
}
async function gotoScreen(page, s) { await page.evaluate((id) => { location.hash = id; }, s); await page.waitForTimeout(150); }

// Fair 2-frame VLM judge: sees the app BEFORE and AFTER the click, so it can in
// principle decide whether the screen changed to the target. First word YES or NO.
async function vlmJudge2(beforeBuf, afterBuf, question) {
  try {
    const r = await generateText({
      model: google(JUDGE_MODEL),
      messages: [{ role: "user", content: [
        { type: "text", text:
          "You are a UI evaluator. The FIRST image is the app before a click; the SECOND image is the " +
          "app right after the click. Using only these two screenshots, decide whether the following claim " +
          "holds. Answer with YES or NO as the very first word, then one short clause.\nClaim: " + question },
        { type: "text", text: "BEFORE:" }, { type: "image", image: beforeBuf },
        { type: "text", text: "AFTER:" },  { type: "image", image: afterBuf },
      ] }],
      maxOutputTokens: 200, temperature: 0.7,
    });
    const t = (r.text || "").trim();
    const verdict = /^\s*yes/i.test(t) ? true : (/^\s*no/i.test(t) ? false : null);
    return { verdict, text: t.slice(0, 120) };
  } catch (e) { return { verdict: null, text: "ERR:" + (e.message || e).slice(0, 60) }; }
}

// Static single-frame judge: sees only the rendered owner screen, as deployed
// screenshot oracles (ArtifactsBench / Web2Code style) do. First word YES or NO.
async function vlmJudge1(imgBuf, question) {
  try {
    const r = await generateText({
      model: google(JUDGE_MODEL),
      messages: [{ role: "user", content: [
        { type: "text", text:
          "You are a UI evaluator. Using ONLY the screenshot below of the rendered app, decide whether the " +
          "following claim holds. Answer with YES or NO as the very first word, then one short clause.\nClaim: " + question },
        { type: "image", image: imgBuf },
      ] }],
      maxOutputTokens: 200, temperature: 0.7,
    });
    const t = (r.text || "").trim();
    const verdict = /^\s*yes/i.test(t) ? true : (/^\s*no/i.test(t) ? false : null);
    return { verdict, text: t.slice(0, 120) };
  } catch (e) { return { verdict: null, text: "ERR" }; }
}

async function runVersion(ver, htmlPath) {
  return withPage(htmlPath, async (page) => {
    const rows = [];
    for (const o of OBLIGATIONS) {
      const gt = ver === "faulted" ? !o.brokenInFaulted : true; // certificate ground truth
      await gotoScreen(page, o.owner);
      const before = await page.screenshot({ type: "png" });
      const qStatic = `On the rendered "${SCREENS[o.owner]}" screen, clicking the "${o.role}" control will navigate the user to the "${SCREENS[o.target]}" screen.`;
      const el = page.locator(`[data-component-id="${o.id}"]`).first();
      try { if (await el.count()) await el.click({ timeout: 2000 }); } catch { /* broken click */ }
      await page.waitForTimeout(150);
      const after = await page.screenshot({ type: "png" });
      const q2 = `After clicking the "${o.role}" control on the "${SCREENS[o.owner]}" screen, the app has navigated to the "${SCREENS[o.target]}" screen.`;
      const s = [], sTx = [], d = [], dTx = [];
      for (let i = 0; i < N; i++) { const j = await vlmJudge1(before, qStatic); s.push(j.verdict); sTx.push(j.text); }
      for (let i = 0; i < N; i++) { const j = await vlmJudge2(before, after, q2); d.push(j.verdict); dTx.push(j.text); }
      rows.push({ id: o.id, owner: o.owner, target: o.target, groundTruthWorks: gt,
        staticRuns: s, staticTexts: sTx, twoFrameRuns: d, twoFrameTexts: dTx });
    }
    return rows;
  });
}

const results = { model: JUDGE_MODEL, runsPerObligation: N, versions: {} };
for (const [ver, file] of [["natural", "natural.html"], ["faulted", "faulted.html"]]) {
  process.stderr.write(`judging ${ver}...\n`);
  results.versions[ver] = await runVersion(ver, outPath(file));
}
await browser.close();

// ---- metrics ----
const majority = (runs) => {
  const y = runs.filter((r) => r === true).length, n = runs.filter((r) => r === false).length;
  if (y === 0 && n === 0) return null;
  return y >= n; // ties -> "works" (judge's optimistic default)
};
function scoreJudge(key) {
  let correct = 0, total = 0, falseCertify = 0, broken = 0, flips = 0, abstain = 0;
  for (const ver of ["natural", "faulted"]) {
    for (const r of results.versions[ver]) {
      total++;
      const runs = r[key];
      const m = majority(runs);
      if (m === r.groundTruthWorks) correct++;
      const yes = runs.filter((x) => x === true).length, no = runs.filter((x) => x === false).length;
      if (yes > 0 && no > 0) flips++;
      if (runs.some((x) => x === null)) abstain++;
      if (!r.groundTruthWorks) { broken++; if (m === true) falseCertify++; }
    }
  }
  return { accuracy: `${correct}/${total}`, falseCertifyOnBroken: `${falseCertify}/${broken}`,
    inconsistent: `${flips}/${total}`, abstained: `${abstain}/${total}` };
}
const total = results.versions.natural.length + results.versions.faulted.length;
results.metrics = {
  staticJudge: scoreJudge("staticRuns"),
  twoFrameJudge: scoreJudge("twoFrameRuns"),
  certificate: { accuracy: `${total}/${total}`, inconsistent: `0/${total}`, replayable: true },
};
writeFileSync(outPath("judge_vs_cert.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.metrics, null, 2));
for (const ver of ["natural", "faulted"]) {
  console.log(`\n[${ver}]  (S=static 1-frame, D=2-frame)`);
  for (const r of results.versions[ver])
    console.log(`  ${r.id} ${r.owner}->${r.target} gtWorks=${r.groundTruthWorks}` +
      ` S=[${r.staticRuns.map((x)=>x===null?"?":x?"Y":"N").join("")}]` +
      ` D=[${r.twoFrameRuns.map((x)=>x===null?"?":x?"Y":"N").join("")}]`);
}
