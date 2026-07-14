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

const B = Number(process.env.REPAIR_BUDGET || 5); // certify-or-repair BUDGET SWEEP
let results = [];
try { results = JSON.parse(readFileSync("/tmp/hard_bsweep/results.json", "utf8")).filter((r) => !r.error); } catch {}
const doneKeys = new Set(results.map((r) => r.app + "/" + r.model));
if (doneKeys.size) console.log(`[resume] ${doneKeys.size} cells already done`);
console.log(`[hard-bench B-sweep] ${APPS.length} apps x ${MODELS.length} models; repair budget B=${B}\n`);
for (const app of APPS) {
  if (process.env.ONLY_APP && app.key !== process.env.ONLY_APP) continue;
  for (const model of MODELS) {
    if (process.env.ONLY_MODEL && model.id !== process.env.ONLY_MODEL) continue;
    if (doneKeys.has(app.key + "/" + model.id)) continue;
    let html = await genHTML(model, genPrompt(app));
    if (!html) { console.log(`  ${app.key}/${model.id}: GEN FAIL`); results.push({ app: app.key, model: model.id, tier: model.tier, error: true }); writeFileSync("/tmp/hard_bsweep/results.json", JSON.stringify(results, null, 2)); continue; }
    let V = await certify(app, html); const s0 = summarize(V);
    // certify-or-repair BUDGET SWEEP: up to B rounds, monotonic accept, record trajectory
    const vcount = (Vx) => Object.entries(Vx).filter(([k, o]) => k.startsWith("valid:") && o.verdict === "certified").length;
    const vtot = Object.keys(V).filter((k) => k.startsWith("valid:")).length;
    const certTraj = [s0.cert], validTraj = [vcount(V)];
    let curS = s0, lastImprove = 0;
    for (let b = 1; b <= B && curS.ref > 0; b++) {
      const fixed = await genHTML(model, repairPrompt(app, html, V), 0.3);
      if (fixed) {
        const V2 = await certify(app, fixed); const s2 = summarize(V2);
        if (s2.cert >= curS.cert) { html = fixed; V = V2; if (s2.cert > curS.cert) lastImprove = b; curS = s2; }
      }
      certTraj.push(curS.cert); validTraj.push(vcount(V));
    }
    const sR = curS;
    writeFileSync(`/tmp/hard_bsweep/${app.key}_${model.id}.html`, html);
    const refs = Object.entries(V).filter(([, o]) => o.verdict === "refuted").map(([k]) => k);
    results.push({ app: app.key, model: model.id, tier: model.tier, certPre: s0.cert, refPre: s0.ref, ...sR, certTraj, validTraj, vtot, lastImprove, budget: B, refuted: refs, V });
    const byStr = Object.entries(sR.by).map(([k, [c, r]]) => `${k} ${c}/${c + r}`).join("  ");
    console.log(`  ${app.key}/${model.id.padEnd(16)} c0=${s0.cert} traj=[${certTraj.join(",")}] valid=[${validTraj.join(",")}]/${vtot} imp@${lastImprove}  [${byStr}]`);
    writeFileSync("/tmp/hard_bsweep/results.json", JSON.stringify(results, null, 2));
  }
  console.log("");
}
await browser.close();

// aggregate by model and by kind
console.log("================ HARD-BENCH SUMMARY ================");
const models = [...new Set(results.map((r) => r.model))];
for (const mid of models) {
  const rs = results.filter((r) => r.model === mid && !r.error);
  const cert = rs.reduce((a, r) => a + r.cert, 0), tot = rs.reduce((a, r) => a + r.total, 0);
  const byKind = {};
  for (const r of rs) for (const [k, [c, rf]] of Object.entries(r.by)) { (byKind[k] ||= [0, 0]); byKind[k][0] += c; byKind[k][1] += c + rf ? (c + rf) : 0; }
  // recompute byKind cleanly
  const bk = {};
  for (const r of rs) for (const [k, o] of Object.entries(r.V)) { (bk[k.split(":")[0]] ||= [0, 0]); if (o.verdict === "certified") bk[k.split(":")[0]][0]++; else bk[k.split(":")[0]][1]++; }
  const bkStr = Object.entries(bk).map(([k, [c, rf]]) => `${k} ${c}/${c + rf}=${Math.round(100 * c / (c + rf))}%`).join("  ");
  console.log(`${mid.padEnd(18)} certified ${cert}/${tot} = ${tot ? Math.round(100 * cert / tot) : 0}%   |  ${bkStr}`);
}
console.log("\nresults -> /tmp/hard_bsweep/results.json ; generated apps -> /tmp/hard_bsweep/*.html");
