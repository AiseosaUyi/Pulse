import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    data-slot="input"
    className={cn(
      "flex h-12 w-full rounded-lg border border-white-200 bg-transparent px-4 py-3 text-sm",
      "placeholder:text-gray-400 dark:placeholder:text-gray-600 text-gray-1200",
      "transition-colors duration-200 outline-none",
      "focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30",
      "disabled:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
      "aria-invalid:border-error-500 aria-invalid:focus-visible:ring-error-500/30",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";
