/**
 * Generation backend for the demo issuer (single-shot SDK backend: Gemini via
 * the Vercel AI SDK). Mirrors the production 10min-proto generation path.
 *
 * Exposes:
 *   deriveSpec(instruction)                   free-form prompt -> structured spec
 *   specMarkdownFor(spec)                     structured spec -> Markdown the generator consumes
 *   generateHtml(specMd)                      NL-spec -> single self-contained HTML
 *   repairHtml(specMd, currentHtml, cex)      counterexample-driven minimal repair
 * All honor the ID contract: data-screen-id / data-component-id + hash routing.
 * The generated UI is in English (legible figures for an international audience).
 */
import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";

const REPO = new URL("../../../../", import.meta.url); // papers/01/server/lib -> repo root
const readRepo = (rel) => readFileSync(new URL(rel, REPO), "utf8");

// Load the Gemini key from the repo .env if not already in the environment.
(function loadEnv() {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return;
  try {
    for (const line of readRepo(".env").split(/\r?\n/)) {
      const m = line.match(/^\s*(GOOGLE_GENERATIVE_AI_API_KEY|GEMINI_API_KEY)\s*=\s*(.*?)\s*$/);
      if (m && m[2]) { process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= m[2].replace(/^["']|["']$/g, ""); }
    }
  } catch { /* .env optional */ }
})();

export const MODEL = process.env.PCG_MODEL || "gemini-3.5-flash";
export const BASE_HTML = readRepo("src/templates/index.html");

const DESIGN_RULES = [
  "- DESIGN QUALITY IS CRITICAL: the result must look like a polished, venture-grade SaaS product, not a wireframe. Use TailwindCSS (CDN), Font Awesome (CDN), and the Inter font (Google Fonts CDN; fall back to system-ui).",
  "- Design system: light background (white / slate-50) with ONE saturated accent color that fits the domain; generous whitespace; rounded-2xl cards with soft layered shadows and subtle 1px borders; a slim sticky top bar with a small logomark + app name; uppercase tracked micro-labels for sections; tabular numbers.",
  "- List screens: page header (large title + one-line subtitle), then rich cards or an elegant table with hover states, status badges, icons/avatars and key metadata. Detail screens: a hero card (large title, meta chips, info grid) and a prominent accent CTA. Forms: clean labeled inputs with visible focus rings, helper text, and one strong primary action. Completion screens: a centered success card with a large check icon, the reference number in a mono chip, and a summary list.",
  "- Micro-polish: consistent spacing rhythm, hover/active transitions (transition duration-150), icon+text pairing on buttons, no placeholder lorem ipsum anywhere.",
  "- Embed 4-6 realistic sample records appropriate to the domain (names, dates, numbers). Real photos from Unsplash (images.unsplash.com) are fine for thumbnails/heroes. Write ALL UI text in English. External dependencies allowed: Tailwind CDN, Font Awesome CDN, Google Fonts, and Unsplash images.",
];

const CONTRACT_RULES = [
  "Requirements (strict):",
  '- Put data-screen-id="<screenId>" on each screen root element; show only "list" initially. Keep the base hash-routing JS unchanged.',
  '- Do every screen transition with an <a href="#<targetScreenId>"> link.',
  '- Put data-component-id="<componentId>" on each main component root element.',
  '- Navigation components (including cmp-confirm) MUST be <a href="#<target>"> links that navigate immediately on click (this is a prototype: do not block navigation with validation).',
  ...DESIGN_RULES,
].join("\n");

// STRICT-SEMANTICS variant: the prototype guardrails (immediate <a href> navigation,
// no validation gating) are dropped, so the generator is free to behave like a real
// app — e.g. gate form/payment transitions behind validation. Whatever it gates,
// the certificate refutes NATURALLY (no injection).
const STRICT_RULES = [
  "Requirements (strict):",
  '- Put data-screen-id="<screenId>" on each screen root element; show only the first screen initially. Keep the base hash-routing JS unchanged.',
  '- Put data-component-id="<componentId>" on each main component root element.',
  "- Wire up every screen transition declared in the spec.",
  "- Respect the spec's validation and error behavior as a real application would.",
  ...DESIGN_RULES,
].join("\n");

async function gen(prompt, maxOutputTokens = 16384, opts = {}) {
  // The venue/booth network can drop connections intermittently: retry connect-level
  // failures with backoff on top of the SDK's own retries.
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, 1500 * attempt));
    try {
      const r = await generateText({
        model: google(MODEL),
        messages: [{ role: "user", content: prompt }],
        maxOutputTokens,
        temperature: 0.25,
        ...(opts.think === false
          ? { providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } } }
          : {}),
      });
      const t = (r.text || "").trim();
      if (!t) throw new Error("empty completion (output token budget likely consumed)");
      const fenced = t.match(/```(?:html|json)?\s*([\s\S]*?)```/i);
      return fenced ? fenced[1].trim() : t;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/**
 * Derive a structured, certifiable specification from a free-form instruction.
 * This is the spec-writer stage of the production pipeline: the output is the
 * artifact the certificate is later checked AGAINST, so it must stay inside the
 * executably decidable fragment (hash-linkable screens, click-to-navigate
 * components, at most one display-only component for the out-of-fragment case).
 */
export async function deriveSpec(instruction) {
  const prompt = [
    "You are the specification stage of a prototype generator. Turn the user's app request into a small, executable screen specification.",
    "Output ONLY a JSON object (no prose, no code fence) with exactly this shape:",
    '{ "title": "Short app name", "screens": [{"id","name","about"}], "components": [{"id","owner","role","action","target"}] }',
    "Rules (strict):",
    "- 3 to 5 screens. ids are short lowercase kebab-case nouns (e.g. list, detail, form, done). The FIRST screen is the entry screen.",
    "- 5 to 7 components. ids start with 'cmp-'. owner is the screen the component lives on.",
    "- Navigation components have target = an existing screen id and action = a short click description. Every screen except the first must be the target of at least one component, and every screen must have a way onward or back (no dead ends).",
    "- Include EXACTLY ONE display-only component with target = null (a note, hint, or guideline block).",
    "- All names/roles/summaries in English, regardless of the request's language. Keep it faithful to the user's request.",
    "User request:",
    instruction,
  ].join("\n");
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await gen(attempt ? prompt + "\n\nYour previous output was invalid: " + lastErr + "\nOutput corrected JSON only." : prompt, 8192, { think: false });
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      const spec = JSON.parse(m ? m[0] : raw);
      validateSpec(spec);
      return spec;
    } catch (e) { lastErr = String(e.message || e); }
  }
  throw new Error("could not derive a valid specification: " + lastErr);
}

function validateSpec(spec) {
  if (!spec || typeof spec.title !== "string" || !Array.isArray(spec.screens) || !Array.isArray(spec.components))
    throw new Error("missing title/screens/components");
  if (spec.screens.length < 2 || spec.screens.length > 6) throw new Error("need 2-6 screens");
  const ids = new Set();
  for (const s of spec.screens) {
    if (!s.id || !/^[a-z][a-z0-9-]*$/.test(s.id)) throw new Error(`bad screen id ${s.id}`);
    if (ids.has(s.id)) throw new Error(`duplicate screen id ${s.id}`);
    ids.add(s.id);
    s.name = String(s.name || s.id); s.about = String(s.about || s.name);
  }
  const cids = new Set();
  let nonNav = 0;
  for (const c of spec.components) {
    if (!c.id || !/^cmp-[a-z0-9-]+$/.test(c.id)) throw new Error(`bad component id ${c.id}`);
    if (cids.has(c.id)) throw new Error(`duplicate component id ${c.id}`);
    cids.add(c.id);
    if (!ids.has(c.owner)) throw new Error(`component ${c.id} owner ${c.owner} is not a screen`);
    if (c.target != null && !ids.has(c.target)) throw new Error(`component ${c.id} target ${c.target} is not a screen`);
    if (c.target == null) nonNav++;
    c.role = String(c.role || c.id); c.action = String(c.action || "click");
  }
  if (spec.components.length < 3 || spec.components.length > 9) throw new Error("need 3-9 components");
  if (nonNav !== 1) throw new Error(`need exactly 1 display-only (target:null) component, got ${nonNav}`);
}

/** Render a structured spec as the Markdown the generator consumes (mirrors lib/spec.mjs). */
export function specMarkdownFor(spec) {
  const screenRows = spec.screens.map((s) => `| ${s.id} | ${s.name} | ${s.about} |`).join("\n");
  const compRows = spec.components.map(
    (c) => `| ${c.id} | ${c.owner} | ${c.role} | ${c.action} | ${c.target ?? "(none)"} |`
  ).join("\n");
  return [
    `# ${spec.title} — prototype generation specification`,
    "",
    "## Screens",
    "| screenId | name | summary |",
    "| -------- | ---- | ------- |",
    screenRows,
    "",
    "## Main components",
    "| componentId | owning screenId | role | primary action/event | target screen |",
    "| ----------- | --------------- | ---- | -------------------- | ------------- |",
    compRows,
    "",
    "## Validation and error behavior",
    "- required fields show a notice before completing if empty; the prototype's screen navigation itself is done with links.",
  ].join("\n");
}

export async function generateHtml(specMd, opts = {}) {
  const prompt = [
    "Generate a single, polished index.html for the following specification (output HTML code only).",
    specMd, "", opts.strict ? STRICT_RULES : CONTRACT_RULES, "",
    "Base template (keep this routing JS):",
    "```html\n" + BASE_HTML + "\n```",
  ].join("\n");
  return gen(prompt, 32768);
}

export async function repairHtml(specMd, currentHtml, counterexamples) {
  const prompt = [
    "Minimally fix ONLY the reported counterexample defects in the index.html below, then re-output the complete index.html (HTML only). Do not break any other behavior.",
    "## Specification\n" + specMd,
    "## Current index.html\n```html\n" + currentHtml + "\n```",
    "## Counterexamples to fix (obligations the certificate refuted)\n" + counterexamples,
    "", CONTRACT_RULES,
  ].join("\n");
  return gen(prompt, 32768);
}
