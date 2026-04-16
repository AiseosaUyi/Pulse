export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-background">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-accent-purple to-accent-pink bg-clip-text text-transparent italic">
              PULSE
            </span>
          </h1>
          <p className="mt-2 text-sm text-text-muted">Marketing command center</p>
        </div>
        {children}
      </div>
    </div>
  );
}
