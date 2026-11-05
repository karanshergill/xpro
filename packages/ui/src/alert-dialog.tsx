import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { twMerge } from "tailwind-merge";

export const AlertDialog = AlertDialogPrimitive.Root;

export function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props): React.JSX.Element {
  return <AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Backdrop data-slot="alert-dialog-overlay" className="fixed inset-0 z-50 bg-foreground/25" />
    <AlertDialogPrimitive.Popup data-slot="alert-dialog-content"
      className={(state) => twMerge("fixed start-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-lg outline-none rtl:translate-x-1/2 sm:p-8",
        typeof className === "function" ? className(state) : className)} {...props} />
  </AlertDialogPrimitive.Portal>;
}

export function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props): React.JSX.Element {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title"
    className={(state) => twMerge("text-xl font-semibold leading-7 outline-none", typeof className === "function" ? className(state) : className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props): React.JSX.Element {
  return <AlertDialogPrimitive.Description data-slot="alert-dialog-description"
    className={(state) => twMerge("text-sm leading-6 text-muted-foreground", typeof className === "function" ? className(state) : className)} {...props} />;
}
