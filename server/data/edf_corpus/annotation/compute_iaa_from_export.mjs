/**
 * IAA + coverage validation from a human annotation platform export.
 * The platform (the annotation platform, task `edf_coverage`) exports
 * CSV via /api/export?task=edf_coverage with columns: group_id, annotator, edf, notes, updated_at.
 * This reads that CSV + gold_hidden.json (the rule-based classifier) and reports
 * Fleiss/Cohen kappa among annotators, each annotator vs the classifier, and the
 * human-derived coverage % next to the classifier's 82.4%.
 *
 *   node compute_iaa_from_export.mjs <export.csv>
 */
import { readFileSync } from "node:fs";
const HERE = new URL("./", import.meta.url);
const csvPath = process.argv[2];
if (!csvPath) { console.log("usage: node compute_iaa_from_export.mjs <export.csv>"); process.exit(1); }

// minimal CSV parser (handles quoted fields with commas/newlines)
function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; if (f !== "" || row.length) { row.push(f); rows.push(row); row = []; f = ""; } }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const norm = (s) => { const t = (s || "").trim().toLowerCase(); return t === "edf" ? "edf" : (t === "nonedf" || t === "non-edf") ? "nonedf" : null; };

const rows = parseCSV(readFileSync(csvPath, "utf8"));
const head = rows[0].map((h) => h.trim());
const gi = head.indexOf("group_id"), ai = head.indexOf("annotator"), ei = head.indexOf("edf");
if (gi < 0 || ai < 0 || ei < 0) { console.log("CSV must have columns group_id, annotator, edf. Got:", head.join(", ")); process.exit(1); }

const annots = {}; // name -> {group_id: label}
for (const r of rows.slice(1)) {
  const lab = norm(r[ei]); if (!lab) continue;
  const name = (r[ai] || "").trim(); (annots[name] ||= {})[String(r[gi]).trim()] = lab;
}
const names = Object.keys(annots).filter((n) => Object.keys(annots[n]).length);
if (names.length < 1) { console.log("no usable annotations in export"); process.exit(0); }

const gold = JSON.parse(readFileSync(new URL("gold_hidden.json", HERE), "utf8"));
const IDS = Object.keys(gold);
const goldMap = Object.fromEntries(IDS.map((i) => [i, gold[i].edf ? "edf" : "nonedf"]));
const common = IDS.filter((i) => names.every((n) => annots[n][i]));
console.log(`annotators: ${names.join(", ")}  |  fully-labeled items: ${common.length}/${IDS.length}\n`);

const cohen = (a, b, items) => {
  const cats = ["edf", "nonedf"]; let obs = 0; const p = { edf: 0, nonedf: 0 }, q = { edf: 0, nonedf: 0 };
  for (const i of items) { if (a[i] === b[i]) obs++; p[a[i]]++; q[b[i]]++; }
  const n = items.length, po = obs / n; let pe = 0; for (const c of cats) pe += (p[c] / n) * (q[c] / n);
  return { po, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe) };
};
const fleiss = (raters, items) => {
  const cats = ["edf", "nonedf"], k = raters.length, n = items.length; let sumP = 0; const col = { edf: 0, nonedf: 0 };
  for (const i of items) { const cnt = { edf: 0, nonedf: 0 }; for (const r of raters) cnt[r[i]]++; let pi = 0; for (const c of cats) { pi += cnt[c] * cnt[c]; col[c] += cnt[c]; } sumP += (pi - k) / (k * (k - 1)); }
  const Pbar = sumP / n; let Pe = 0; for (const c of cats) { const pj = col[c] / (n * k); Pe += pj * pj; }
  return { Pbar, kappa: Pe === 1 ? 1 : (Pbar - Pe) / (1 - Pe) };
};

if (names.length >= 2) {
  const fl = fleiss(names.map((n) => annots[n]), common);
  console.log(`Fleiss kappa (humans, ${names.length}): ${fl.kappa.toFixed(3)}  (mean agreement ${fl.Pbar.toFixed(3)})`);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const c = cohen(annots[names[i]], annots[names[j]], common);
    console.log(`  Cohen ${names[i]}-${names[j]}: ${c.kappa.toFixed(3)} (agree ${(100 * c.po).toFixed(1)}%)`);
  }
}
console.log("\nvs rule-based classifier:");
for (const n of names) { const items = IDS.filter((i) => annots[n][i]); const c = cohen(annots[n], goldMap, items); console.log(`  ${n}: kappa ${c.kappa.toFixed(3)} (agree ${(100 * c.po).toFixed(1)}%, n=${items.length})`); }

const maj = {};
for (const i of common) { const e = names.filter((n) => annots[n][i] === "edf").length; maj[i] = e * 2 >= names.length ? "edf" : "nonedf"; }
if (common.length) {
  const mc = cohen(maj, goldMap, common);
  const hEDF = common.filter((i) => maj[i] === "edf").length;
  console.log(`\nMajority-human vs classifier: kappa ${mc.kappa.toFixed(3)} (agree ${(100 * mc.po).toFixed(1)}%)`);
  console.log(`Coverage: classifier ${(100 * IDS.filter((i) => goldMap[i] === "edf").length / IDS.length).toFixed(1)}%  |  majority-human ${(100 * hEDF / common.length).toFixed(1)}% (${common.length} items)`);
  const bk = {};
  for (const i of common) { const k = gold[i].kind; (bk[k] ||= { n: 0, a: 0 }); bk[k].n++; if (maj[i] === goldMap[i]) bk[k].a++; }
  console.log("per kind (majority-human vs classifier):");
  for (const [k, v] of Object.entries(bk).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(26)} ${v.a}/${v.n}`);
}
