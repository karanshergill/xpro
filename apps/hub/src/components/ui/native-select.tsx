import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

export function NativeSelect(props: ComponentProps<"select">): React.JSX.Element {
  return <div className="relative w-full">
    <select data-slot="native-select" className="min-h-11 w-full min-w-0 appearance-none rounded-lg border border-input bg-background py-2 ps-3 pe-9 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive" {...props} />
    <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
  </div>;
}
