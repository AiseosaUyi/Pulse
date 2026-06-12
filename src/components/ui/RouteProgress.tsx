"use client";

// Global navigation progress bar. App Router doesn't expose router events, so
// we start the bar on any internal link/back-forward navigation and complete
// it when the pathname actually changes. Gives instant "your click registered"
// feedback when moving page to page (e.g. clicking "Open editor").

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function RouteProgress() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const firstRender = useRef(true);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = () => {
    setVisible(true);
    setWidth(12);
  };

  // Start on internal-link clicks + browser back/forward.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (
        a &&
        a.href &&
        a.origin === window.location.origin &&
        a.target !== "_blank" &&
        a.getAttribute("href")?.startsWith("#") !== true &&
        a.pathname !== window.location.pathname
      ) {
        start();
      }
    };
    const onPopState = () => start();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // Trickle toward 90% while pending.
  useEffect(() => {
    if (!visible) return;
    trickle.current = setInterval(() => {
      setWidth((w) => (w < 90 ? w + (90 - w) * 0.1 : w));
    }, 250);
    return () => {
      if (trickle.current) clearInterval(trickle.current);
    };
  }, [visible]);

  // Complete when the destination renders (pathname changed). Defer the
  // fill via rAF so we don't call setState synchronously in the effect body.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const raf = requestAnimationFrame(() => setWidth(100));
    const t = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 280);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-0.5 pointer-events-none">
      <div
        className="h-full bg-primary-500 transition-[width] duration-200 ease-out shadow-[0_0_8px_rgba(173,17,44,0.6)]"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
