/**
 * Judge-vs-certificate across FIVE app domains (larger sample than the single
 * reservation app). For each app we generate the HTML, repair to a fully certified
 * natural version, and inject three nav faults. The deterministic certificate is
 * GROUND TRUTH per transition (certified = works, refuted = broken). We then run a
 * screenshot VLM judge on the same transition obligations, natural and injected.
 *
 * Sample: 5 apps x 5 transition obligations x 2 versions = 50 obligations.
 * Metrics per judge (static 1-frame, fair 2-frame): per-obligation accuracy vs the
 * certificate, false-certify on broken, and non-determinism. The certificate is
 * exact and identical every run.
 *
 *   node server/judge_vs_cert_multi.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync as wf } from "node:fs";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { chromium } from "playwright";
import { generateHtml, repairHtml } from "./lib/generator.mjs";
import { issueCertificate, refuted, counterexampleBrief } from "./lib/issuer.mjs";
import { injectNavFaults } from "./lib/faults.mjs";

const JUDGE_MODEL = process.env.JUDGE_MODEL || "gemini-2.5-flash";
const N = Number(process.env.VLM_RUNS || 3);
const outPath = (p) => fileURLToPath(new URL("out/" + p, import.meta.url));

const APPS = [
  { key: "reservation", title: "Meeting-room reservation",
    screens: [["list","Room list"],["detail","Room detail"],["form","Reservation"],["done","Confirmation"]],
    comps: [["cmp-to-detail","list","View room","detail"],["cmp-to-form","detail","Reserve this room","form"],
            ["cmp-confirm","form","Confirm reservation","done"],["cmp-cancel","form","Cancel","detail"],
            ["cmp-home","done","Back to list","list"],["cmp-note","form","Usage notes",null]] },
  { key: "ticket", title: "Support ticket tracker",
    screens: [["list","Ticket list"],["detail","Ticket detail"],["reply","Reply"],["sent","Reply sent"]],
    comps: [["cmp-to-detail","list","Open ticket","detail"],["cmp-to-reply","detail","Write reply","reply"],
            ["cmp-send","reply","Send reply","sent"],["cmp-back","reply","Back to ticket","detail"],
            ["cmp-home","sent","Back to list","list"],["cmp-attach","reply","Attachment hint",null]] },
  { key: "event", title: "Event sign-up",
    screens: [["list","Event list"],["detail","Event detail"],["register","Register"],["confirm","Confirmed"]],
    comps: [["cmp-to-detail","list","View event","detail"],["cmp-to-register","detail","Sign up","register"],
            ["cmp-submit","register","Submit registration","confirm"],["cmp-cancel","register","Cancel","detail"],
            ["cmp-home","confirm","Back to events","list"],["cmp-terms","register","Terms note",null]] },
  { key: "catalog", title: "Product catalog + checkout",
    screens: [["list","Catalog"],["detail","Product"],["cart","Cart"],["order","Order placed"]],
    comps: [["cmp-to-detail","list","View product","detail"],["cmp-to-cart","detail","Add to cart","cart"],
            ["cmp-checkout","cart","Checkout","order"],["cmp-continue","cart","Continue shopping","list"],
            ["cmp-home","order","Back to catalog","list"],["cmp-promo","detail","Promo note",null]] },
  { key: "directory", title: "Contact directory",
    screens: [["list","Contacts"],["detail","Contact"],["edit","Edit contact"],["saved","Saved"]],
    comps: [["cmp-to-detail","list","Open contact","detail"],["cmp-to-edit","detail","Edit","edit"],
            ["cmp-save","edit","Save changes","saved"],["cmp-cancel","edit","Cancel","detail"],
            ["cmp-home","saved","Back to contacts","list"],["cmp-avatar","edit","Avatar note",null]] },
];
function buildSpec(app) {
  const screens = app.screens.map(([id, name]) => ({ id, name, about: name }));
  const comps = app.comps.map(([id, owner, role, target]) => ({ id, owner, role, action: "click", target }));
  const screenRows = screens.map((s) => `| ${s.id} | ${s.name} | ${s.name} |`).join("\n");
  const compRows = comps.map((c) => `| ${c.id} | ${c.owner} | ${c.role} | click | ${c.target ?? "(none)"} |`).join("\n");
  const md = [
    `# ${app.title} — prototype generation specification`, "",
    "## Screens", "| screenId | name | summary |", "| --- | --- | --- |", screenRows, "",
    "## Main components", "| componentId | owning screenId | role | primary action/event | target screen |",
    "| --- | --- | --- | --- | --- |", compRows, "",
    "## Validation and error behavior", "- required fields show a notice; screen navigation itself is done with links.",
  ].join("\n");
  return { md, screens, comps, nameOf: Object.fromEntries(app.screens) };
}

const browser = await chromium.launch({ headless: true });
async function withPageHtml(html, fn) {
  const p = outPath(`_judge_tmp_${Math.random().toString(36).slice(2)}.html`);
  wf(p, html);
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  try { await page.goto(pathToFileURL(p).href, { waitUntil: "domcontentloaded" }); return await fn(page); }
  finally { await page.close(); }
}
async function gotoScreen(page, s) { await page.evaluate((id) => { location.hash = id; }, s); await page.waitForTimeout(150); }
async function judge(imgs, question) {
  const content = [{ type: "text", text:
    (imgs.length === 2
      ? "You are a UI evaluator. The FIRST image is the app before a click; the SECOND is right after the click. "
      : "You are a UI evaluator. Using ONLY the screenshot below of the rendered app, ") +
    "decide whether the claim holds. Answer YES or NO as the very first word.\nClaim: " + question }];
  if (imgs.length === 2) { content.push({ type: "text", text: "BEFORE:" }, { type: "image", image: imgs[0] },
                                        { type: "text", text: "AFTER:" }, { type: "image", image: imgs[1] }); }
  else content.push({ type: "image", image: imgs[0] });
  try {
    const r = await generateText({ model: google(JUDGE_MODEL), messages: [{ role: "user", content }], maxOutputTokens: 200, temperature: 0.7 });
    const t = (r.text || "").trim();
    return /^\s*yes/i.test(t) ? true : (/^\s*no/i.test(t) ? false : null);
  } catch { return null; }
}

const records = [];
for (const app of APPS) {
  const { md, screens, comps, nameOf } = buildSpec(app);
  process.stderr.write(`[${app.key}] generating...\n`);
  let html = await generateHtml(md);
  let c = await issueCertificate({ html, screens, components: comps }, browser);
  let g = 0;
  while (refuted(c).length && g++ < 2) { html = await repairHtml(md, html, counterexampleBrief(c)); c = await issueCertificate({ html, screens, components: comps }, browser); }
  const navIds = comps.filter((x) => x.target).slice(0, 3).map((x) => x.id);
  const { html: fhtml } = injectNavFaults(html, navIds);
  const cf = await issueCertificate({ html: fhtml, screens, components: comps }, browser);
  const gtOf = (cert) => Object.fromEntries(cert.obligations.filter((o) => o.kind === "transition").map((o) => [o.id, o.verdict === "certified"]));
  const gtNat = gtOf(c), gtFau = gtOf(cf);
  for (const [ver, h, gt] of [["natural", html, gtNat], ["faulted", fhtml, gtFau]]) {
    await withPageHtml(h, async (page) => {
      for (const t of comps.filter((x) => x.target)) {
        if (!(t.id in gt)) continue;
        await gotoScreen(page, t.owner);
        const before = await page.screenshot({ type: "png" });
        const el = page.locator(`[data-component-id="${t.id}"]`).first();
        try { if (await el.count()) await el.click({ timeout: 2000 }); } catch {}
        await page.waitForTimeout(150);
        const after = await page.screenshot({ type: "png" });
        const on = nameOf[t.owner] || t.owner, tn = nameOf[t.target] || t.target;
        const qS = `On the rendered "${on}" screen, clicking the "${t.role}" control will navigate to the "${tn}" screen.`;
        const qD = `After clicking the "${t.role}" control on the "${on}" screen, the app has navigated to the "${tn}" screen.`;
        const s = [], d = [];
        for (let i = 0; i < N; i++) s.push(await judge([before], qS));
        for (let i = 0; i < N; i++) d.push(await judge([before, after], qD));
        records.push({ app: app.key, ver, id: t.id, works: gt[t.id], staticRuns: s, twoFrameRuns: d });
      }
    });
  }
  const nn = Object.values(gtNat).filter(Boolean).length, ff = Object.values(gtFau).filter((x) => !x).length;
  process.stderr.write(`  natural works ${nn}/${Object.keys(gtNat).length}, faulted broken ${ff}/${Object.keys(gtFau).length}\n`);
}
await browser.close();

const maj = (runs) => { const y = runs.filter((r) => r === true).length, n = runs.filter((r) => r === false).length; return (y === 0 && n === 0) ? null : y >= n; };
function score(key) {
  let cor = 0, tot = 0, fc = 0, broken = 0, flip = 0;
  for (const r of records) {
    tot++; const m = maj(r[key]);
    if (m === r.works) cor++;
    const y = r[key].filter((x) => x === true).length, n = r[key].filter((x) => x === false).length;
    if (y > 0 && n > 0) flip++;
    if (!r.works) { broken++; if (m === true) fc++; }
  }
  return { accuracy: `${cor}/${tot}`, falseCertifyOnBroken: `${fc}/${broken}`, inconsistent: `${flip}/${tot}` };
}
const out = { model: JUDGE_MODEL, runsPerObligation: N, nObligations: records.length,
  staticJudge: score("staticRuns"), twoFrameJudge: score("twoFrameRuns"),
  certificate: { accuracy: `${records.length}/${records.length}`, inconsistent: `0/${records.length}` }, records };
writeFileSync(outPath("judge_vs_cert_multi.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ nObligations: out.nObligations, staticJudge: out.staticJudge, twoFrameJudge: out.twoFrameJudge, certificate: out.certificate }, null, 2));
