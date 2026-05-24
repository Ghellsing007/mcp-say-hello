# Security Policy

Project: `mcp-say-hello` by GVSLabs  
Website: https://gvslabs.cloud/  
Domain: gvslabs.cloud

## Supported Versions

This project is pre-1.0. Security fixes are expected on the latest `0.1.x`
line unless the maintainers publish a newer support policy.

| Version | Supported |
| --- | --- |
| `0.1.x` | Yes |
| `<0.1` | No |

## Critical Vulnerabilities

As of 2026-05-24, the dependency audit command below reported no known critical
dependency vulnerabilities:

```powershell
corepack pnpm audit --audit-level critical
```

This does not mean the server is safe to expose publicly. The following are
known critical security risks if the server is misconfigured:

- Unauthenticated public HTTP access to `/mcp` can expose workspace read/write,
  Git, and command capabilities to anyone who can reach the endpoint.
- `ENABLE_DANGEROUS_TOOLS=true` enables tools that can read blocked files,
  overwrite/delete workspace files, run arbitrary shell commands, install npm
  packages, and perform Git write or remote operations.
- A broad `WORKSPACE_ROOT` increases the impact of every file and command
  operation. Use the smallest project root that satisfies the workflow.
- Public tunnel URLs, including ngrok URLs, are not authentication mechanisms.
- Any MCP client connected to this server can request the tools that the server
  advertises. Only connect trusted clients to an instance that can change code.

## Required Secure Defaults

- Keep `ENABLE_DANGEROUS_TOOLS=false` unless the caller and environment are
  trusted.
- Prefer `stdio` for local desktop use.
- Do not expose Streamable HTTP publicly without authentication, authorization,
  logging, and network controls.
- Keep `.env`, tokens, private keys, npm credentials, and workspace-specific
  paths out of Git.
- Run dependency audits before release:

```powershell
pnpm run audit:critical
```

## Reporting A Vulnerability

Report security issues through the repository's private vulnerability reporting
channel when available, such as GitHub Security Advisories. If no private
channel exists yet, contact the maintainers before publishing exploit details in
a public issue.

Please include:

- affected version or commit
- transport used: `stdio` or HTTP
- whether `ENABLE_DANGEROUS_TOOLS` was enabled
- minimal reproduction steps
- expected impact and any known mitigations

Do not include real secrets, private keys, tokens, or private repository data in
reports.
