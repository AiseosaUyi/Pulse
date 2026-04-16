import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  as?: "h1" | "span";
  className?: string;
}

const sizes = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-4xl",
};

// Flat maroon in light mode; purple→pink gradient in dark mode.
export function Logo({ size = "md", as: Tag = "h1", className }: LogoProps) {
  return (
    <Tag
      className={cn(
        "font-extrabold italic tracking-tight leading-none",
        sizes[size],
        className
      )}
    >
      <span
        className={cn(
          "inline-block",
          "text-primary-500",
          "dark:bg-gradient-to-r dark:from-accent-purple dark:to-accent-pink",
          "dark:bg-clip-text dark:text-transparent"
        )}
      >
        PULSE
      </span>
    </Tag>
  );
}
