/**
 * Controlled, obligation-aligned fault injection for the demo's "not a rubber
 * stamp" step: disable the navigation BEHAVIOR of N chosen components so the
 * certificate has genuine refutations to catch. The certificate should then refute
 * EXACTLY those N transitions (soundness + specificity), each with a replayable
 * counterexample, and one certify-or-repair step should recover them.
 *
 * Two complementary mechanisms (generated apps vary):
 *   1. break the <a href> anchor target (covers link-based navigation), and
 *   2. a capture-phase click blocker for the chosen componentIds (covers
 *      script-driven navigation, e.g. a card whose JS handler sets location.hash).
 *      Injected at the TOP of <head> so it registers before any app script — a
 *      capture listener registered first cannot be preempted by later ones.
 * The DOM anchors (data-component-id) are untouched, so the ID contract κ still
 * holds — the fault is purely behavioral, exactly what the certificate decides.
 */
import { parse } from "node-html-parser";

/**
 * @param {string} html
 * @param {string[]} componentIds  navigation componentIds whose behavior to break
 * @returns {{html:string, hit:string[]}}
 */
export function injectNavFaults(html, componentIds) {
  const root = parse(html);
  const hit = [];
  for (const id of componentIds) {
    // Break the static anchor when the component exists in the markup. Components
    // that the app renders DYNAMICALLY are still faulted by the runtime blocker
    // below (they exist at runtime — κ held on the version being broken), so every
    // requested id counts as injected.
    const el = root.querySelector(`[data-component-id="${id}"]`);
    if (el) {
      const anchor = el.getAttribute("href") != null ? el : el.querySelector("a[href]");
      if (anchor) anchor.setAttribute("href", "#__broken__");
      el.setAttribute("data-fault-injected", "true");
    }
    hit.push(id);
  }
  if (hit.length) {
    const blocker =
      '<script data-fault-injector>(function(){var ids=' + JSON.stringify(hit) +
      ';function block(e){if(!e.target||!e.target.closest)return;' +
      'for(var i=0;i<ids.length;i++){if(e.target.closest(\'[data-component-id="\'+ids[i]+\'"]\')){' +
      'e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();return false;}}}' +
      'window.addEventListener("click",block,true);document.addEventListener("click",block,true);})();' +
      "</scr" + "ipt>";
    const head = root.querySelector("head");
    if (head) head.insertAdjacentHTML("afterbegin", blocker);
    else (root.querySelector("body") || root).insertAdjacentHTML("beforeend", blocker);
  }
  return { html: root.toString(), hit };
}
