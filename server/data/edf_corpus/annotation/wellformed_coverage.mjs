import { readFileSync } from "fs";
const HERE = new URL("./", import.meta.url);
const gold = JSON.parse(readFileSync(new URL("gold_hidden.json", HERE), "utf8"));
const obls = JSON.parse(readFileSync(new URL("../obligations.json", HERE), "utf8")).allObligations;
const rows = readFileSync(new URL("edf_coverage_responses.csv", HERE), "utf8").split(/\r?\n/).slice(1).filter(Boolean).map(l => {
  const m = [...l.matchAll(/"((?:[^"]|"")*)"/g)].map(x => x[1].replace(/""/g, '"'));
  return { id: m[0], ann: m[1].split("@")[0], edf: m[2] };
});
const byId = {}; for (const r of rows) (byId[r.id] ||= {})[r.ann] = r.edf;
const ids = Object.keys(gold);
const cls = (i) => gold[i].edf ? 1 : 0;
const majH = (i) => { const e = (byId[i].annotator_A === "edf") + (byId[i].annotator_B === "edf"); return e >= 1 ? 1 : 0; }; // majority(>=1 of 2)
const bothH = (i) => (byId[i].annotator_A === "edf" && byId[i].annotator_B === "edf") ? 1 : 0; // strict consensus

// "degenerate": both humans nonedf AND it's a transition whose text has no target predicate
// (empirically the bare-action extractions). We flag by: both-human-nonedf on a transition.
const degen = ids.filter(i => gold[i].kind === "transition" && byId[i].annotator_A === "nonedf" && byId[i].annotator_B === "nonedf");
const wf = ids.filter(i => !degen.includes(i)); // well-formed subset

const pct = (arr, f) => (100 * arr.reduce((a, i) => a + f(i), 0) / arr.length).toFixed(1);
console.log("ALL 153:");
console.log("  classifier EDF:", pct(ids, cls) + "%", "| human majority:", pct(ids, majH) + "%", "| human strict(both):", pct(ids, bothH) + "%");
console.log(`degenerate (bare-action transitions, both humans nonedf): ${degen.length}`);
console.log(`WELL-FORMED (${wf.length}):`);
console.log("  classifier EDF:", pct(wf, cls) + "%", "| human majority:", pct(wf, majH) + "%", "| human strict(both):", pct(wf, bothH) + "%");
// agreement on well-formed
const agreeWF = wf.filter(i => (majH(i) === cls(i))).length;
console.log("  human(majority) vs classifier agreement on well-formed:", agreeWF + "/" + wf.length, "=", (100 * agreeWF / wf.length).toFixed(1) + "%");
