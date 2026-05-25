# mcp-say-hello

`mcp-say-hello` is a GVSLabs TypeScript Model Context Protocol (MCP) server for
working on source code inside one configured workspace. It gives an MCP client
safe-by-default tools for file inspection, text edits, Git inspection, and
declared project verification scripts. It can also expose explicitly dangerous
tools for trusted local development workflows.

Maintainer brand: GVSLabs  
Website: https://gvslabs.cloud/  
Domain: gvslabs.cloud

This project is intended for developers who want a local MCP server that can
help an assistant inspect and change code without giving it unrestricted access
to the whole machine by default.

## Status

- Current package and MCP server version: `0.1.0`
- Canonical project name: `mcp-say-hello`
- Maintainer: GVSLabs, https://gvslabs.cloud/, gvslabs.cloud
- License: Apache-2.0 with GVSLabs attribution notices in `NOTICE`
- Default transport: local `stdio`
- HTTP endpoint: `/mcp` for local or controlled development use
- Critical dependency audit last run: 2026-05-24, no known critical
  dependency vulnerabilities reported by `pnpm audit --audit-level critical`

See [SECURITY.md](SECURITY.md) before exposing the HTTP transport or enabling
dangerous tools.

See [NOTICE](NOTICE) and [TRADEMARKS.md](TRADEMARKS.md) for GVSLabs brand,
attribution, and naming guidance. The original project attribution must remain
readable in redistributed copies and derivative works.

## Requirements

- Node.js `22` or newer
- pnpm `10.32.1` or compatible, normally enabled through Corepack
- An MCP client that supports either local process/`stdio` servers or
  Streamable HTTP MCP servers
- Optional: Git, when using Git inspection tools
- Optional: ngrok, only when testing the HTTP transport through a development
  tunnel

## What It Does

Default workspace tools:

- report the configured workspace root and safety limits
- list and search workspace text files
- read bounded text files
- create new text files without overwriting existing files
- replace exact text or apply batches of exact replacements
- list and run declared verification scripts from `package.json`
- inspect Git status and diffs

Demo tools:

- `say_hello`
- `append_demo_document`
- `read_demo_document`

Dangerous tools, only available when `ENABLE_DANGEROUS_TOOLS=true`:

- `read_any_file`
- `write_any_file`
- `delete_any_file`
- `run_any_command`
- `npm_install`
- `git_add`
- `git_commit`
- `git_push`
- `git_reset`

## Safety Model

The default workspace tools are scoped to `WORKSPACE_ROOT`. They reject absolute
paths and paths that escape that root. Directory traversal skips `.git`,
`.next`, `coverage`, `dist`, and `node_modules`.

The default workspace tools block obvious secret file names and extensions:

- `.env` and `.env.*`
- `.npmrc`
- `id_rsa` and `id_ed25519`
- `*.key`, `*.pem`, `*.p12`, and `*.pfx`

`run_project_script` only runs declared `build`, `check`, `lint`, `test`, or
`typecheck` scripts from a workspace project's `package.json`.

Dangerous tools deliberately bypass some safer-tool restrictions. Treat
`ENABLE_DANGEROUS_TOOLS=true` as a trusted-local-development mode only.
`run_any_command` is the broadest capability: once it starts a shell command,
that command can access whatever the operating-system account can access.

## Critical Vulnerabilities And Known Risks

No critical dependency vulnerabilities were reported by the last local audit:

```powershell
corepack pnpm audit --audit-level critical
```

Known critical deployment risks:

- Public unauthenticated HTTP access to `/mcp` can expose read, write, Git, and
  command capabilities to anyone who can reach the endpoint.
- Enabling `ENABLE_DANGEROUS_TOOLS=true` for an untrusted client can lead to
  arbitrary command execution, secret disclosure, file overwrite/deletion, npm
  package installation, and Git remote writes.
- Setting `WORKSPACE_ROOT` too broadly, such as a user profile or drive root,
  increases the blast radius of every tool.
- A tunnel URL is not authentication. Do not treat ngrok or any other tunnel URL
  as a security boundary.

Security policy and reporting guidance are in [SECURITY.md](SECURITY.md).

## Install

```powershell
corepack enable
pnpm install
pnpm run build
```

Create `.env` from [.env.example](.env.example):

```env
WORKSPACE_ROOT=C:\path\to\workspace
NGROK_AUTHTOKEN=
ENABLE_DANGEROUS_TOOLS=false
```

`WORKSPACE_ROOT` is the only filesystem root the default workspace tools can
access. All workspace paths are relative to that root. If `WORKSPACE_ROOT` is
not set, the server uses its current working directory as the workspace root.

Keep `.env` local. Never commit tokens, secrets, or machine-specific workspace
paths.

## Package Scripts

The project scripts in `package.json` are:

| Script | Purpose |
| --- | --- |
| `pnpm run dev` | Runs the HTTP MCP server from TypeScript with file watching. Endpoint: `http://127.0.0.1:3000/mcp`. |
| `pnpm run dev:stdio` | Runs the MCP server from TypeScript over local `stdio`. |
| `pnpm run build` | Compiles TypeScript from `src/` into `dist/`. |
| `pnpm run start` | Runs the built HTTP MCP server from `dist/index.js`. Requires `pnpm run build` first. |
| `pnpm run start:stdio` | Runs the built MCP server over local `stdio`. Requires `pnpm run build` first. |
| `pnpm run start:ngrok` | Builds the project, starts the built HTTP MCP server, starts ngrok, and prints the public `/mcp` URL. |
| `pnpm run start:test` | Starts only the ngrok wrapper from `scripts/start-ngrok.mjs`. It expects `dist/index.js` to already exist. |
| `pnpm run typecheck` | Runs TypeScript checks without writing build output. |
| `pnpm run audit:critical` | Runs a critical-level dependency audit. |
| `pnpm run ci` | Runs `typecheck`, `build`, and `audit:critical` together. |

## Run With Stdio

`stdio` is the recommended local mode. The MCP client launches the server on the
same machine that owns the files.

Build first, then configure a local MCP process similar to:

```json
{
  "command": "node",
  "args": [
    "--env-file=C:\\path\\to\\mcp-say-hello\\.env",
    "C:\\path\\to\\mcp-say-hello\\dist\\index.js",
    "--stdio"
  ]
}
```

This mode does not expose a public HTTP endpoint.

## Run With Streamable HTTP

For local HTTP development:

```powershell
pnpm run dev
```

The MCP endpoint is:

```text
http://127.0.0.1:3000/mcp
```

Only `POST /mcp` handles MCP requests. `GET /mcp` and `DELETE /mcp` return
method-not-allowed responses.

Any public HTTP deployment needs authentication and policy at the HTTP boundary.
Use the MCP authorization model based on OAuth 2.1 for broad HTTP-client
interoperability, or keep the endpoint limited to trusted local networks during
development.

## Development Tunnel With Ngrok

ngrok is optional and only for controlled development testing.

Prerequisites:

- create and verify an ngrok account
- install the ngrok agent
- set `NGROK_AUTHTOKEN` in local `.env`
- keep `ENABLE_DANGEROUS_TOOLS=false` unless every caller is trusted

Start the built server and tunnel together:

```powershell
pnpm run start:ngrok
```

`start:ngrok` builds the server, starts the local `/mcp` server, opens an HTTPS
ngrok tunnel, and prints the public MCP URL ending in `/mcp`. Keep that
terminal running while a remote client uses the tunnel. Press `Ctrl+C` to stop
both processes.

If you already built the project and only want to start the tunnel wrapper
without rebuilding:

```powershell
pnpm run start:test
```

The tunnel wrapper checks for `dist/index.js`, `ngrok`, `NGROK_AUTHTOKEN`, and
`WORKSPACE_ROOT`.

## Suggested MCP Client Description

```text
Local code workspace MCP. Use this server to inspect, search, create, and edit
text files inside its configured WORKSPACE_ROOT. Call get_workspace_info first.
All workspace paths must be relative to that root. Use list/search before
reading files, read files before editing, and prefer apply_workspace_patch or
replace_workspace_text with exact expected text. Use list_project_scripts
before run_project_script. The server can inspect Git status/diff and can run
declared build/check/lint/test/typecheck package scripts. If dangerous tools
are enabled, use them only when needed and only with explicit user intent: they
can read/write/delete workspace files, run arbitrary shell commands, install npm
packages, and perform Git write or remote operations.
```

## Tool Reference

Workspace inspection:

- `get_workspace_info`
- `list_workspace_files`
- `read_workspace_file`
- `search_workspace_text`

Workspace edits:

- `create_workspace_file`
- `replace_workspace_text`
- `apply_workspace_patch`

Project verification:

- `list_project_scripts`
- `run_project_script`

Git inspection:

- `git_status`
- `git_diff`

Dangerous tools, only when `ENABLE_DANGEROUS_TOOLS=true`:

- `read_any_file`
- `write_any_file`
- `delete_any_file`
- `run_any_command`
- `npm_install`
- `git_add`
- `git_commit`
- `git_push`
- `git_reset`

## Development

```powershell
pnpm run typecheck
pnpm run build
pnpm run audit:critical
```

Use the combined local validation command before opening a pull request:

```powershell
pnpm run ci
```

### pnpm Build Script Approval

pnpm 10 may show this warning during install:

```text
Ignored build scripts: esbuild.
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

`esbuild` is a transitive development dependency used by `tsx`. For local
development, approve it only if you trust the installed dependency tree:

```powershell
pnpm approve-builds
```

Select `esbuild` with `<space>` and confirm with `<enter>`. If no package is
listed, there is nothing pending to approve.

## Open Source Publication Checklist

Before publishing the first public repository:

- initialize Git and make the first clean commit
- add the real repository URL to `package.json` after the remote exists
- keep the package name and MCP server name as `mcp-say-hello`
- keep GVSLabs attribution visible: https://gvslabs.cloud/ and gvslabs.cloud
- enable the included GitHub Actions CI workflow
- enable Dependabot security updates
- keep `LICENSE`, `NOTICE`, and `TRADEMARKS.md` in the repository
- review [SECURITY.md](SECURITY.md) and configure GitHub private vulnerability
  reporting or another private reporting channel
- do not commit `.env`, `data/`, `dist/`, `.codex/`, or `node_modules/`
- keep `ENABLE_DANGEROUS_TOOLS=false` in all examples and public demos

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).

GVSLabs attribution and project naming notices are in [NOTICE](NOTICE).
Trademark and brand guidance is in [TRADEMARKS.md](TRADEMARKS.md).
