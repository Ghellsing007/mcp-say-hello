import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const serverEntry = resolve(projectRoot, "dist", "index.js");
const projectName = "mcp-say-hello";
const projectBrand = "GVSLabs";
const projectHomepage = "https://gvslabs.cloud/";
const port = Number(process.env.PORT ?? 3000);
const startupTimeoutMs = 20_000;

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function requireExecutable(command, installHint) {
  const versionCheck = spawnSync(command, ["version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "ignore",
    windowsHide: true,
  });

  if (versionCheck.error || versionCheck.status !== 0) {
    fail(`${command} was not found. ${installHint}`);
  }
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function getPublicMcpUrl() {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:4040/api/tunnels");

      if (response.ok) {
        const tunnelResponse = await response.json();
        const httpsTunnel = tunnelResponse.tunnels?.find((tunnel) =>
          tunnel.public_url?.startsWith("https://"),
        );

        if (httpsTunnel) {
          return `${httpsTunnel.public_url}/mcp`;
        }
      }
    } catch {
      // ngrok exposes the local agent API after it finishes booting.
    }

    await wait(1_000);
  }

  throw new Error("ngrok did not publish an HTTPS tunnel before timeout.");
}

function forwardOutput(prefix, stream) {
  stream?.on("data", (chunk) => {
    process.stdout.write(`[${prefix}] ${chunk}`);
  });
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail("PORT must be an integer between 1 and 65535.");
}

if (!existsSync(serverEntry)) {
  fail("dist/index.js was not found. Run `pnpm run build` first.");
}

if (!process.env.WORKSPACE_ROOT?.trim()) {
  console.warn(
    "WORKSPACE_ROOT is not set. The MCP server will use this project directory as its workspace root.",
  );
}

if (!process.env.NGROK_AUTHTOKEN?.trim()) {
  fail(
    [
      "NGROK_AUTHTOKEN is missing.",
      "Create and verify an ngrok account, get your authtoken, and put it in .env.",
    ].join(" "),
  );
}

requireExecutable(
  "ngrok",
  "Install the ngrok agent from the official ngrok download page first.",
);

const server = spawn(
  process.execPath,
  ["--env-file=.env", serverEntry],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

forwardOutput("mcp", server.stdout);
forwardOutput("mcp", server.stderr);

server.once("exit", (code) => {
  fail(`The MCP server exited before the tunnel was ready (code ${code ?? "unknown"}).`);
});

await wait(1_500);

const ngrok = spawn(
  "ngrok",
  [
    "http",
    String(port),
    "--host-header=rewrite",
    "--authtoken",
    process.env.NGROK_AUTHTOKEN,
  ],
  {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true,
  },
);

forwardOutput("ngrok", ngrok.stdout);
forwardOutput("ngrok", ngrok.stderr);

ngrok.once("exit", (code) => {
  fail(`ngrok exited before shutdown (code ${code ?? "unknown"}).`);
});

try {
  const mcpUrl = await getPublicMcpUrl();

  console.log(
    [
      "",
      `Remote MCP tunnel is ready for ${projectName} by ${projectBrand}.`,
      `Project: ${projectHomepage}`,
      "Domain: gvslabs.cloud",
      `MCP URL: ${mcpUrl}`,
      `Local upstream: http://localhost:${port}/mcp`,
      "",
      "Keep this process running while the remote chatbot uses the MCP.",
      "Press Ctrl+C to stop both the MCP server and ngrok.",
      "",
    ].join("\n"),
  );
} catch (error) {
  server.kill();
  ngrok.kill();
  fail(error instanceof Error ? error.message : "Failed to start ngrok tunnel.");
}

function shutdown() {
  ngrok.kill();
  server.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
