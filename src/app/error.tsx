"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="w-12 h-12 rounded-full bg-status-red/10 border border-status-red/30 flex items-center justify-center mx-auto mb-4">
          <span className="text-status-red text-xl">!</span>
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Something went wrong
        </h2>
        <p className="text-text-secondary text-sm mb-6">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-accent-purple text-foreground text-sm font-medium rounded-lg hover:bg-accent-purple/90 transition-colors duration-150 active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
