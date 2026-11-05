import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

const fieldVariants = cva("flex w-full gap-2", { variants: { orientation: {
  vertical: "flex-col", horizontal: "items-start",
} }, defaultVariants: { orientation: "vertical" } });

export function Field({ className, orientation, ...props }: ComponentProps<"div"> & VariantProps<typeof fieldVariants>): React.JSX.Element {
  return <div data-slot="field" className={twMerge(fieldVariants({ orientation }), className)} {...props} />;
}
export function FieldGroup(props: ComponentProps<"div">): React.JSX.Element {
  return <div data-slot="field-group" className="flex flex-col gap-6" {...props} />;
}
export function FieldLabel({ className, ...props }: ComponentProps<"label">): React.JSX.Element {
  return <label data-slot="field-label" className={twMerge("text-sm font-medium leading-6", className)} {...props} />;
}
export function FieldDescription(props: ComponentProps<"p">): React.JSX.Element {
  return <p data-slot="field-description" className="text-start text-sm leading-6 text-muted-foreground" {...props} />;
}
export function FieldError({ children, ...props }: ComponentProps<"p">): React.JSX.Element | null {
  return children ? <p data-slot="field-error" className="text-sm leading-6 text-destructive" {...props}>{children}</p> : null;
}
