export interface DashboardStats {
  socialReach: StatCardData;
  profileScore: StatCardData;
  activeLeads: StatCardData;
  adSpend: StatCardData;
}

export interface StatCardData {
  label: string;
  value: string;
  subtitle: string;
  change?: {
    value: string;
    direction: "up" | "down" | "neutral";
  };
}

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  impact: "high_impact" | "urgent" | "overdue" | "opportunity";
  targetModule: string;
}
