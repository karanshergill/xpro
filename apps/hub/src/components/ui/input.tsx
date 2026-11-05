import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

export function Input({ className, ...props }: ComponentProps<"input">): React.JSX.Element {
  return <InputPrimitive data-slot="input" className={twMerge(
    "min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive",
    className,
  )} {...props} />;
}
