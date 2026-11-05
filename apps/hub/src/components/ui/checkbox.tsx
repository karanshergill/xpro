import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import { twMerge } from "tailwind-merge";

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props): React.JSX.Element {
  return <CheckboxPrimitive.Root nativeButton render={<button type="button" />} data-slot="checkbox" className={(state) => twMerge(
    "relative flex size-6 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
    typeof className === "function" ? className(state) : className,
  )} {...props}>
    <CheckboxPrimitive.Indicator><CheckIcon aria-hidden="true" className="size-4" /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
