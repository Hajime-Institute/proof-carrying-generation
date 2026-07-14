/**
 * Aggregate the B-sweep (reviewer ④): does the validation gap survive 2026 frontier
 * models, and does more repair budget close it? Reads /tmp/hard_bsweep/results.json.
 *   node analyze_bsweep.mjs
 */
import { readFileSync } from "node:fs";
const R = JSON.parse(readFileSync("/tmp/hard_bsweep/results.json", "utf8")).filter((r) => !r.error);
const vc = (r, k) => Object.entries(r.V).filter(([kk, o]) => kk.startsWith(k) && o.verdict === "certified").length;
const vt = (r, k) => Object.keys(r.V).filter((kk) => kk.startsWith(k)).length;

console.log(`cells: ${R.length}\n`);
console.log("per model (post B-sweep):");
const models = [...new Set(R.map((r) => r.model))];
const kinds = ["reach", "trans", "effect", "valid", "gated"];
for (const m of models) {
  const rs = R.filter((r) => r.model === m);
  const cert = rs.reduce((a, r) => a + r.cert, 0), tot = rs.reduce((a, r) => a + r.total, 0);
  const byk = kinds.map((k) => { const c = rs.reduce((a, r) => a + vc(r, k), 0), t = rs.reduce((a, r) => a + vt(r, k), 0); return `${k} ${c}/${t}${t ? "=" + Math.round(100 * c / t) + "%" : ""}`; });
  console.log(`  ${m.padEnd(18)} ${cert}/${tot}=${Math.round(100 * cert / tot)}%  |  ${byk.join("  ")}`);
}

// validation pre-repair (c0 / B=0) vs post (B=5), aggregate
let vPre = 0, vPost = 0, vTot = 0;
for (const r of R) { vTot += vt(r, "valid"); vPost += vc(r, "valid"); vPre += (r.validTraj ? r.validTraj[0] : vc(r, "valid")); }
console.log(`\nVALIDATION aggregate: pre-repair (B=0) ${vPre}/${vTot}=${Math.round(100 * vPre / vTot)}%  ->  post (B=${R[0]?.budget}) ${vPost}/${vTot}=${Math.round(100 * vPost / vTot)}%`);

// how much did the budget help overall (total cert), and per-round recovery
let c0 = 0, cF = 0, improvedCells = 0; const roundHist = {};
for (const r of R) {
  if (!r.certTraj) continue;
  c0 += r.certTraj[0]; cF += r.certTraj[r.certTraj.length - 1];
  if (r.lastImprove > 0) { improvedCells++; roundHist[r.lastImprove] = (roundHist[r.lastImprove] || 0) + 1; }
}
console.log(`TOTAL cert: pre-repair ${c0}  ->  post ${cF}  (+${cF - c0} obligations across ${improvedCells}/${R.length} cells)`);
console.log(`cells' last improving round: ${JSON.stringify(roundHist)}  (so budget beyond that round bought nothing)`);

// validation cells that NEVER closed even at B=max
const stuck = R.filter((r) => vt(r, "valid") > 0 && vc(r, "valid") < vt(r, "valid"));
console.log(`validation still refuted at B=${R[0]?.budget}: ${stuck.reduce((a, r) => a + (vt(r, "valid") - vc(r, "valid")), 0)} obligations in ${stuck.length} cells`);
