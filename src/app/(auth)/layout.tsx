import { Logo } from "@/components/ui/Logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-white-50 dark:bg-background">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <Logo size="lg" />
        </div>
        {children}
      </div>
    </div>
  );
}
