import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { MobileNav } from "@/components/sidebar/MobileNav";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
        {/* Mobile navigation */}
        <MobileNav tenants={tenants} currentTenantSlug={tenantSlug} />

        <div className="flex h-full">
          {/* Desktop sidebar — hidden on mobile */}
          <div className="hidden md:block">
            <Sidebar tenants={tenants} currentTenantSlug={tenantSlug} />
          </div>

          {/* Main content — offset for mobile header */}
          <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
