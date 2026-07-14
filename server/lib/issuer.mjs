/**
 * The faithfulness certificate issuer — deterministic and judge-free.
 *
 * Ports the shipped worker issuer (src/workers/utils/execution_certificate.ts)
 * and the pilot issuer (pilot/A-proof-carrying-ui/issue_certificate.mjs): load the
 * generated HTML in a headless Chromium and, for each behavioral obligation the
 * spec declares, EXECUTE it and assert a DOM-observable fact. No model in the loop;
 * every verdict ships with a replayable witness/counterexample trace.
 *
 * Obligations (from lib/spec.mjs):
 *   - kappa (ID contract): every screenId/componentId resolves to a unique DOM node
 *   - reachability: set hash=#screenId  => [data-screen-id=screenId] visible
 *   - transition:   click [data-component-id=id] => [data-screen-id=target] visible
 * Verdicts: certified | refuted | out-of-fragment.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let _seq = 0;

/**
 * @param {{html:string, screens:Array, components:Array}} input
 * @param {import('playwright').Browser} browser
 */
export async function issueCertificate({ html, screens, components }, browser) {
  const tmp = join(tmpdir(), `pcg_${process.pid}_${_seq++}.html`);
  writeFileSync(tmp, html);
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // kappa: ID contract
  const missingScreens = [], missingComponents = [];
  for (const s of screens) if ((await page.locator(`[data-screen-id="${s.id}"]`).count()) === 0) missingScreens.push(s.id);
  for (const c of components) if ((await page.locator(`[data-component-id="${c.id}"]`).count()) === 0) missingComponents.push(c.id);
  const kappa = { holds: !missingScreens.length && !missingComponents.length, missingScreens, missingComponents };

  const obligations = [];

  // reachability (EDF)
  for (const s of screens) {
    let ok = false;
    try {
      await page.evaluate((id) => { location.hash = id; }, s.id);
      await page.waitForTimeout(150);
      ok = await page.locator(`[data-screen-id="${s.id}"]`).first().isVisible();
    } catch { ok = false; }
    obligations.push({
      kind: "reachability", id: s.id, owner: null, target: s.id,
      verdict: ok ? "certified" : "refuted",
      trace: `set hash=#${s.id}  ⇒  [data-screen-id=${s.id}] visible=${ok}`,
    });
  }

  // transition (EDF) + out-of-fragment
  for (const c of components) {
    if (!c.target) {
      obligations.push({
        kind: "transition", id: c.id, owner: c.owner, target: null,
        verdict: "out-of-fragment",
        trace: "no spec-declared target screen — not executably decidable",
      });
      continue;
    }
    let ok = false, note = "";
    try {
      await page.evaluate((o) => { location.hash = o || ""; }, c.owner);
      await page.waitForTimeout(120);
      const el = page.locator(`[data-component-id="${c.id}"]`).first();
      if ((await el.count()) === 0 || !(await el.isVisible())) {
        note = "component not actionable on its owning screen";
      } else {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(170);
        ok = await page.locator(`[data-screen-id="${c.target}"]`).first().isVisible();
      }
    } catch { ok = false; }
    obligations.push({
      kind: "transition", id: c.id, owner: c.owner, target: c.target,
      verdict: ok ? "certified" : "refuted",
      trace: `click [data-component-id=${c.id}] ⇒ [data-screen-id=${c.target}] visible=${ok}${note ? " (" + note + ")" : ""}`,
    });
  }

  await page.close();
  const summary = tally(obligations, kappa);
  return { kappa, obligations, summary };
}

export function tally(obligations, kappa) {
  const by = (v) => obligations.filter((o) => o.verdict === v).length;
  const reachC = obligations.filter((o) => o.kind === "reachability" && o.verdict === "certified").length;
  const reachT = obligations.filter((o) => o.kind === "reachability").length;
  const transC = obligations.filter((o) => o.kind === "transition" && o.verdict === "certified").length;
  const transT = obligations.filter((o) => o.kind === "transition" && o.target).length;
  return {
    certified: by("certified"), refuted: by("refuted"), outOfFragment: by("out-of-fragment"),
    reach: { certified: reachC, total: reachT },
    transition: { certified: transC, total: transT },
    contractHolds: !!(kappa && kappa.holds),
  };
}

export function refuted(cert) { return cert.obligations.filter((o) => o.verdict === "refuted"); }

/** Turn refuted obligations into a counterexample brief the generator can repair from. */
export function counterexampleBrief(cert) {
  return refuted(cert).map((o) => o.kind === "transition"
    ? `- Clicking [data-component-id="${o.id}"] does not show screen "${o.target}". Fix it minimally so the click navigates to #${o.target} (e.g. an <a href="#${o.target}"> link).`
    : `- Screen "${o.id}" is not shown by hash navigation. Provide a root element with data-screen-id="${o.id}" and show it via hash routing.`
  ).join("\n");
}
