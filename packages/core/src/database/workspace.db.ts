import {
  CamelCasePlugin, Kysely, Migrator, OperationNodeTransformer, QueryNode, TableNode, sql,
  type DatabaseIntrospector, type QueryId, type SelectQueryNode,
} from "kysely";
import { DurableObjectSqliteDialect, type SqlStorage as DialectSqlStorage } from "kysely-durable-objects";
import * as initialWorkspace from "./migrations/2026-10-27-024500-initial-workspace";

type WorkspaceTables = {
  workspaceUsers: {
    id: string; loginId: string; kind: "internal" | "external"; createdAt: string; archivedAt: string | null;
  };
  sessions: { id: string; loginId: string; hubSessionId: string; expiresAt: string };
  auditEntries: {
    id: string; action: string; outcome: string; actorLoginId: string | null;
    affectedLoginId: string | null; reason: string | null; comment: string | null;
    requestId: string; createdAt: string;
  };
};

export function createWorkspaceDatabase(storage: SqlStorage): Kysely<WorkspaceTables> {
  // shortcut: 0.2.2 declares exec<T> without the platform's record constraint.
  // Remove this assertion when the dialect publishes matching storage types.
  return new Kysely<WorkspaceTables>({
    dialect: new WorkspaceSqliteDialect(storage as DialectSqlStorage),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  });
}

export function createWorkspaceMigrator<Database>(database: Kysely<Database>): Migrator {
  return new Migrator({
    db: database.withoutPlugins(),
    // The enclosing storage transaction owns atomicity; SQL BEGIN is unsupported.
    disableTransactions: true,
    provider: { async getMigrations() { return { "2026-10-27-024500-initial-workspace": initialWorkspace }; } },
  });
}

export async function upgradeWorkspaceDatabase(storage: DurableObjectStorage): Promise<void> {
  const db = createWorkspaceDatabase(storage.sql);
  try {
    await storage.transaction(async () => {
      const migrator = createWorkspaceMigrator(db);
      const known = await migrator.getMigrations();
      // Older code may reopen an additively upgraded schema with later migration records.
      if (known.every((migration) => migration.executedAt !== undefined)) return;
      const result = await migrator.migrateToLatest();
      // Migrator returns failures; throw so storage also rolls back DDL and bookkeeping.
      if (result.error) throw result.error;
    });
  } finally {
    await db.destroy();
  }
}

// shortcut: the pinned dialect's generic introspector reads protected _cf_* tables.
// Remove this filter when the dialect supplies Cloudflare-safe introspection.
class WorkspaceSqliteDialect extends DurableObjectSqliteDialect {
  override createIntrospector<Database>(database: Kysely<Database>): DatabaseIntrospector {
    return super.createIntrospector(database.withPlugin({
      transformQuery({ node }) { return new CloudflareIntrospectionTransformer().transformNode(node); },
      async transformResult({ result }) { return result; },
    }));
  }
}

class CloudflareIntrospectionTransformer extends OperationNodeTransformer {
  protected override transformSelectQuery(node: SelectQueryNode, queryId?: QueryId): SelectQueryNode {
    const transformed = super.transformSelectQuery(node, queryId);
    const isSchemaQuery = transformed.from?.froms.some((from) => TableNode.is(from) && from.table.identifier.name === "sqlite_master");
    if (!isSchemaQuery) return transformed;
    return QueryNode.cloneWithWhere(transformed, sql`${sql.ref("name")} not glob ${"_cf_*"}`.toOperationNode());
  }
}
