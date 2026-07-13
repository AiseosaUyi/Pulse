import { describe, it, expect } from "vitest";
import { verifyCodeChallenge } from "@/lib/oauth/pkce";

// verifier "test-verifier-abc123" -> base64url(sha256(verifier)), computed
// independently via node:crypto to avoid the test trivially re-deriving
// the same logic it's testing.
const VERIFIER = "test-verifier-abc123";
const CHALLENGE = "bXBLt3MVJIrJDn8hIXjWTQ9nEXDIxEt4Inp4cd5BiOA";

describe("verifyCodeChallenge", () => {
  it("accepts a matching S256 verifier/challenge pair", () => {
    expect(verifyCodeChallenge(VERIFIER, CHALLENGE, "S256")).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    expect(verifyCodeChallenge("wrong-verifier", CHALLENGE, "S256")).toBe(false);
  });

  it("rejects a wrong challenge", () => {
    expect(verifyCodeChallenge(VERIFIER, "not-the-real-challenge", "S256")).toBe(false);
  });

  it("rejects the plain method (only S256 is supported)", () => {
    expect(verifyCodeChallenge(VERIFIER, VERIFIER, "plain")).toBe(false);
  });

  it("rejects an unknown method", () => {
    expect(verifyCodeChallenge(VERIFIER, CHALLENGE, "unknown")).toBe(false);
  });
});
