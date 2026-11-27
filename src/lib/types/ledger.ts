export type LedgerKeyType = "DOMAIN" | "EMAIL" | "HANDLE" | "PHONE";
export type LedgerKind = "CONTACTED" | "DROPPED";

export interface OutreachLedgerEntry {
  id: string;
  workspace: string;
  tenantSlug: string;
  keyType: LedgerKeyType;
  key: string;
  kind: LedgerKind;
  reason: string | null;
  runId: string | null;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerAddInput {
  kind: LedgerKind;
  keyType?: LedgerKeyType;
  key?: string;
  domain?: string;
  email?: string;
  handle?: string;
  phone?: string;
  reason?: string;
  runId?: string;
  companyName?: string;
}

export interface LedgerListFilter {
  domains?: string[];
  emails?: string[];
  handles?: string[];
  phones?: string[];
  kind?: LedgerKind;
  runId?: string;
  limit?: number;
}
