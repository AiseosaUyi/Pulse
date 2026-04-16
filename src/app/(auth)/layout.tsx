export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-white-50">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <h1
            className="text-4xl tracking-tight text-gray-1100"
            style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
          >
            PULSE
          </h1>
          <p className="mt-2 text-sm text-gray-1000">A tool of Gruve</p>
        </div>
        {children}
      </div>
    </div>
  );
}
