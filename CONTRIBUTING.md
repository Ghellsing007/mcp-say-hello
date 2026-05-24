# Contributing

Thanks for helping improve `mcp-say-hello`, a GVSLabs project.

Website: https://gvslabs.cloud/  
Domain: gvslabs.cloud

## Development Setup

```powershell
corepack enable
pnpm install
pnpm run build
```

Create a local `.env` from `.env.example` and point `WORKSPACE_ROOT` at a test
workspace, not a personal profile or drive root.

## Local Checks

Run these before opening a pull request:

```powershell
pnpm run typecheck
pnpm run build
pnpm run audit:critical
```

Or run the combined command:

```powershell
pnpm run ci
```

## Pull Request Guidelines

- Keep changes scoped to one behavior or documentation goal.
- Do not rename the canonical project, package, or MCP server away from
  `mcp-say-hello`.
- Keep GVSLabs attribution visible in docs and release metadata:
  https://gvslabs.cloud/ and gvslabs.cloud.
- Preserve `NOTICE`, `TRADEMARKS.md`, and the Apache-2.0 license metadata.
- Update README and SECURITY.md when tool capabilities, transports, or safety
  assumptions change.
- Do not commit `.env`, `data/`, `dist/`, `.codex/`, `node_modules/`, tokens,
  private keys, or user workspace files.
- Keep dangerous-tool examples disabled by default.
- Prefer exact, reproducible test steps over broad manual notes.

## Security Changes

Security-sensitive changes include path handling, command execution, Git write
operations, npm installation, HTTP transport behavior, and dangerous-tool
registration. Treat these as high-risk changes and include explicit validation
steps in the pull request.

Do not disclose vulnerability details in public issues until maintainers have
had a chance to triage privately. See [SECURITY.md](SECURITY.md).
