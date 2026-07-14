/**
 * The canonical demo specification for the live faithfulness certificate.
 *
 * A meeting-room reservation flow: list -> detail -> form -> done.
 * 4 screens, 6 components (5 navigation + 1 non-navigation), which yields exactly
 *   4 reachability + 5 transition + 1 out-of-fragment = 10 behavioral obligations,
 * i.e. the grounded "9 certified / 0 refuted / 1 out-of-fragment" headline once
 * the naturally generated app honors the ID contract.
 *
 * The UI is generated in ENGLISH so the figures are legible to an international
 * audience. Every navigation component is a plain hash link
 * (<a href="#target">) so the transition is executably decidable by a single
 * click, with no validation gate.
 */

export const SCREENS = [
  { id: "list",   name: "Room list",    about: "Browse available meeting rooms" },
  { id: "detail", name: "Room detail",  about: "Capacity, equipment, availability" },
  { id: "form",   name: "Reservation",  about: "Enter date/time, organizer, purpose" },
  { id: "done",   name: "Confirmation", about: "Reservation number and confirmation" },
];

export const COMPONENTS = [
  { id: "cmp-to-detail", owner: "list",   role: "View room details",       action: "click to open detail", target: "detail" },
  { id: "cmp-to-form",   owner: "detail", role: "Reserve this room",       action: "click to open form",   target: "form"   },
  { id: "cmp-confirm",   owner: "form",   role: "Confirm the reservation", action: "click to finish",      target: "done"   },
  { id: "cmp-cancel",    owner: "form",   role: "Cancel and go back",      action: "click to go to detail", target: "detail" },
  { id: "cmp-home",      owner: "done",   role: "Back to room list",       action: "click to go to list",  target: "list"   },
  { id: "cmp-guideline", owner: "form",   role: "Usage notes (display only)", action: "static text",       target: null     }, // non-nav -> out-of-fragment
];

export const CANONICAL_INSTRUCTION =
  "Build a meeting-room reservation app. From a list of rooms the user opens a room's detail, then a reservation form to enter date/time, organizer and purpose, and confirming shows a completion screen. Use English for all UI text.";

/** Render the structured specification as the Markdown the generator consumes. */
export function specMarkdown() {
  const screenRows = SCREENS.map((s) => `| ${s.id} | ${s.name} | ${s.about} |`).join("\n");
  const compRows = COMPONENTS.map(
    (c) => `| ${c.id} | ${c.owner} | ${c.role} | ${c.action} | ${c.target ?? "(none)"} |`
  ).join("\n");
  return [
    "# Meeting-room reservation — prototype generation specification",
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
    "- form: date/time and organizer are required (show a notice before completing if empty). The prototype's screen navigation itself is done with links.",
  ].join("\n");
}

/** Structured view of the spec's behavioral obligations (what the certificate must decide). */
export function obligationsOf() {
  const reach = SCREENS.map((s) => ({ kind: "reachability", id: s.id, owner: null, target: s.id }));
  const trans = COMPONENTS.filter((c) => c.target).map((c) => ({
    kind: "transition", id: c.id, owner: c.owner, target: c.target,
  }));
  const oof = COMPONENTS.filter((c) => !c.target).map((c) => ({
    kind: "transition", id: c.id, owner: c.owner, target: null,
  }));
  return { reach, trans, oof, total: reach.length + trans.length + oof.length };
}
