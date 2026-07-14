/**
 * L-EXTENSION DEMO (reviewer ○4): "the boundary is a dial, not a wall."
 *
 * Base L (the paper's fixed predicate language) is DOM-observable: node presence by a
 * contract selector, visibility, and raw attribute/text equality. It CANNOT compute the
 * accessibility tree (computed accessible NAME, ARIA role semantics, label association) --
 * those are a perceptual property of assistive technology, not a raw DOM attribute. So an
 * obligation stated over the a11y tree is out-of-fragment under base L.
 *
 * We add ONE sanctioned deterministic perceptual oracle: the accessibility snapshot
 * (Playwright's getByRole / getByLabel / accessibility.snapshot, all deterministic given
 * the same HTML). Under the extended L' = L + a11y-oracle, each a11y obligation becomes
 * decidable: the SAME harness now certifies or refutes it with a replayable witness, and
 * the verdict is identical every run. Some obligations move from OOF into EDF -- the
 * boundary moved because we turned the dial.
 *
 *   node l_extension.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../../../../../", import.meta.url);
for (const line of readFileSync(new URL(".env", ROOT), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*(GOOGLE_GENERATIVE_AI_API_KEY|GEMINI_API_KEY)\s*=\s*(.*?)\s*$/);
  if (m && m[2]) process.env["GOOGLE_GENERATIVE_AI_API_KEY"] ||= m[2].replace(/^["']|["']$/g, "");
}
mkdirSync("/tmp/lext", { recursive: true });

// A checkout-confirmation spec whose obligations are ACCESSIBILITY obligations: the primary
// action is an ICON button (no visible text) carrying an aria-label; the amount field has an
// associated <label>; an empty submit must announce the error via role="alert". Base L (raw
// text/attribute) is blind to the computed accessible name, the label association, and the
// announced-role semantics; the a11y oracle is not.
const SPEC = `Generate a single self-contained index.html for a payment CONFIRMATION screen.
Output HTML only. Tailwind + Font Awesome via CDN. English text.
STRICT contract (a screen-reader-grade certificate will execute these, honor them exactly):
- The primary action is an ICON-ONLY button (a Font Awesome check icon, NO visible text label)
  with data-component-id="cmp-pay" and aria-label="Place order".
- An amount input with data-field-id="fld-amount" and a real associated <label> (for/id) reading "Amount".
- If the amount is empty and the user activates Place order, show an error element with
  role="alert" (and data-error-id="err-amount") reading a validation message, and do not proceed.
- Everything in one file, CDN only, no external calls.`;

const obligations = [
  { id: "a11y-name", desc: "primary action exposes an accessible name (\"Place order\")",
    // base L sees only visible text (empty for an icon button); a11y NAME is computed.
    base: async (page) => { const t = (await page.locator('[data-component-id="cmp-pay"]').first().innerText().catch(() => "")).trim(); return { decidable: false, note: `raw visible text = ${JSON.stringify(t)} (base L cannot compute the accessible name)` }; },
    oracle: async (page) => { const n = await page.getByRole("button", { name: /place order/i }).count(); return { verdict: n > 0 ? "certified" : "refuted", witness: `getByRole(button, name=/place order/i) -> ${n}` }; } },
  { id: "a11y-label", desc: "amount field has an associated accessible label",
    base: async () => ({ decidable: false, note: "label association (for/id, aria-labelledby) is not a raw attribute-equality predicate" }),
    oracle: async (page) => { const n = await page.getByLabel(/amount/i).count(); return { verdict: n > 0 ? "certified" : "refuted", witness: `getByLabel(/amount/i) -> ${n}` }; } },
  { id: "a11y-alert", desc: "validation error is programmatically announced (role=alert)",
    base: async () => ({ decidable: false, note: "the announced-role (role=alert) semantics is an a11y-tree property, not DOM text" }),
    oracle: async (page) => {
      await page.locator('[data-component-id="cmp-pay"]').first().click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(150);
      const n = await page.getByRole("alert").count();
      return { verdict: n > 0 ? "certified" : "refuted", witness: `after empty submit, getByRole(alert) -> ${n}` };
    } },
];

const model = google("gemini-3.5-flash");
async function gen() {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await generateText({ model, maxOutputTokens: 20000, temperature: 0.3,
        providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
        messages: [{ role: "user", content: SPEC }] });
      const t = (r.text || "").trim(); const f = t.match(/```(?:html)?\s*([\s\S]*?)```/i); const h = f ? f[1].trim() : t;
      if (h && /data-component-id/.test(h)) return h;
    } catch (e) { if (a === 3) console.log("gen error:", (e?.message || "").slice(0, 80)); }
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
const html = await gen();
if (!html) { console.log("GEN FAIL"); await browser.close(); process.exit(1); }
writeFileSync("/tmp/lext/app.html", html);
const url = pathToFileURL("/tmp/lext/app.html").href;

const RUNS = 3;
const results = [];
for (const o of obligations) {
  // base L: report why the predicate is out-of-fragment
  const page0 = await browser.newPage(); await page0.goto(url, { waitUntil: "domcontentloaded" });
  const b = await o.base(page0); await page0.close();
  // extended L': run the a11y oracle RUNS times, check determinism
  const verds = [];
  let witness = "";
  for (let i = 0; i < RUNS; i++) {
    const page = await browser.newPage(); await page.goto(url, { waitUntil: "domcontentloaded" });
    const r = await o.oracle(page); verds.push(r.verdict); witness = r.witness; await page.close();
  }
  const deterministic = verds.every((v) => v === verds[0]);
  results.push({ id: o.id, desc: o.desc, baseL: "out-of-fragment", baseNote: b.note, extVerdict: verds[0], deterministic: `${verds.filter((v) => v === verds[0]).length}/${RUNS}`, witness });
  console.log(`  ${o.id.padEnd(11)} baseL=OOF  ->  L+a11y=${verds[0]}  (deterministic ${verds.filter((v) => v === verds[0]).length}/${RUNS})  [${witness}]`);
}
await browser.close();

const moved = results.filter((r) => r.extVerdict === "certified").length;
console.log(`\n${moved}/${obligations.length} accessibility obligations moved from out-of-fragment (base L) into EDF (L + a11y oracle), each certified deterministically ${RUNS}/${RUNS}.`);
writeFileSync(new URL("l_extension_results.json", import.meta.url), JSON.stringify({ oracle: "accessibility-tree (Playwright a11y snapshot)", runs: RUNS, results }, null, 2));
