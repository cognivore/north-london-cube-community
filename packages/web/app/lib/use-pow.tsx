/**
 * usePow — fetch + solve a proof-of-work challenge in the browser, then expose
 * the solution so an auth <Form> can submit it as hidden fields. Re-solves
 * whenever `retrigger` changes (e.g. after a submit consumes the challenge).
 *
 * SSR-safe: during server render `solving` is true and there is no solution,
 * so the submit button renders disabled; the effect runs only in the browser.
 */
import { useEffect, useState } from "react";
import { fetchChallenge, solvePow, type PowSolution } from "./pow";

export interface PowState {
  solution: PowSolution | null;
  vpnHint: boolean;
  solving: boolean;
  error: string | null;
}

export function usePow(retrigger?: unknown): PowState {
  const [state, setState] = useState<PowState>({
    solution: null, vpnHint: false, solving: true, error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, solving: true, error: null }));
    (async () => {
      try {
        const ch = await fetchChallenge();
        const sol = await solvePow(ch);
        if (!cancelled) setState({ solution: sol, vpnHint: ch.vpnHint, solving: false, error: null });
      } catch {
        if (!cancelled) {
          setState({
            solution: null, vpnHint: false, solving: false,
            error: "Couldn't complete the anti-spam check — please reload the page.",
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [retrigger]);

  return state;
}

/** Hidden form fields carrying the PoW solution (no-op when unsolved). */
export function PowFields({ solution }: { solution: PowSolution | null }) {
  return (
    <>
      <input type="hidden" name="powId" value={solution?.id ?? ""} />
      <input type="hidden" name="powNonce" value={solution?.nonce ?? ""} />
    </>
  );
}
