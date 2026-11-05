import type { ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

export function Table({ className, ...props }: ComponentProps<"table">): React.JSX.Element {
  return <table data-slot="table" className={twMerge("w-full caption-bottom text-sm", className)} {...props} />;
}
export function TableHeader({ className, ...props }: ComponentProps<"thead">): React.JSX.Element {
  return <thead data-slot="table-header" className={twMerge("[&_tr]:border-b", className)} {...props} />;
}
export function TableBody({ className, ...props }: ComponentProps<"tbody">): React.JSX.Element {
  return <tbody data-slot="table-body" className={twMerge("[&_tr:last-child]:border-0", className)} {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<"tr">): React.JSX.Element {
  return <tr data-slot="table-row" className={twMerge("border-b border-border", className)} {...props} />;
}
export function TableHead({ className, ...props }: ComponentProps<"th">): React.JSX.Element {
  return <th data-slot="table-head" className={twMerge("h-11 px-3 text-start align-middle font-medium whitespace-nowrap", className)} {...props} />;
}
export function TableCell({ className, ...props }: ComponentProps<"td">): React.JSX.Element {
  return <td data-slot="table-cell" className={twMerge("p-3 align-middle whitespace-nowrap", className)} {...props} />;
}
export function TableCaption({ className, ...props }: ComponentProps<"caption">): React.JSX.Element {
  return <caption data-slot="table-caption" className={twMerge("mt-4 text-sm text-muted-foreground", className)} {...props} />;
}
