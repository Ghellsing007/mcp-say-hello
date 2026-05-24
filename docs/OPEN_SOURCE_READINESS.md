# Open Source Readiness

Date: 2026-05-24

Project: `mcp-say-hello` by GVSLabs  
Website: https://gvslabs.cloud/  
Domain: gvslabs.cloud

## Current State

Confirmed:

- The project is a TypeScript MCP server named `mcp-say-hello`.
- The maintainer brand is GVSLabs, with website https://gvslabs.cloud/ and
  domain gvslabs.cloud.
- The server supports local `stdio` mode and Streamable HTTP at `/mcp`.
- The default tools are scoped to `WORKSPACE_ROOT` and reject obvious secret
  files.
- Dangerous tools are only registered when `ENABLE_DANGEROUS_TOOLS=true`.
- The project already has `LICENSE`, `.env.example`, `.gitignore`,
  `NOTICE`, `TRADEMARKS.md`, `package.json`, `pnpm-lock.yaml`, TypeScript
  config, source code, and README.
- Local typecheck and build passed on 2026-05-24 using the local TypeScript
  binary.
- `corepack pnpm audit --audit-level critical` reported no known critical
  dependency vulnerabilities on 2026-05-24.

Unknown or not yet present:

- This folder is not currently initialized as a Git repository.
- No remote repository is configured.
- The real repository URL is not yet known, so package metadata cannot include
  final `repository` or `bugs` fields.
- No published release tags exist yet.

## Critical Publication Risks

- Public unauthenticated HTTP access to `/mcp` is unsafe because the server can
  expose workspace read/write, Git, and command tools.
- `ENABLE_DANGEROUS_TOOLS=true` is intentionally powerful and can lead to
  arbitrary command execution, file overwrite/deletion, dependency installation,
  secret disclosure, and Git remote writes.
- A broad `WORKSPACE_ROOT` can accidentally give the MCP server access to more
  files than the user intended.
- A public tunnel URL is not an authentication control.

## Minimum Before Public Release

- Initialize Git and make a clean first commit.
- Create the public repository and add the real remote URL.
- Add `repository` and `bugs` fields to `package.json` once the URL exists.
- Preserve the canonical project name `mcp-say-hello`.
- Preserve GVSLabs attribution: https://gvslabs.cloud/ and gvslabs.cloud.
- Enable GitHub Actions CI from `.github/workflows/ci.yml`.
- Enable Dependabot security updates from `.github/dependabot.yml`.
- Configure a private vulnerability reporting channel.
- Re-run:

```powershell
pnpm run typecheck
pnpm run build
pnpm run audit:critical
```

## Suggested First Release Criteria

- README explains purpose, requirements, setup, transports, tool list, and
  security model.
- SECURITY.md lists known critical risks and reporting guidance.
- CONTRIBUTING.md explains local setup, checks, and security-sensitive changes.
- LICENSE is present and referenced.
- NOTICE and TRADEMARKS.md are present and referenced.
- `.env.example` is present and `.env` is ignored.
- `dist/`, `data/`, `.codex/`, and `node_modules/` are ignored.
- The first release is tagged as `v0.1.0`.
