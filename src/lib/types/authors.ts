export interface AuthorRecord {
  id: string;
  tenantSlug: string;
  name: string;
  title: string | null;
  bio: string | null;
  imageUrl: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}
