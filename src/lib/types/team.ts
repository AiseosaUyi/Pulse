export interface WeeklyTargets {
  eventsCreated?: number;
  conversations?: number;
  reachOuts?: number;
  organicDms?: number;
  [key: string]: number | undefined;
}

export interface TeamMemberRecord {
  id: string;
  tenantSlug: string;
  name: string;
  role: string;
  active: boolean;
  weeklyTargets: WeeklyTargets;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreboardMetrics {
  messagesSent: number;
  repliesReceived: number;
  callsBooked: number;
  eventsCreated: number;
  targets: WeeklyTargets;
}
