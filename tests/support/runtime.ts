export function assertTestEnvironment(environment: unknown): void {
  if (environment !== "test") {
    throw new Error("Tests require the isolated test environment.");
  }
}
