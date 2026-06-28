import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="textarea"
    className={cn(
      "flex min-h-24 w-full rounded-lg border border-white-200 bg-transparent px-4 py-3 text-sm",
      "placeholder:text-gray-400 dark:placeholder:text-gray-600 text-gray-1200",
      "transition-colors duration-200 outline-none resize-y",
      "focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30",
      "disabled:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed",
      "aria-invalid:border-error-500 aria-invalid:focus-visible:ring-error-500/30",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
