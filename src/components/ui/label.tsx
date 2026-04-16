import * as React from "react";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    data-slot="label"
    className={cn(
      "block text-sm font-medium text-gray-1200 mb-2 [font-family:'Satoshi-500',var(--font-sans)]",
      className
    )}
    {...props}
  />
));
Label.displayName = "Label";
