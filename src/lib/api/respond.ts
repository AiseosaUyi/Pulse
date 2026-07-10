// Consistent response shapes for /api/v1/*: every error is `{error}`
// (optionally `{error, issues}` for validation failures), every
// paginated list is `{data, nextCursor}`.

import { NextResponse } from "next/server";
import type { ZodIssue } from "zod";

export function apiError(
  status: number,
  message: string,
  headers: Record<string, string>,
  issues?: ZodIssue[]
) {
  return NextResponse.json(
    issues ? { error: message, issues } : { error: message },
    { status, headers }
  );
}

export function apiOk<T extends object>(
  body: T,
  headers: Record<string, string>,
  status = 200
) {
  return NextResponse.json(body, { status, headers });
}

export function apiPaginated<T>(
  data: T[],
  nextCursor: string | null,
  headers: Record<string, string>
) {
  return NextResponse.json({ data, nextCursor }, { status: 200, headers });
}

/** Clamps `?limit=`/`?offset=` query params to sane bounds. */
export function readPagination(searchParams: URLSearchParams): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number(searchParams.get("limit"));
  const rawOffset = Number(searchParams.get("offset"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 25;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}
