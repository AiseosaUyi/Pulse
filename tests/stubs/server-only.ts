// Test stub for the `server-only` package. In Next it throws if imported from
// a client bundle; under vitest (node) it's a harmless no-op so server modules
// (e.g. brevo.ts, cadence/digest.ts) can be imported in unit/integration tests.
export {};
