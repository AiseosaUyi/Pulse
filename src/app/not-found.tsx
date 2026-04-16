import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h2 className="text-5xl font-extrabold bg-gradient-to-r from-accent-purple to-accent-pink bg-clip-text text-transparent mb-4">
          404
        </h2>
        <p className="text-lg font-semibold text-foreground mb-2">Page not found</p>
        <p className="text-text-secondary text-sm mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex px-4 py-2 bg-accent-purple text-foreground text-sm font-medium rounded-lg hover:bg-accent-purple/90 transition-colors duration-150 active:scale-[0.98]"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
