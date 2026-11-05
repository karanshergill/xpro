import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// Router normalizes repeated search parameters into JSON arrays. Native signed
// OAuth queries must retain their original bytes between fixed Hub pages.
export const readPageSearch = createIsomorphicFn()
  .server((): string => new URL(getRequest().url).search)
  .client((): string => window.location.search);
