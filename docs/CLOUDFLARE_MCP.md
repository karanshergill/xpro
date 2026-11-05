# Cloudflare MCP

The official [Cloudflare API MCP server](https://github.com/cloudflare/mcp)
connects Codex to Cloudflare at `https://mcp.cloudflare.com/mcp`. It is an
optional development tool, with no application dependency or runtime change.

## Connection and authorization

The project-local `.codex/config.toml` keeps the Graphify connection and adds
`cloudflare_api` with an explicit OAuth scope list. This machine-local file
is ignored by Git. Codex manages OAuth credentials separately; do not put
tokens in the repository.

From this trusted repository root, run:

```bash
codex mcp login cloudflare_api
```

Run the login again after changing scopes. Editing the configuration does
not expand an existing OAuth grant.

Complete authorization in the browser, keeping the requested scope list.
Do not switch to the Full access template. Select the xpro account if the
consent flow offers an account choice. Restart the MCP connection in the
Codex client, or start a new Codex session, to load the configured server.

The requested scopes are:

| Access | Scopes |
| --- | --- |
| Identity, account discovery and refresh | `user:read`, `account:read`, `offline_access` |
| Worker deployments, settings and bindings | `workers-scripts.read`, `workers-scripts.write` |
| Worker routes | `workers-routes.read`, `workers-routes.write` |
| Observability inspection | `workers-observability.read` |
| Turnstile widget management | `challenge-widgets.write` |
| D1 databases and data | `d1.metadata_read`, `d1.read`, `d1.write` |
| R2 buckets and objects | `workers-r2.metadata_read`, `workers-r2.read`, `workers-r2.write` |
| KV namespaces and values | `workers-kv-storage.metadata_read`, `workers-kv-storage.read`, `workers-kv-storage.write` |
| Flagship configuration and history | `flagship.read`, `flagship.write` |

These scopes support reading and changing resources in the listed services.
They do not request account administration or billing permissions. Scopes
select services, rather than individual xpro resource names; use the intended
account, environment and resources for each approved task. Account roles and
product availability still limit the operations available. Review any extra
permission needed by a later task before extending access.

## Using and checking the connection

The default Code Mode interface exposes `docs`, `search`, `execute` and
`whoami`. Keep Code Mode enabled; exposing every API endpoint individually
adds unnecessary tool definitions. `execute` is a general API tool: the
OAuth grant, not the tool allowlist, limits its permissions.

After authorization, verify the identity with `whoami`, find the relevant
list endpoints with `search`, and use bounded GET requests to list the xpro
account and its resources. Do not test permissions by attempting a write.
A saved configuration alone does not prove the connection works; confirm
that the tools are available and an authenticated read succeeds.

Use Graphify for local code relationships, Cloudflare MCP for inspecting and
managing hosted resources, and Wrangler for local development, tests and
approved deployments from the repository's build and configuration. Wrangler
uses its own authentication; the MCP grant does not set Wrangler's permissions.
Hosted state does not replace versioned configuration. Resource creation,
updates, deployments and extra permissions need their own task authorization.

## References

- [Cloudflare server and OAuth guidance](https://github.com/cloudflare/mcp)
- [Cloudflare scope definitions and templates](https://github.com/cloudflare/mcp/blob/main/src/auth/scopes.ts)
- [Wrangler authentication and permissions](https://developers.cloudflare.com/workers/authorization/)
- [Codex MCP configuration and OAuth](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
