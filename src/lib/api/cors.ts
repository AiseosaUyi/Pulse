// Shared CORS handling for /api/v1/* — same permissive shape already
// duplicated across every /api/ext/* route (harmless for server-to-server
// bearer-token callers). /api/ext/* files keep their own inline copy;
// this is only for the new v1 surface.

import { NextResponse } from "next/server";

export function corsHeaders(methods: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": `${methods}, OPTIONS`,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function corsPreflight(methods: string) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(methods) });
}
