import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const serverEntry = resolve(projectRoot, "dist", "index.js");
const projectName = "mcp-say-hello";
const projectBrand = "GVSLabs";
const projectHomepage = "https://gvslabs.cloud/";
const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const localMcpUrl = `http://${host}:${port}/mcp`;
const localUpstreamUrl = `http://${host}:${port}`;
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

function waitForServerReady(server) {
  return new Promise((resolveReady, rejectReady) => {
    const deadline = setTimeout(() => {
      rejectReady(new Error("The MCP server did not report readiness before timeout."));
    }, startupTimeoutMs);

    function cleanup() {
      clearTimeout(deadline);
      server.stdout?.off("data", onOutput);
      server.stderr?.off("data", onOutput);
      server.off("exit", onExit);
      server.off("error", onError);
    }

    function onOutput(chunk) {
      const output = chunk.toString();

      if (output.includes("listening on http://")) {
        cleanup();
        resolveReady();
      }
    }

    function onExit(code) {
      cleanup();
      rejectReady(
        new Error(`The MCP server exited before it was ready (code ${code ?? "unknown"}).`),
      );
    }

    function onError(error) {
      cleanup();
      rejectReady(error);
    }

    server.stdout?.on("data", onOutput);
    server.stderr?.on("data", onOutput);
    server.once("exit", onExit);
    server.once("error", onError);
  });
}

async function getCloudflaredUrl(cloudflaredProcess) {
  const deadline = Date.now() + startupTimeoutMs;

  return new Promise((resolveUrl, rejectUrl) => {
    const timeoutId = setTimeout(() => {
      rejectUrl(new Error("cloudflared did not publish a tunnel URL before timeout."));
    }, startupTimeoutMs);

    function onData(chunk) {
      const output = chunk.toString();
      // cloudflared prints the tunnel URL to stderr
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match) {
        clearTimeout(timeoutId);
        cloudflaredProcess.stderr?.off("data", onData);
        cloudflaredProcess.stdout?.off("data", onData);
        resolveUrl(`${match[0]}/mcp`);
      }
    }

    cloudflaredProcess.stderr?.on("data", onData);
    cloudflaredProcess.stdout?.on("data", onData);
  });
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

requireExecutable(
  "cloudflared",
  "Install cloudflared: winget install Cloudflare.cloudflared (Windows) or see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
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

await waitForServerReady(server);

const cloudflared = spawn(
  "cloudflared",
  [
    "tunnel",
    "--url",
    localUpstreamUrl,
    "--http-host-header",
    `${host}:${port}`,
  ],
  {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

forwardOutput("cloudflared", cloudflared.stdout);
forwardOutput("cloudflared", cloudflared.stderr);

cloudflared.once("exit", (code) => {
  fail(`cloudflared exited before shutdown (code ${code ?? "unknown"}).`);
});

try {
  const mcpUrl = await getCloudflaredUrl(cloudflared);

  console.log(
    [
      "",
      `Cloudflare Tunnel is ready for ${projectName} by ${projectBrand}.`,
      `Project: ${projectHomepage}`,
      "Domain: gvslabs.cloud",
      `MCP URL: ${mcpUrl}`,
      `Local upstream: ${localMcpUrl}`,
      `Health check: http://${host}:${port}/health`,
      "",
      "This URL is temporary (trycloudflare.com). For a fixed URL, configure",
      "a named tunnel with your Cloudflare dashboard and your domain.",
      "",
      "Keep this process running while the remote chatbot uses the MCP.",
      "Press Ctrl+C to stop both the MCP server and cloudflared.",
      "",
    ].join("\n"),
  );
} catch (error) {
  server.kill();
  cloudflared.kill();
  fail(error instanceof Error ? error.message : "Failed to start cloudflared tunnel.");
}

function shutdown() {
  cloudflared.kill();
  server.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
