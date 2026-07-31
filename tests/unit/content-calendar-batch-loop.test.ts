import { describe, it, expect, vi, beforeEach } from "vitest";

// Exercises generateNextBatchApi itself — the self-correcting
// generate -> validate (deterministic + judge) -> regenerate-only-rejected
// loop in src/lib/services/content-calendar.ts. Its pieces (judge, dedup,
// year-check, pillar rotation) each already have their own unit tests, but
// the loop that wires them together had none.

const getContentCalendarConfigMock = vi.fn();
vi.mock("@/lib/content-calendar/config", () => ({
  getContentCalendarConfig: (...args: unknown[]) => getContentCalendarConfigMock(...args),
}));

const retireStaleSlotsMock = vi.fn().mockResolvedValue(undefined);
const getNextPositionMock = vi.fn().mockResolvedValue(0);
const getNextScheduledDateMock = vi.fn().mockResolvedValue("2026-08-01");
vi.mock("@/lib/services/content-calendar-lifecycle", () => ({
  retireStaleSlots: (...args: unknown[]) => retireStaleSlotsMock(...args),
  getNextPosition: (...args: unknown[]) => getNextPositionMock(...args),
  getNextScheduledDate: (...args: unknown[]) => getNextScheduledDateMock(...args),
  todayIso: () => "2026-07-31",
  rowToSlot: (row: unknown) => row,
}));

const fetchTrendCandidatesMock = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/scrape/trend-pull", () => ({
  fetchTrendCandidates: (...args: unknown[]) => fetchTrendCandidatesMock(...args),
}));

const selectTopicsBatchMock = vi.fn();
const generateBriefingMock = vi.fn();
vi.mock("@/lib/ai/content-calendar", () => ({
  selectTopic: vi.fn(),
  selectTopicsBatch: (...args: unknown[]) => selectTopicsBatchMock(...args),
  generateBriefing: (...args: unknown[]) => generateBriefingMock(...args),
}));

const judgeCandidatesMock = vi.fn();
vi.mock("@/lib/ai/content-calendar-judge", () => ({
  judgeCandidates: (...args: unknown[]) => judgeCandidatesMock(...args),
}));

const { generateNextBatchApi } = await import("@/lib/services/content-calendar");

const FAKE_BRIEF = {
  whyItMatters: "It matters.",
  talkingPoints: ["Point one"],
  stat: null,
  statSourceUrl: null,
  contrarianAngle: null,
  referenceLinks: [],
  noReferencesFound: true,
  creatorExamples: [],
  noCreatorExamplesFound: true,
  pillar: null,
  format: null,
};

function candidate(title: string, pillar: string, index: number) {
  return { topicTitle: title, searchQuery: title, pillar, format: "how_to", index };
}

function makeAdmin(opts: {
  existingOpenSlots?: Array<{ topic_title: string; topic_brief: unknown }>;
  recentHistorySlots?: Array<{ topic_title: string }>;
}) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const admin = {
    from(table: string) {
      if (table !== "content_slots") throw new Error(`unexpected table: ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                in(_col: string, statuses: string[]) {
                  const isOpenQuery = statuses.includes("assigned");
                  const data = isOpenQuery ? opts.existingOpenSlots ?? [] : opts.recentHistorySlots ?? [];
                  return Object.assign(Promise.resolve({ data, error: null }), {
                    order() {
                      return { limit: () => Promise.resolve({ data, error: null }) };
                    },
                  });
                },
              };
            },
          };
        },
        insert(rows: Array<Record<string, unknown>>) {
          insertedRows.push(...rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { admin, insertedRows };
}

describe("generateNextBatchApi — self-correcting batch loop", () => {
  beforeEach(() => {
    getContentCalendarConfigMock.mockReset();
    retireStaleSlotsMock.mockClear();
    getNextPositionMock.mockClear().mockResolvedValue(0);
    getNextScheduledDateMock.mockClear().mockResolvedValue("2026-08-01");
    fetchTrendCandidatesMock.mockReset().mockResolvedValue([]);
    selectTopicsBatchMock.mockReset();
    generateBriefingMock.mockReset().mockResolvedValue(FAKE_BRIEF);
    judgeCandidatesMock.mockReset();
  });

  it("generates a full batch in one round when everything passes first try", async () => {
    getContentCalendarConfigMock.mockResolvedValue({
      niches: ["Design"],
      interestTags: ["AI"],
      postsPerDay: 1,
      recentFeedback: [],
    });
    selectTopicsBatchMock.mockResolvedValue([
      candidate("Redesigning My Morning Routine With AI", "Design", 0),
      candidate("How I Prototype Ideas Overnight", "Design", 1),
    ]);
    judgeCandidatesMock.mockImplementation(async ({ candidates }: { candidates: Array<{ index: number }> }) =>
      candidates.map((c) => ({ index: c.index, pass: true, reason: "" }))
    );
    const { admin, insertedRows } = makeAdmin({});

    const result = await generateNextBatchApi(admin as never, "t1", "user-1", 2);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.generated).toBe(2);
    expect(result.roundsUsed).toBe(1);
    expect(result.rejected).toEqual([]);
    expect(result.missingPillars).toEqual([]);
    expect(judgeCandidatesMock).toHaveBeenCalledTimes(1);
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0].status).toBe("assigned");
    expect(insertedRows[0].created_by).toBe("user-1");
  });

  it("regenerates only the judge-rejected slot, passing a correction note, and succeeds on round 2", async () => {
    getContentCalendarConfigMock.mockResolvedValue({
      niches: ["Design"],
      interestTags: ["AI"],
      postsPerDay: 1,
      recentFeedback: [],
    });
    selectTopicsBatchMock.mockImplementation(async (input: { correctionNotes: Array<string | undefined> }) =>
      input.correctionNotes[0]
        ? [candidate("Good Topic", "Design", 0)]
        : [candidate("Bad Topic", "Design", 0)]
    );
    judgeCandidatesMock.mockImplementation(async ({ candidates }: { candidates: Array<{ index: number; title: string }> }) =>
      candidates.map((c) => ({
        index: c.index,
        pass: c.title !== "Bad Topic",
        reason: c.title === "Bad Topic" ? "reads like company marketing" : "",
      }))
    );
    const { admin } = makeAdmin({});

    const result = await generateNextBatchApi(admin as never, "t1", "user-1", 1);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.generated).toBe(1);
    expect(result.roundsUsed).toBe(2);
    expect(result.rejected).toEqual([
      { round: 1, pillar: "Design", title: "Bad Topic", reason: "reads like company marketing" },
    ]);
    // Second selectTopicsBatch call must have received the correction note
    // from the first round's rejection, not a blank slate.
    const secondCallInput = selectTopicsBatchMock.mock.calls[1][0];
    expect(secondCallInput.correctionNotes[0]).toContain("Bad Topic");
    expect(secondCallInput.correctionNotes[0]).toContain("reads like company marketing");
  });

  it("rejects a near-duplicate deterministically without ever calling the judge", async () => {
    getContentCalendarConfigMock.mockResolvedValue({
      niches: ["Design"],
      interestTags: ["AI"],
      postsPerDay: 1,
      recentFeedback: [],
    });
    let call = 0;
    selectTopicsBatchMock.mockImplementation(async () => {
      call++;
      return call === 1
        ? [candidate("Existing Same Topic", "Design", 0)]
        : [candidate("Totally Different New Topic", "Design", 0)];
    });
    judgeCandidatesMock.mockImplementation(async ({ candidates }: { candidates: Array<{ index: number }> }) =>
      candidates.map((c) => ({ index: c.index, pass: true, reason: "" }))
    );
    const { admin } = makeAdmin({
      existingOpenSlots: [{ topic_title: "Existing Same Topic", topic_brief: null }],
    });

    const result = await generateNextBatchApi(admin as never, "t1", "user-1", 1);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.generated).toBe(1);
    expect(result.roundsUsed).toBe(2);
    // Round 1's duplicate never reached the judge — only round 2's fresh
    // candidate did.
    expect(judgeCandidatesMock).toHaveBeenCalledTimes(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain("near-duplicate");
  });

  it("drops a slot that never passes within MAX_ROUNDS while keeping ones that did", async () => {
    getContentCalendarConfigMock.mockResolvedValue({
      niches: ["Design", "Video"],
      interestTags: ["AI"],
      postsPerDay: 1,
      recentFeedback: [],
    });
    selectTopicsBatchMock.mockImplementation(
      async (input: { assignedPillars: string[] }) =>
        input.assignedPillars.map((pillar, i) => candidate(`${pillar} idea`, pillar, i))
    );
    judgeCandidatesMock.mockImplementation(async ({ candidates }: { candidates: Array<{ index: number; pillar: string }> }) =>
      candidates.map((c) => ({
        index: c.index,
        // The Design slot always passes; the Video slot never does.
        pass: c.pillar === "Design",
        reason: c.pillar === "Video" ? "off-lane" : "",
      }))
    );
    const { admin } = makeAdmin({});

    const result = await generateNextBatchApi(admin as never, "t1", "user-1", 2);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.generated).toBe(1);
    expect(result.roundsUsed).toBe(5); // MAX_ROUNDS
    expect(result.missingPillars).toEqual(["Video"]);
    expect(result.rejected.every((r) => r.pillar === "Video")).toBe(true);
    expect(result.rejected).toHaveLength(5);
  });

  it("fails the whole batch when every candidate is rejected every round", async () => {
    getContentCalendarConfigMock.mockResolvedValue({
      niches: ["Design"],
      interestTags: ["AI"],
      postsPerDay: 1,
      recentFeedback: [],
    });
    selectTopicsBatchMock.mockResolvedValue([candidate("Always Bad", "Design", 0)]);
    judgeCandidatesMock.mockResolvedValue([{ index: 0, pass: false, reason: "off-lane" }]);
    const { admin } = makeAdmin({});

    const result = await generateNextBatchApi(admin as never, "t1", "user-1", 1);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("Every candidate this batch failed quality validation");
    expect(generateBriefingMock).not.toHaveBeenCalled();
  });

  it("stops early and keeps whatever was already accepted when a later round's batch call throws", async () => {
    getContentCalendarConfigMock.mockResolvedValue({
      niches: ["Design", "Video"],
      interestTags: ["AI"],
      postsPerDay: 1,
      recentFeedback: [],
    });
    let round = 0;
    selectTopicsBatchMock.mockImplementation(async (input: { assignedPillars: string[] }) => {
      round++;
      if (round === 2) throw new Error("upstream timeout");
      return input.assignedPillars.map((pillar, i) => candidate(`${pillar} idea`, pillar, i));
    });
    judgeCandidatesMock.mockImplementation(async ({ candidates }: { candidates: Array<{ index: number; pillar: string }> }) =>
      candidates.map((c) => ({ index: c.index, pass: c.pillar === "Design", reason: c.pillar === "Video" ? "off-lane" : "" }))
    );
    const { admin } = makeAdmin({});

    const result = await generateNextBatchApi(admin as never, "t1", "user-1", 2);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.generated).toBe(1);
    expect(result.roundsUsed).toBe(2);
    expect(result.missingPillars).toEqual(["Video"]);
    // Round 2 threw before any further selectTopicsBatch calls could happen.
    expect(selectTopicsBatchMock).toHaveBeenCalledTimes(2);
  });
});
