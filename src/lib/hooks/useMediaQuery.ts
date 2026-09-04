"use client";

import { useEffect, useState } from "react";

// Never touches `window` during render (only inside the effect, which runs
// post-hydration) — matches===false on first client render always equals
// the SSR render, so this can never itself cause a hydration mismatch. The
// tradeoff is a one-tick layout swap after mount on desktop, which is the
// standard, accepted behavior for this pattern (same as react-responsive).
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
