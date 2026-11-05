// Pause a real D1 statement while another request changes the same database.
export function pauseDatabaseQuery(database: D1Database, matches: (query: string) => boolean): {
  database: D1Database; entered: Promise<void>; release(): void;
} {
  let signalEntered: () => void = () => {};
  let signalRelease: () => void = () => {};
  const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
  const released = new Promise<void>((resolve) => { signalRelease = resolve; });
  let isPaused = false;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const queries = new WeakMap<D1PreparedStatement, string>();
  async function wait(query: string): Promise<void> {
    if (isPaused || !matches(query)) return;
    isPaused = true; signalEntered(); await released;
  }
  function wrap(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    const wrapped = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), query);
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return async (...values: unknown[]) => { await wait(query); return await Reflect.apply(value, target, values); };
    } });
    originals.set(wrapped, statement); queries.set(wrapped, query); return wrapped;
  }
  const guarded = new Proxy(database, { get(target, key) {
    if (key === "prepare") return (query: string) => wrap(target.prepare(query), query);
    if (key === "batch") return async (statements: D1PreparedStatement[]) => {
      for (const statement of statements) await wait(queries.get(statement) ?? "");
      return await target.batch(statements.map((statement) => originals.get(statement) ?? statement));
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { database: guarded, entered, release: () => signalRelease() };
}
