// Contentful's gruveBlog.question field enforces a 12-30 char length (a
// content-model constraint — see publish-to-gruve.ts's questionLengthError).
// Shared, dependency-free constants so both the server action (which can
// only export async functions under "use server") and the client-side
// readiness checklist (blog-writer/[id]/client.tsx) validate against the
// same numbers instead of duplicating/drifting magic values.

export const QUESTION_MIN = 12;
export const QUESTION_MAX = 30;
