// Pure cadence scoring for ticketing platform leads. No I/O.

export type EventCadence = "regular" | "occasional" | "annual" | "just_ran";

export interface CadenceScore {
  cadence: EventCadence;
  reachOutTiming: string;
  priorityScore: number;    // 0-100; higher = reach out sooner
}

export function scoreEventCadence(opts: {
  events90d: number;
  events365d: number;
  lastEventDateIso: string;
}): CadenceScore {
  const { events90d, events365d, lastEventDateIso } = opts;
  const daysSinceLast = Math.floor(
    (Date.now() - new Date(lastEventDateIso).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (events90d >= 3) {
    return {
      cadence: "regular",
      reachOutTiming: "Contact now — active organizer",
      priorityScore: 90,
    };
  }

  // Event happened in the last 14 days — momentum is still live even if
  // this is their only event in 90 days (e.g. quarterly organizers).
  if (daysSinceLast <= 14) {
    return {
      cadence: "just_ran",
      reachOutTiming: "Reach out now while momentum is live",
      priorityScore: 80,
    };
  }

  if (events90d >= 1) {
    return {
      cadence: "occasional",
      reachOutTiming: "Good window — event in last 90 days",
      priorityScore: 65,
    };
  }

  if (events365d >= 1) {
    const nextDate = new Date(lastEventDateIso);
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    const nextMonth = nextDate.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    return {
      cadence: "annual",
      reachOutTiming: `Plan ahead — annual organizer, next event ~${nextMonth}`,
      priorityScore: 40,
    };
  }

  // No events found in 365 days — include but flag as low signal
  return {
    cadence: "annual",
    reachOutTiming: "Low signal — no events found in last year",
    priorityScore: 20,
  };
}
