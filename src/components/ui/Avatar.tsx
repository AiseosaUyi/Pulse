import { cn } from "@/lib/utils";

interface AvatarProps {
  url: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = {
  sm: { wrapper: "w-7 h-7", text: "text-xs" },
  md: { wrapper: "w-9 h-9", text: "text-sm" },
  lg: { wrapper: "w-14 h-14", text: "text-lg" },
};

export function Avatar({ url, name, size = "md", className }: AvatarProps) {
  const { wrapper, text } = sizes[size];
  const initial = (name || "?").charAt(0).toUpperCase();

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        className={cn(
          wrapper,
          "rounded-full object-cover flex-shrink-0 border border-white-200",
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        wrapper,
        text,
        "rounded-full bg-primary-50 text-primary-500 flex items-center justify-center flex-shrink-0",
        "[font-family:'Satoshi-700',var(--font-sans)]",
        className
      )}
    >
      {initial}
    </div>
  );
}
