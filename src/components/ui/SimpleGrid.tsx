// GRUVE-DESIGN.md §13: "SimpleGrid handles 1/2/3/4/5/6 responsive columns.
// Reach for it before writing a bespoke grid-cols-*." Referenced by the
// design doc but didn't exist in this repo yet — added here as the shared
// primitive rather than hand-rolling grid-cols-* per region.
//
// Tailwind's JIT scanner needs static class strings, not
// `grid-cols-${n}` template literals, hence the lookup maps.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ColCount = 1 | 2 | 3 | 4 | 5 | 6;

const BASE_COLS: Record<ColCount, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

const MD_COLS: Record<ColCount, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
  6: "md:grid-cols-6",
};

const LG_COLS: Record<ColCount, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

const GAP: Record<number, string> = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
};

export function SimpleGrid({
  cols = 1,
  colsMd,
  colsLg,
  gap = 3,
  children,
  className,
}: {
  /** Columns below the `md:` breakpoint (mobile-first default). */
  cols?: ColCount;
  /** Columns at `md:` (768px) and up — omit to inherit `cols`. */
  colsMd?: ColCount;
  /** Columns at `lg:` (1024px) and up — omit to inherit `colsMd`/`cols`. */
  colsLg?: ColCount;
  gap?: keyof typeof GAP;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid",
        BASE_COLS[cols],
        colsMd && MD_COLS[colsMd],
        colsLg && LG_COLS[colsLg],
        GAP[gap],
        className
      )}
    >
      {children}
    </div>
  );
}
