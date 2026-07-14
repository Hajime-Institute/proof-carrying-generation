/**
 * Pilot A / HARD benchmark probe — does the certificate still discriminate once the
 * obligations go BEYOND the (saturated) nav skeleton into the harder EDF kinds?
 *
 * The scaled study found reachability+transition obligations are ~solved for capable
 * models (mid 99%). Here we add the EDF kinds that real apps get wrong and that a
 * screenshot cannot decide:
 *   - GATED transition: submit navigates ONLY after required fields are filled with
 *     valid values (fill -> submit -> target reached).
 *   - VALIDATION:       submit with required fields EMPTY must show an error anchor
 *     AND stay on the screen (empty -> submit -> error visible & no nav).
 *   - EFFECT:           an action mutates observable state (e.g. add-to-cart increments
 *     a data-state-id counter): read state -> click -> state changed as specified.
 * All three are DOM-decidable (in EDF), all three carry a replayable witness, and none
 * is decidable from a static screenshot. The ID contract is extended: required inputs
 * carry data-field-id, validation errors carry data-error-id, mutable state carries
 * data-state-id.
 *
 *   node pilot/A-proof-carrying-ui/hard_bench.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../../../../../", import.meta.url); // repo root (script now lives 5 levels deep)
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
for (const line of read(".env").split(/\r?\n/)) { const m = line.match(/^\s*(GOOGLE_GENERATIVE_AI_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*(.*?)\s*$/); if (m && m[2]) { const n = m[1] === "GEMINI_API_KEY" ? "GOOGLE_GENERATIVE_AI_API_KEY" : m[1]; process.env[n] ||= m[2].replace(/^["']|["']$/g, ""); } }
const baseHtml = read("src/templates/index.html");
mkdirSync("/tmp/hard_bsweep", { recursive: true });

// ---- HARD app specs. Each obligation kind is explicit. ----
// screens: [id, name]
// nav:   [cid, owner, role, target]                         ungated click-to-navigate
// gated: [cid, owner, role, target, [fieldIds...]]          navigates ONLY after those fields are filled valid
// valid: [cid, owner, role, submitCid, errorId, [fieldIds]] empty submit -> errorId visible & stay on owner
// effect:[cid, owner, role, stateId, kind]                  click -> data-state-id=stateId changes (kind: 'increment'|'change')
const APPS = [
  {
    key: "shop", title: "Online Store (cart + checkout)",
    seed: "Apparel store with a working cart and a shipping form. Realistic English product data.",
    screens: [["catalog","Products"],["product","Product"],["cart","Cart"],["shipping","Shipping"],["done","Order Placed"]],
    nav: [
      ["cmp-open-product","catalog","open a product","product"],
      ["cmp-view-cart","catalog","go to cart","cart"],
      ["cmp-back-catalog","product","back to products","catalog"],
      ["cmp-cart-checkout","cart","proceed to checkout","shipping"],
    ],
    effect: [
      ["cmp-add-to-cart","product","add to cart","st-cart-count","increment"],
    ],
    gated: [
      ["cmp-place-order","shipping","place order","done",["fld-name","fld-address","fld-zip"]],
    ],
    valid: [
      ["cmp-place-order-v","shipping","place order (empty)","cmp-place-order","err-shipping",["fld-name","fld-address","fld-zip"]],
    ],
  },
  {
    key: "clinic", title: "Clinic Booking (validated patient form)",
    seed: "Medical appointment booking with a patient-info form that requires name, phone, and insurance id.",
    screens: [["doctors","Doctors"],["slot","Select Time"],["patient","Patient Info"],["confirm","Confirm"],["booked","Booked"]],
    nav: [
      ["cmp-pick-doctor","doctors","choose a doctor","slot"],
      ["cmp-pick-slot","slot","choose a time","patient"],
      ["cmp-confirm-book","confirm","confirm booking","booked"],
      ["cmp-back-slot","patient","back","slot"],
    ],
    gated: [
      ["cmp-patient-next","patient","continue to confirm","confirm",["fld-pname","fld-phone","fld-insurance"]],
    ],
    valid: [
      ["cmp-patient-next-v","patient","continue (empty)","cmp-patient-next","err-patient",["fld-pname","fld-phone","fld-insurance"]],
    ],
  },
  {
    key: "todo", title: "Task Board (stateful add/complete)",
    seed: "A kanban-style task board where adding a task increments an open-count and completing one increments a done-count.",
    screens: [["board","Board"],["newTask","New Task"],["taskDetail","Task"]],
    nav: [
      ["cmp-open-new","board","new task","newTask"],
      ["cmp-open-task","board","open a task","taskDetail"],
      ["cmp-back-board","taskDetail","back to board","board"],
    ],
    effect: [
      ["cmp-complete-task","taskDetail","mark complete","st-done-count","increment"],
    ],
    gated: [
      ["cmp-create-task","newTask","create task","board",["fld-title"]],
    ],
    valid: [
      ["cmp-create-task-v","newTask","create (empty)","cmp-create-task","err-newtask",["fld-title"]],
    ],
  },
  {
    key: "bank", title: "Bank Transfer (amount + balance)",
    seed: "A retail banking app: pick an account, enter a transfer, confirm. Show a running balance that decreases after a transfer.",
    screens: [["accounts","Accounts"],["transfer","New Transfer"],["confirm","Confirm"],["done","Sent"],["history","History"]],
    nav: [
      ["cmp-open-transfer","accounts","new transfer","transfer"],
      ["cmp-open-history","accounts","transaction history","history"],
      ["cmp-confirm-send","confirm","send transfer","done"],
      ["cmp-done-accounts","done","back to accounts","accounts"],
    ],
    effect: [
      ["cmp-apply-transfer","done","(auto) balance updated","st-balance","change"],
    ],
    gated: [
      ["cmp-transfer-next","transfer","review transfer","confirm",["fld-payee","fld-amount"]],
    ],
    valid: [
      ["cmp-transfer-next-v","transfer","review (empty)","cmp-transfer-next","err-transfer",["fld-payee","fld-amount"]],
    ],
  },
  {
    key: "signup", title: "Account Sign-up (multi-field validation)",
    seed: "A SaaS onboarding: create an account with name, email, password, then a workspace, then land in the app.",
    screens: [["landing","Welcome"],["account","Create Account"],["workspace","Workspace"],["ready","Ready"]],
    nav: [
      ["cmp-start","landing","get started","account"],
      ["cmp-enter-app","ready","enter app","workspace"],
    ],
    gated: [
      ["cmp-account-next","account","create account","workspace",["fld-name","fld-email","fld-password"]],
      ["cmp-workspace-next","workspace","create workspace","ready",["fld-wsname"]],
    ],
    valid: [
      ["cmp-account-next-v","account","create (empty)","cmp-account-next","err-account",["fld-name","fld-email","fld-password"]],
      ["cmp-workspace-next-v","workspace","create ws (empty)","cmp-workspace-next","err-workspace",["fld-wsname"]],
    ],
  },
  {
    key: "expense", title: "Expense Report (amount + running total)",
    seed: "An expense reporting tool: list expenses with a running total, add an expense (amount + category required), submit the report.",
    screens: [["list","Expenses"],["add","Add Expense"],["submit","Submit Report"],["submitted","Submitted"]],
    nav: [
      ["cmp-open-add","list","add expense","add"],
      ["cmp-open-submit","list","submit report","submit"],
      ["cmp-confirm-submit","submit","confirm submit","submitted"],
      ["cmp-submitted-list","submitted","back to expenses","list"],
    ],
    effect: [
      ["cmp-save-expense","add","save expense","st-total","change"],
    ],
    gated: [
      ["cmp-expense-next","add","review expense","submit",["fld-amount","fld-category"]],
    ],
    valid: [
      ["cmp-expense-next-v","add","review (empty)","cmp-expense-next","err-expense",["fld-amount","fld-category"]],
    ],
  },
  {
    key: "hotel", title: "Hotel Booking (dates + guest validation)",
    seed: "A hotel booking flow: pick a hotel, choose dates and guests, enter guest info, confirm. Show a nights-count that reflects the stay.",
    screens: [["hotels","Hotels"],["room","Room"],["dates","Dates & Guests"],["guest","Guest Info"],["confirm","Confirm"],["booked","Booked"]],
    nav: [
      ["cmp-open-room","hotels","view a hotel","room"],
      ["cmp-open-dates","room","choose dates","dates"],
      ["cmp-confirm-hotel","confirm","confirm booking","booked"],
      ["cmp-back-hotels","room","back to hotels","hotels"],
    ],
    gated: [
      ["cmp-dates-next","dates","continue to guest info","guest",["fld-checkin","fld-checkout"]],
      ["cmp-guest-next","guest","continue to confirm","confirm",["fld-gname","fld-gemail"]],
    ],
    valid: [
      ["cmp-dates-next-v","dates","continue (empty)","cmp-dates-next","err-dates",["fld-checkin","fld-checkout"]],
      ["cmp-guest-next-v","guest","continue (empty)","cmp-guest-next","err-guest",["fld-gname","fld-gemail"]],
    ],
  },
];

const MODELS = [
  { id: "gpt-5.2",          tier: "frontier-oai",       m: openai("gpt-5.2"), noTemp: true },
  { id: "claude-opus-4-8",  tier: "frontier-anthropic", m: anthropic("claude-opus-4-8"), noTemp: true },
  { id: "gemini-3.5-flash", tier: "frontier-google",    m: google("gemini-3.5-flash"), opts: { providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } } } },
];

function specMarkdown(app) {
  const rows = [];
  for (const [id, o, role, tgt] of app.nav) rows.push([id, o, role, "click", tgt, "navigate on click"]);
  for (const [id, o, role, tgt, fs] of (app.gated || [])) rows.push([id, o, role, "submit", tgt, `navigate to ${tgt} ONLY after required fields (${fs.join(", ")}) are filled; if empty, block and show error`]);
  for (const [id, o, role, st, kind] of (app.effect || [])) rows.push([id, o, role, "click", "-", `mutate state data-state-id="${st}" (${kind})`]);
  const fields = new Set();
  for (const g of (app.gated || [])) g[4].forEach((f) => fields.add(f + "@" + g[1]));
  return [
    `# ${app.title}`, ``, `## Screens`, `| screenId | name |`, `| --- | --- |`,
    ...app.screens.map(([id, nm]) => `| ${id} | ${nm} |`), ``,
    `## Components and obligations`, `| componentId | screen | role | event | target | behavior the certificate will execute |`, `| --- | --- | --- | --- | --- | --- |`,
    ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]} |`), ``,
    `## Required form fields (must carry data-field-id and be \`required\`)`,
    ...[...fields].map((f) => `- ${f.split("@")[0]} on screen ${f.split("@")[1]}`),
    ``, `## Validation`, `- On each form, if required fields are empty and the user submits, show an element with data-error-id="<the screen's error id>" (err-shipping / err-patient / err-newtask) and DO NOT navigate.`,
    `- data-error-id elements must be hidden (display:none or absent) until a failed submit.`,
  ].join("\n");
}

const genPrompt = (app) => [
  `Generate a single production-quality index.html for the spec below. Output HTML only (no prose).`,
  specMarkdown(app), ``,
  `## Design`, `- ${app.seed}`, `- Tailwind (CDN) + Font Awesome, modern real-product look, >=4 concrete English dummy items on list screens. All text ENGLISH.`,
  `## STRICT contract — the certificate executes these, so honor them exactly:`,
  `- Every screen root: data-screen-id="screenId"; switch with hash routing (location.hash / <a href="#screen">). Show only the first screen initially.`,
  `- Every listed component: data-component-id="componentId".`,
  `- Ungated nav components navigate immediately on click.`,
  `- GATED submit components: read the required data-field-id inputs; if any is empty, show the screen's data-error-id element and DO NOT change screen; if all are filled, navigate to the target screen. Implement this with real JS.`,
  `- EFFECT components: clicking must change the text of the data-state-id element as specified (e.g. increment a counter). The counter element must exist with data-state-id and an initial integer.`,
  `- Required inputs carry data-field-id and the required attribute. Single self-contained file, CDN only.`,
  `Base template:\n\`\`\`html\n${baseHtml}\n\`\`\``,
].join("\n");

const cexBrief = (app, V) => Object.entries(V).filter(([, o]) => o.verdict === "refuted").map(([k, o]) => {
  const [kind, cid] = k.split(":");
  if (kind === "reach") return `- Screen "${cid}" is not shown by hash routing; give it data-screen-id="${cid}" and show it on #${cid}.`;
  if (kind === "trans") return `- Clicking data-component-id="${cid}" does not reach its target screen. Make it navigate. (${o.trace})`;
  if (kind === "effect") return `- Clicking data-component-id="${cid}" does not update its data-state-id counter as specified. Wire up the state change. (${o.trace})`;
  if (kind === "valid") return `- Submitting the form with required fields empty does NOT show the data-error-id element and/or navigates anyway. Add real validation that blocks navigation and shows the error. (${o.trace})`;
  if (kind === "gated") return `- After filling the required fields, the submit does not navigate to its target screen. Make a valid submit navigate. (${o.trace})`;
  return `- ${k} refuted: ${o.trace}`;
}).join("\n");
const repairPrompt = (app, html, V) => [
  `Fix ONLY the reported defects in this index.html, then re-output the COMPLETE index.html (HTML only). Keep everything else working and keep every data-screen-id / data-component-id / data-field-id / data-error-id / data-state-id.`,
  `## Spec`, specMarkdown(app),
  `## Defects the certificate found (fix each with real JS behavior)`, cexBrief(app, V),
  `## Current index.html`, "```html\n" + html + "\n```",
].join("\n");

async function genHTML(model, prompt, temp = 0.4) {
  for (let a = 1; a <= 3; a++) {
    try {
      const params = { model: model.m, messages: [{ role: "user", content: prompt }], maxOutputTokens: 32000, maxRetries: 2, ...(model.opts || {}) };
      if (!model.noTemp) params.temperature = temp;
      const r = await generateText(params);
      const t = (r.text || "").trim(); const f = t.match(/```(?:html)?\s*([\s\S]*?)```/i); const h = f ? f[1].trim() : t;
      if (h && h.includes("data-screen-id")) return h;
    } catch (e) { if (a === 3) console.log(`    [gen ${model.id}: ${(e?.message || "").slice(0, 60)}]`); }
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
const fillVal = (fid) => /mail/.test(fid) ? "test@example.com" : /phone|tel/.test(fid) ? "5551234567" : /zip/.test(fid) ? "94105" : /insurance|id|num/.test(fid) ? "INS123456" : "Test Value";

async function goScreen(page, sid) { await page.evaluate((id) => { location.hash = id; }, sid); await page.waitForTimeout(120); }
async function visible(page, sel) { const el = page.locator(sel).first(); return (await el.count()) > 0 && (await el.isVisible()); }

async function certify(app, html) {
  const path = `/tmp/hard_bsweep/_${Math.random().toString(36).slice(2)}.html`; writeFileSync(path, html);
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  const V = {}; // key -> {verdict:'certified'|'refuted', trace}
  const set = (k, ok, trace) => { V[k] = { verdict: ok ? "certified" : "refuted", trace }; };
  try {
    await page.goto(pathToFileURL(path).href, { waitUntil: "domcontentloaded" });
    // reachability
    for (const [sid] of app.screens) { try { await goScreen(page, sid); set(`reach:${sid}`, await visible(page, `[data-screen-id="${sid}"]`), `#${sid} visible`); } catch { set(`reach:${sid}`, false, "err"); } }
    // ungated transitions
    for (const [cid, owner, , tgt] of app.nav) {
      try { await goScreen(page, owner); const el = page.locator(`[data-component-id="${cid}"]`).first();
        if (!(await el.count()) || !(await el.isVisible())) { set(`trans:${cid}`, false, "component not actionable"); continue; }
        await el.click({ timeout: 2500 }); await page.waitForTimeout(160);
        set(`trans:${cid}`, await visible(page, `[data-screen-id="${tgt}"]`), `click ${cid} -> #${tgt}`);
      } catch { set(`trans:${cid}`, false, "err"); }
    }
    // effects
    for (const [cid, owner, , stateId, kind] of (app.effect || [])) {
      try { await goScreen(page, owner);
        const before = await page.locator(`[data-state-id="${stateId}"]`).first().textContent().catch(() => null);
        const el = page.locator(`[data-component-id="${cid}"]`).first();
        if (!(await el.count()) || !(await el.isVisible())) { set(`effect:${cid}`, false, `no ${cid}`); continue; }
        await el.click({ timeout: 2500 }); await page.waitForTimeout(180);
        const after = await page.locator(`[data-state-id="${stateId}"]`).first().textContent().catch(() => null);
        const bN = parseInt((before || "").replace(/\D/g, "")), aN = parseInt((after || "").replace(/\D/g, ""));
        const ok = before != null && after != null && (kind === "increment" ? (aN === bN + 1) : (after !== before));
        set(`effect:${cid}`, ok, `${stateId}: "${before}"->"${after}"`);
      } catch { set(`effect:${cid}`, false, "err"); }
    }
    // validation: empty submit -> error shown & no nav
    for (const [cid, owner, , submitCid, errorId, fields] of (app.valid || [])) {
      try { await goScreen(page, owner);
        for (const f of fields) { try { await page.locator(`[data-field-id="${f}"]`).first().fill(""); } catch {} }
        const el = page.locator(`[data-component-id="${submitCid}"]`).first();
        if (!(await el.count())) { set(`valid:${cid}`, false, `no ${submitCid}`); continue; }
        await el.click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(160);
        const errShown = await visible(page, `[data-error-id="${errorId}"]`);
        const stillHere = await visible(page, `[data-screen-id="${owner}"]`);
        set(`valid:${cid}`, errShown && stillHere, `empty submit: error=${errShown} stayed=${stillHere}`);
      } catch { set(`valid:${cid}`, false, "err"); }
    }
    // gated transition: fill valid -> submit -> target reached
    for (const [cid, owner, , tgt, fields] of (app.gated || [])) {
      try { await goScreen(page, owner);
        for (const f of fields) { try { await page.locator(`[data-field-id="${f}"]`).first().fill(fillVal(f)); } catch {} }
        const el = page.locator(`[data-component-id="${cid}"]`).first();
        if (!(await el.count()) || !(await el.isVisible())) { set(`gated:${cid}`, false, `no ${cid}`); continue; }
        await el.click({ timeout: 2500 }); await page.waitForTimeout(200);
        set(`gated:${cid}`, await visible(page, `[data-screen-id="${tgt}"]`), `fill+submit ${cid} -> #${tgt}`);
      } catch { set(`gated:${cid}`, false, "err"); }
    }
  } finally { await page.close(); }
  return V;
}

const kindOf = (k) => k.split(":")[0];
const summarize = (V) => {
  const by = {}; let cert = 0, ref = 0;
  for (const [k, o] of Object.entries(V)) { const kd = kindOf(k); (by[kd] ||= [0, 0]); if (o.verdict === "certified") { by[kd][0]++; cert++; } else { by[kd][1]++; ref++; } }
  return { cert, ref, total: cert + ref, by };
};

// ============ BEST-OF-N: certificate-ranking vs VLM-judge-ranking ============
// One generator produces N candidates per app (temperature for diversity). We measure
// the BEHAVIORAL satisfaction (certified valid+gated+effect obligations) of the candidate
// selected by (a) the certificate (argmax certified = the verifiable reward), (b) a
// screenshot VLM judge (argmax score), and (c) the mean over N (= expected random pick).
mkdirSync("/tmp/best_of_n", { recursive: true });
const N = Number(process.env.N || 8);
const GEN = { id: "gemini-3.5-flash", m: google("gemini-3.5-flash"), opts: { providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } } } };
const BEH = ["valid", "gated", "effect"]; // the behavioral kinds selection actually moves
const behOf = (s) => BEH.reduce((a, k) => a + (s.by[k] ? s.by[k][0] : 0), 0);
const behTotOf = (s) => BEH.reduce((a, k) => a + (s.by[k] ? s.by[k][0] + s.by[k][1] : 0), 0);

async function shoot(html) {
  const path = `/tmp/best_of_n/_${Math.random().toString(36).slice(2)}.html`; writeFileSync(path, html);
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  let buf = null;
  try { await page.goto(pathToFileURL(path).href, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(350); buf = await page.screenshot({ type: "png" }); }
  catch {} finally { await page.close(); }
  return buf;
}
const judgeModel = google("gemini-2.5-flash");
async function judgeScore(app, buf) {
  if (!buf) return 0;
  const prompt = `You are grading a generated web app against its specification. Based ONLY on this screenshot, score from 0 to 100 how fully the app satisfies the specification below (required screens, components, forms, overall completeness). Answer with ONLY an integer 0-100.\n\n${specMarkdown(app)}`;
  for (let a = 1; a <= 2; a++) {
    try {
      const r = await generateText({ model: judgeModel, maxOutputTokens: 2000,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image", image: buf }] }] });
      const m = (r.text || "").match(/\d{1,3}/); if (m) return Math.min(100, Number(m[0]));
    } catch (e) {}
  }
  return 0;
}

const rows = [];
for (const app of APPS) {
  if (process.env.ONLY_APP && app.key !== process.env.ONLY_APP) continue;
  const cands = [];
  for (let i = 0; i < N; i++) {
    const html = await genHTML(GEN, genPrompt(app), 0.8);
    if (!html) continue;
    const V = await certify(app, html); const s = summarize(V);
    const buf = await shoot(html); const js = await judgeScore(app, buf);
    cands.push({ cert: s.cert, total: s.total, beh: behOf(s), behTot: behTotOf(s), js });
  }
  if (cands.length < 2) { console.log(`  ${app.key}: only ${cands.length} candidates, skip`); continue; }
  const certPick = cands.reduce((a, b) => (b.cert > a.cert ? b : a));   // verifiable-reward selection
  const judgePick = cands.reduce((a, b) => (b.js > a.js ? b : a));      // VLM-judge selection
  const meanBeh = cands.reduce((a, b) => a + b.beh, 0) / cands.length;  // expected random pick
  const behTot = cands[0].behTot;
  const row = { app: app.key, n: cands.length, behTot, certPickBeh: certPick.beh, judgePickBeh: judgePick.beh,
    meanBeh, maxBeh: Math.max(...cands.map((c) => c.beh)), minBeh: Math.min(...cands.map((c) => c.beh)),
    certOfJudgePick: judgePick.cert, jsOfCertPick: certPick.js, allBeh: cands.map((c) => c.beh), allJs: cands.map((c) => c.js) };
  rows.push(row);
  console.log(`  ${app.key.padEnd(8)} behTot=${behTot}  cert-pick=${certPick.beh}  judge-pick=${judgePick.beh}  mean=${meanBeh.toFixed(1)}  (range ${row.minBeh}-${row.maxBeh})`);
  writeFileSync("/tmp/best_of_n/rows.json", JSON.stringify(rows, null, 2));
}
await browser.close();

const behTotSum = rows.reduce((a, r) => a + r.behTot, 0);
const cp = rows.reduce((a, r) => a + r.certPickBeh, 0);
const jp = rows.reduce((a, r) => a + r.judgePickBeh, 0);
const mn = rows.reduce((a, r) => a + r.meanBeh, 0);
console.log("\n==== BEST-OF-" + N + " behavioral satisfaction (valid+gated+effect) ====");
console.log(`random (mean-of-N): ${mn.toFixed(1)}/${behTotSum} = ${(100 * mn / behTotSum).toFixed(0)}%`);
console.log(`VLM-judge pick:     ${jp}/${behTotSum} = ${(100 * jp / behTotSum).toFixed(0)}%`);
console.log(`certificate pick:   ${cp}/${behTotSum} = ${(100 * cp / behTotSum).toFixed(0)}%`);
console.log(`certificate vs judge: +${(100 * (cp - jp) / behTotSum).toFixed(0)} pp ;  vs random: +${(100 * (cp - mn) / behTotSum).toFixed(0)} pp`);
writeFileSync("./best_of_n_results.json", JSON.stringify({ N, generator: GEN.id, judge: "gemini-2.5-flash", rows, agg: { behTotSum, certPick: cp, judgePick: jp, mean: mn } }, null, 2));
