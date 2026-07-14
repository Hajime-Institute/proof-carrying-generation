#!/usr/bin/env python3
"""
Deterministic test harness = the code-generation analogue of the paper's
headless UI harness [[.]]. It loads a generated Python module in an isolated
subprocess (this process), checks the INTERFACE CONTRACT (kappa: each required
function name resolves to exactly one callable), and executes each obligation,
emitting a per-obligation verdict with a replayable witness/counterexample.

  certified  : example call returns the spec-declared value (witness = the call)
  refuted    : example call returns something else / raises (counterexample kept)
  (out-of-fragment universals are labelled by the caller, never executed here)

For finite-universal obligations the harness ENUMERATES the whole finite domain
(the executably-decidable case of the frontier theorem) and certifies iff every
point matches, else refutes with the first counterexample.

Usage: python3 harness.py <code.py> <checks.json>   -> prints JSON to stdout
No network, no argv-driven eval; deterministic given the same code + checks.
"""
import sys, json, importlib.util, io, contextlib, traceback

def load_module(path):
    spec = importlib.util.spec_from_file_location("gen_mod", path)
    mod = importlib.util.module_from_spec(spec)
    # suppress any stray prints from the generated module
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(mod)
    return mod

def call(fn, args):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn(*args)

def main():
    code_path, checks_path = sys.argv[1], sys.argv[2]
    checks = json.load(open(checks_path))
    out = {"kappa": True, "kappaMissing": [], "results": []}

    # Load module; a syntax/import error is a total contract failure.
    try:
        mod = load_module(code_path)
    except Exception as e:
        out["kappa"] = False
        out["loadError"] = f"{type(e).__name__}: {e}".splitlines()[0][:160]
        for c in checks["checks"]:
            out["results"].append({"id": c["id"], "kind": c["kind"],
                                   "verdict": "refuted", "detail": "module failed to load"})
        print(json.dumps(out)); return

    # Interface contract kappa: every required function name is a callable.
    for fname in checks["requiredFuncs"]:
        if not hasattr(mod, fname) or not callable(getattr(mod, fname)):
            out["kappa"] = False
            out["kappaMissing"].append(fname)

    for c in checks["checks"]:
        fid, kind, fname = c["id"], c["kind"], c["func"]
        if fname in out["kappaMissing"]:
            out["results"].append({"id": fid, "kind": kind, "verdict": "refuted",
                                   "detail": f"contract violation: {fname} not defined"})
            continue
        fn = getattr(mod, fname)
        if kind == "example":
            try:
                got = call(fn, c["args"])
                if got == c["expected"]:
                    out["results"].append({"id": fid, "kind": kind, "verdict": "certified",
                                           "detail": f"{fname}({c['args']}) == {c['expected']!r}"})
                else:
                    out["results"].append({"id": fid, "kind": kind, "verdict": "refuted",
                                           "detail": f"{fname}({c['args']}) -> {got!r}, expected {c['expected']!r}"})
            except Exception as e:
                out["results"].append({"id": fid, "kind": kind, "verdict": "refuted",
                                       "detail": f"raised {type(e).__name__}: {str(e)[:80]}"})
        elif kind == "finite_universal":
            # enumerate the whole finite domain; certified iff all match
            cex = None
            for args, exp in zip(c["domain"], c["expected"]):
                try:
                    got = call(fn, args)
                except Exception as e:
                    cex = f"{fname}({args}) raised {type(e).__name__}"; break
                if got != exp:
                    cex = f"{fname}({args}) -> {got!r}, expected {exp!r}"; break
            if cex is None:
                out["results"].append({"id": fid, "kind": kind, "verdict": "certified",
                                       "detail": f"all {len(c['domain'])} points of the finite domain hold"})
            else:
                out["results"].append({"id": fid, "kind": kind, "verdict": "refuted", "detail": cex})
        else:
            out["results"].append({"id": fid, "kind": kind, "verdict": "error",
                                   "detail": f"unknown kind {kind}"})
    print(json.dumps(out))

if __name__ == "__main__":
    main()
