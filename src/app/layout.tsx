import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { getTenants } from "@/lib/services/tenants";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PULSE — Gruve Marketing OS",
  description: "Marketing command center for Gruve and portfolio startups",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const tenants = await getTenants();

  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="h-full bg-background text-foreground font-sans antialiased">
        <div className="flex h-full">
          <Sidebar tenants={tenants} currentTenantSlug={tenantSlug} />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
