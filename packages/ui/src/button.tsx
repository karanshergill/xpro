import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

export const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
  { variants: { variant: {
    default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border-border bg-background text-foreground hover:bg-muted",
  } }, defaultVariants: { variant: "default" } },
);

export function Button({ className, variant, ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>): React.JSX.Element {
  return <ButtonPrimitive data-slot="button" className={(state) => twMerge(buttonVariants({ variant }), typeof className === "function" ? className(state) : className)} {...props} />;
}
