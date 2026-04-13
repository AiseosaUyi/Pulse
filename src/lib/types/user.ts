export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: "admin" | "member" | "viewer";
  tenantIds: string[];
}
