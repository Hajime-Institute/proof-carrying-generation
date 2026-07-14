/**
 * Fleiss' kappa across the 5 judge models on the 21 off-EDF universal obligations
 * (reviewer ③ augmentation). Reads judge_sweep_results.json (byObl: key -> {judge: majority}).
 * A low kappa on questions that have a definite specification answer is the quantitative
 * form of "the judges are guessing."
 *   node compute_fleiss.mjs
 */
import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync(new URL("./judge_sweep_results.json", import.meta.url), "utf8"));
const { byObl } = d, judges = d.summary.judges, items = Object.keys(byObl);

let sumPi = 0, nUsed = 0, totalRatings = 0; const col = { yes: 0, no: 0 };
for (const k of items) {
  const v = judges.map((j) => byObl[k][j]).filter((x) => x === true || x === false);
  if (v.length < 2) continue;
  const y = v.filter((x) => x === true).length, n = v.length - y, ni = v.length;
  sumPi += (y * y + n * n - ni) / (ni * (ni - 1));
  nUsed++; col.yes += y; col.no += n; totalRatings += ni;
}
const Pbar = sumPi / nUsed;
const Pe = (col.yes / totalRatings) ** 2 + (col.no / totalRatings) ** 2;
const kappa = (Pbar - Pe) / (1 - Pe);
console.log(`judges: ${judges.length}  items: ${nUsed}`);
console.log(`mean observed agreement Pbar = ${Pbar.toFixed(3)}`);
console.log(`chance agreement Pe = ${Pe.toFixed(3)}`);
console.log(`Fleiss kappa = ${kappa.toFixed(3)}  (0.21-0.40 fair, 0.41-0.60 moderate)`);
console.log(`cross-model split: ${d.summary.crossModel.obligationsWhereJudgesSplit}`);
