# Graphify for xpro

Graphify provides a local map of source code, tests and project documentation.
Use it to find related files before reading the source. Code and current tests
remain the authority for implemented behaviour; a graph connection is not proof
that a feature works or that a hosted resource has been provisioned.

## Local installation

The development machine has Graphify CLI **0.9.97** installed as the Python
package **`graphifyy`** in an isolated `uv tool` environment using Python 3.11.
This release cleared the project's three-day release waiting period. Graphify
does not belong in `package.json` or the Worker bundle.

The matching Codex skill is installed at
`~/.codex/skills/graphify/`. A new Codex turn can discover it. The initial
documentation extraction used the current Codex session and delegated readers;
it did not invoke a separate model provider or require another API key. That
work consumes Codex usage, which this tool interface does not expose as token
counts.

The setup installed the skill files without registering hooks or editing
`AGENTS.md` or Codex settings. Do not run `graphify install` as a routine refresh:
the installer can change those files. Review official installation instructions
and the chosen release before upgrading the CLI and its matching skill together.

## Read the map

Run these commands from the repository root:

```bash
graphify --version
graphify query "How does workspace access reach the Hub?"
graphify explain "reportUnexpectedError"
graphify affected packages/core/src/server/errors.server.ts
open graphify-out/graph.html
```

`query` retrieves graph context; read the cited files before deciding what to
change. `affected` provides candidates to inspect, not a complete test selection.

The persistent local outputs live in `graphify-out/`:

- `graph.json`: graph data used by queries.
- `graph.html`: interactive visualisation.
- `GRAPH_REPORT.md`: communities, extraction health and analysis limits.
- Manifest and extraction caches: allow incremental refreshes.

Keep the manifest and caches while using this graph. Removing `graphify-out/`
removes the index and requires a fresh build. Generated output is intended to be
ignored by Git; share the source and configuration instead.

## Refresh after changes

For a quick, local code refresh in Terminal:

```bash
graphify update .
```

This uses AST parsing without a model call. It preserves existing documentation
nodes but does not reread changed documentation. For a combined code and
documentation refresh, ask Codex to use the installed Graphify skill:

```text
/graphify . --update --directed
```

The first graph preserves edge directions. Keep `--directed` when rebuilding
through the skill. An incremental refresh should report which files changed,
read changed documents fully and retain unchanged graph content. Inspect any
partial-extraction or graph-health warning before relying on the result.

Edit code and its relevant specification, decision record or guide in the same
change, then refresh the graph. Graphify does not edit documentation to match code
and does not decide whether a plan has been approved or implemented. During
review, keep future plans and historical observations distinct from current
behaviour.

No background watcher or Git hook is enabled. Refresh explicitly after a
meaningful change or before using the graph for an impact assessment.

## MCP connection

The machine-local `.codex/config.toml` registers the `graphify` MCP server for
this trusted project. It contains absolute paths to the existing Python tool
and xpro graph, so keep this configuration out of Git.

Graphify remains pinned to 0.9.97; its optional MCP support uses Python MCP SDK
2.3.0 in the same isolated tool environment. Codex manages the server process
over stdio. The connection exposes seven graph-reading tools: `query_graph`,
`get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats` and
`shortest_path`.

After adding or changing the connection, restart it in the app's MCP-server
settings. Use `/mcp` to check connected servers or `codex mcp list` to check the
saved configuration. A saved configuration alone does not establish that the
current chat has loaded its tools.

Use MCP for graph queries when its tools are connected. The CLI remains
available for fallback queries and code refreshes; the Graphify skill handles
combined code/documentation refreshes. Both query paths read the same
`graphify-out/graph.json`; a connection does not rebuild the graph automatically.

Reference: [official Codex MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Scope and limits

`.graphifyignore` excludes credentials, certificates, local Worker state,
dependencies, generated routes/types/translations, builds, test artifacts,
third-party assistant skills, temporary research and unapplied review diffs.
Review exclusions when adding new private or generated directories.

`.graphifyrc` treats `.jsonc` files as text documents so the checked-in Wrangler
bindings can be connected to architecture documentation. It does not execute
Wrangler or inspect hosted resources. Other unsupported or data-only files may
not produce graph nodes.

Code relationships come from static extraction. Dynamic service bindings,
Durable Object RPC, framework-generated routes and computed calls may be missing.
Multiple relationships between the same pair of nodes can be collapsed by the
graph model; repeated call sites are not a reliable graph edge count. Use source
search and the Workers/browser tests to verify runtime behaviour.

Documentation relationships are model-assisted and can be incomplete or wrong.
Their confidence labels describe the extraction, not application correctness.
Do not use graph statistics or retrieval benchmarks as measured development
time savings or actual model billing.

References: [official installation](https://docs.graphify.com/open-source/installation),
[incremental updates](https://docs.graphify.com/open-source/features/incremental-updates),
[ignore rules](https://docs.graphify.com/open-source/configuration/ignoring-files),
[configuration](https://docs.graphify.com/open-source/configuration/graphifyrc),
and [release source](https://github.com/Graphify-Labs/graphify/tree/v0.9.97).
