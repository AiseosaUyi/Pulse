import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full",
    "[font-family:'Satoshi-900',var(--font-sans)]",
    "transition duration-300 cursor-pointer shrink-0 relative",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-'])]:size-4",
    "outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700",
        outline:
          "border border-solid border-primary-500 bg-transparent text-primary-500 hover:border-primary-600 hover:text-primary-600 hover:bg-primary-50 active:border-primary-700 active:text-primary-700 active:bg-primary-100",
        tertiary:
          "border border-solid border-white-200 bg-transparent text-gray-1000 hover:border-gray-400 hover:text-gray-1200 hover:bg-gray-50 active:border-gray-500 active:bg-gray-100",
        ghost:
          "bg-transparent text-gray-1200 hover:bg-gray-50 hover:text-gray-1200",
        destructive:
          "bg-error-500 text-white hover:bg-error-500/90 active:bg-error-500/80",
        unstyled:
          "bg-transparent border-none p-0 h-auto [font-family:'Satoshi',var(--font-sans)]",
      },
      size: {
        xl: "h-14 px-8 text-lg leading-6 has-[>svg]:px-4",
        default:
          "h-10 md:h-11 px-6 md:px-10 py-2 md:py-3 text-base leading-6 has-[>svg]:px-3",
        sm: "h-9 px-4 text-sm leading-5 has-[>svg]:px-2.5",
        xs: "h-7 px-3 text-xs leading-4 has-[>svg]:px-2",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
