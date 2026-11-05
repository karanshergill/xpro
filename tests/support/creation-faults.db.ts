// Keep every database operation real, then lose this request's connection after
// a selected committed write. A fresh request still sees the durable result.
export function interruptAfterWrite(database: D1Database, matches: (query: string) => boolean): D1Database {
  let isInterrupted = false;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const queries = new WeakMap<D1PreparedStatement, string>();
  const checkConnection = (): void => {
    if (isInterrupted) throw new Error("test_connection_interrupted");
  };
  const afterCommit = (query: string): void => {
    if (!matches(query)) return;
    isInterrupted = true;
    checkConnection();
  };
  function wrap(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    const wrapped = new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => {
        checkConnection();
        return wrap(target.bind(...values), query);
      };
      const method: unknown = Reflect.get(target, key, target);
      if (typeof method !== "function") return method;
      return async (...args: unknown[]) => {
        checkConnection();
        const result: unknown = await Reflect.apply(method, target, args);
        afterCommit(query);
        return result;
      };
    } });
    originals.set(wrapped, statement);
    queries.set(wrapped, query);
    return wrapped;
  }
  return new Proxy(database, { get(target, key) {
    if (key === "prepare") return (query: string) => {
      checkConnection();
      return wrap(target.prepare(query), query);
    };
    if (key === "batch") return async (statements: D1PreparedStatement[]) => {
      checkConnection();
      const result = await target.batch(statements.map((statement) => originals.get(statement) ?? statement));
      for (const statement of statements) afterCommit(queries.get(statement) ?? "");
      return result;
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
