import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { execFile } from "node:child_process";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import * as z from "zod/v4";

const execFileAsync = promisify(execFile);
const serverName = "mcp-say-hello";
const serverVersion = "0.1.0";
const projectBrand = "GVSLabs";
const projectHomepage = "https://gvslabs.cloud/";
const demoDocumentRelativePath = "data/mcp-demo-document.md";
const demoDocumentPath = resolve(process.cwd(), demoDocumentRelativePath);
const workspaceRoot = resolve(process.env.WORKSPACE_ROOT?.trim() || process.cwd());
const maxReadBytes = 500_000;
const maxSearchFileBytes = 250_000;
const maxSearchResults = 50;
const maxWorkspaceEntries = 300;
const maxWorkspaceWriteChars = 100_000;
const maxCommandOutputChars = 60_000;
const maxAnyFileBytes = 2_000_000;
const maxCommandTimeoutMs = 600_000;
const dangerousToolsEnabled =
  process.env.ENABLE_DANGEROUS_TOOLS?.trim().toLowerCase() === "true";
const verificationScriptNames = [
  "build",
  "check",
  "lint",
  "test",
  "typecheck",
] as const;
const packageManagerCommands = {
  npm: "npm",
  pnpm: "pnpm",
  yarn: "yarn",
} as const;
const ignoredTraversalDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
]);
const blockedWorkspaceFileNames = new Set([
  ".npmrc",
  "id_ed25519",
  "id_rsa",
]);
const blockedWorkspaceExtensions = new Set([
  ".key",
  ".p12",
  ".pem",
  ".pfx",
]);

type WorkspaceEntry = {
  path: string;
  kind: "directory" | "file";
};

type WorkspaceMatch = {
  path: string;
  line: number;
  text: string;
};

type PackageManagerName = keyof typeof packageManagerCommands;

type PackageJsonShape = {
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
};

type CommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
};

function toWorkspaceRelativePath(absolutePath: string) {
  const outputPath = relative(workspaceRoot, absolutePath);

  return outputPath === "" ? "." : outputPath.split(sep).join("/");
}

function isInsideWorkspace(absolutePath: string) {
  const relativePath = relative(workspaceRoot, absolutePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

function isBlockedWorkspaceSegment(segment: string) {
  const normalizedSegment = segment.toLowerCase();

  return (
    normalizedSegment === ".env" ||
    normalizedSegment.startsWith(".env.") ||
    blockedWorkspaceFileNames.has(normalizedSegment) ||
    blockedWorkspaceExtensions.has(extname(normalizedSegment))
  );
}

function assertWorkspaceBoundaryPath(absolutePath: string) {
  if (!isInsideWorkspace(absolutePath)) {
    throw new Error("Workspace path must stay inside the configured root.");
  }
}

function assertAllowedWorkspacePath(absolutePath: string) {
  assertWorkspaceBoundaryPath(absolutePath);

  const relativeSegments = relative(workspaceRoot, absolutePath)
    .split(sep)
    .filter(Boolean);

  if (relativeSegments.some(isBlockedWorkspaceSegment)) {
    throw new Error("Workspace path is blocked because it may contain secrets.");
  }
}

function resolveWorkspacePath(inputPath = ".") {
  const trimmedPath = inputPath.trim() || ".";

  if (isAbsolute(trimmedPath)) {
    throw new Error("Workspace tools only accept relative paths.");
  }

  const absolutePath = resolve(workspaceRoot, trimmedPath);
  assertAllowedWorkspacePath(absolutePath);

  return absolutePath;
}

function resolveAnyWorkspacePath(inputPath = ".") {
  const trimmedPath = inputPath.trim() || ".";

  if (isAbsolute(trimmedPath)) {
    throw new Error("Any-file tools still require relative workspace paths.");
  }

  const absolutePath = resolve(workspaceRoot, trimmedPath);
  assertWorkspaceBoundaryPath(absolutePath);

  return absolutePath;
}

async function realWorkspacePath(inputPath = ".") {
  const absolutePath = resolveWorkspacePath(inputPath);
  const actualPath = await realpath(absolutePath);
  assertAllowedWorkspacePath(actualPath);

  return actualPath;
}

async function realAnyWorkspacePath(inputPath = ".") {
  const absolutePath = resolveAnyWorkspacePath(inputPath);
  const actualPath = await realpath(absolutePath);
  assertWorkspaceBoundaryPath(actualPath);

  return actualPath;
}

async function getWorkspaceFile(inputPath: string) {
  const absolutePath = await realWorkspacePath(inputPath);
  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("Workspace path must point to a file.");
  }

  if (fileStat.size > maxReadBytes) {
    throw new Error(`Workspace file exceeds the ${maxReadBytes} byte read limit.`);
  }

  return {
    absolutePath,
    relativePath: toWorkspaceRelativePath(absolutePath),
    size: fileStat.size,
  };
}

async function getAnyWorkspaceFile(inputPath: string) {
  const absolutePath = await realAnyWorkspacePath(inputPath);
  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("Any-file path must point to a file.");
  }

  if (fileStat.size > maxAnyFileBytes) {
    throw new Error(`Any-file read exceeds the ${maxAnyFileBytes} byte limit.`);
  }

  return {
    absolutePath,
    relativePath: toWorkspaceRelativePath(absolutePath),
    size: fileStat.size,
  };
}

async function findExistingAncestor(absolutePath: string) {
  let currentPath = dirname(absolutePath);

  while (true) {
    try {
      const actualPath = await realpath(currentPath);
      assertAllowedWorkspacePath(actualPath);

      return actualPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      const parentPath = dirname(currentPath);

      if (parentPath === currentPath) {
        throw new Error("Could not find a writable workspace ancestor.");
      }

      currentPath = parentPath;
    }
  }
}

async function prepareWorkspaceWrite(absolutePath: string) {
  assertAllowedWorkspacePath(absolutePath);
  await findExistingAncestor(absolutePath);
  await mkdir(dirname(absolutePath), { recursive: true });

  const actualParentPath = await realpath(dirname(absolutePath));
  assertAllowedWorkspacePath(actualParentPath);
}

async function prepareAnyWorkspaceWrite(absolutePath: string) {
  assertWorkspaceBoundaryPath(absolutePath);
  await findExistingAncestor(absolutePath);
  await mkdir(dirname(absolutePath), { recursive: true });

  const actualParentPath = await realpath(dirname(absolutePath));
  assertWorkspaceBoundaryPath(actualParentPath);
}

function shouldSkipTraversalEntry(entryName: string, isDirectory: boolean) {
  return (
    isBlockedWorkspaceSegment(entryName) ||
    (isDirectory && ignoredTraversalDirectories.has(entryName.toLowerCase()))
  );
}

async function listWorkspaceEntries(
  startPath: string,
  maxDepth: number,
  maxEntries: number,
) {
  const entries: WorkspaceEntry[] = [];

  async function visitDirectory(directoryPath: string, depth: number) {
    const directoryEntries = await readdir(directoryPath, {
      withFileTypes: true,
    });

    directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of directoryEntries) {
      if (entries.length >= maxEntries || entry.isSymbolicLink()) {
        continue;
      }

      const isDirectory = entry.isDirectory();

      if (
        (!isDirectory && !entry.isFile()) ||
        shouldSkipTraversalEntry(entry.name, isDirectory)
      ) {
        continue;
      }

      const absoluteEntryPath = resolve(directoryPath, entry.name);
      assertAllowedWorkspacePath(absoluteEntryPath);

      entries.push({
        path: toWorkspaceRelativePath(absoluteEntryPath),
        kind: isDirectory ? "directory" : "file",
      });

      if (isDirectory && depth < maxDepth) {
        await visitDirectory(absoluteEntryPath, depth + 1);
      }
    }
  }

  const actualStartPath = await realWorkspacePath(startPath);
  const startStat = await stat(actualStartPath);

  if (startStat.isFile()) {
    return [
      {
        path: toWorkspaceRelativePath(actualStartPath),
        kind: "file" as const,
      },
    ];
  }

  if (!startStat.isDirectory()) {
    throw new Error("Workspace listing path must be a file or directory.");
  }

  await visitDirectory(actualStartPath, 0);

  return entries;
}

async function searchWorkspace(
  startPath: string,
  query: string,
  resultsLimit: number,
) {
  const matches: WorkspaceMatch[] = [];

  async function searchDirectory(directoryPath: string) {
    const directoryEntries = await readdir(directoryPath, {
      withFileTypes: true,
    });

    directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of directoryEntries) {
      if (matches.length >= resultsLimit || entry.isSymbolicLink()) {
        continue;
      }

      const isDirectory = entry.isDirectory();

      if (
        (!isDirectory && !entry.isFile()) ||
        shouldSkipTraversalEntry(entry.name, isDirectory)
      ) {
        continue;
      }

      const absoluteEntryPath = resolve(directoryPath, entry.name);
      assertAllowedWorkspacePath(absoluteEntryPath);

      if (isDirectory) {
        await searchDirectory(absoluteEntryPath);
        continue;
      }

      const fileStat = await stat(absoluteEntryPath);

      if (fileStat.size > maxSearchFileBytes) {
        continue;
      }

      let content: string;

      try {
        content = await readFile(absoluteEntryPath, "utf8");
      } catch {
        continue;
      }

      if (content.includes("\u0000")) {
        continue;
      }

      const lines = content.split(/\r?\n/);

      for (const [lineIndex, line] of lines.entries()) {
        if (!line.includes(query)) {
          continue;
        }

        matches.push({
          path: toWorkspaceRelativePath(absoluteEntryPath),
          line: lineIndex + 1,
          text: line.slice(0, 500),
        });

        if (matches.length >= resultsLimit) {
          break;
        }
      }
    }
  }

  const actualStartPath = await realWorkspacePath(startPath);
  const startStat = await stat(actualStartPath);

  if (!startStat.isDirectory()) {
    throw new Error("Workspace search path must point to a directory.");
  }

  await searchDirectory(actualStartPath);

  return matches;
}

function countExactMatches(content: string, expectedText: string) {
  let searchIndex = 0;
  let matches = 0;

  while (searchIndex < content.length) {
    const matchIndex = content.indexOf(expectedText, searchIndex);

    if (matchIndex === -1) {
      return matches;
    }

    matches += 1;
    searchIndex = matchIndex + expectedText.length;
  }

  return matches;
}

function truncateCommandOutput(output: string) {
  if (output.length <= maxCommandOutputChars) {
    return {
      output,
      truncated: false,
    };
  }

  return {
    output: output.slice(0, maxCommandOutputChars),
    truncated: true,
  };
}

async function runWorkspaceCommand(
  executable: string,
  args: string[],
  cwd: string,
  commandLabel: string,
  timeoutMs: number,
) {
  assertAllowedWorkspacePath(cwd);

  try {
    const result = await execFileAsync(executable, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
    });
    const stdout = truncateCommandOutput(result.stdout ?? "");
    const stderr = truncateCommandOutput(result.stderr ?? "");

    return {
      command: commandLabel,
      exitCode: 0,
      stdout: stdout.output,
      stderr: stderr.output,
      truncated: stdout.truncated || stderr.truncated,
    } satisfies CommandResult;
  } catch (error) {
    const commandError = error as Error & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const stdout = truncateCommandOutput(commandError.stdout ?? "");
    const stderr = truncateCommandOutput(commandError.stderr ?? commandError.message);

    return {
      command: commandLabel,
      exitCode:
        typeof commandError.code === "number" ? commandError.code : 1,
      stdout: stdout.output,
      stderr: stderr.output,
      truncated: stdout.truncated || stderr.truncated,
    } satisfies CommandResult;
  }
}

async function getProjectDirectory(inputPath: string) {
  const actualPath = await realWorkspacePath(inputPath);
  const actualStat = await stat(actualPath);
  const projectDirectory = actualStat.isDirectory()
    ? actualPath
    : dirname(actualPath);

  assertAllowedWorkspacePath(projectDirectory);

  return projectDirectory;
}

async function getAnyWorkspaceDirectory(inputPath: string) {
  const actualPath = await realAnyWorkspacePath(inputPath);
  const actualStat = await stat(actualPath);

  if (!actualStat.isDirectory()) {
    throw new Error("Command working path must be a workspace directory.");
  }

  return actualPath;
}

async function readPackageJson(projectPath: string) {
  const projectDirectory = await getProjectDirectory(projectPath);
  const manifestPath = resolve(projectDirectory, "package.json");
  assertAllowedWorkspacePath(manifestPath);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageJsonShape;

  return {
    manifest,
    manifestPath,
    projectDirectory,
    relativeProjectPath: toWorkspaceRelativePath(projectDirectory),
  };
}

function getPackageManager(manifest: PackageJsonShape) {
  const declaredPackageManager =
    typeof manifest.packageManager === "string"
      ? manifest.packageManager.split("@")[0]
      : "";

  if (
    declaredPackageManager === "npm" ||
    declaredPackageManager === "pnpm" ||
    declaredPackageManager === "yarn"
  ) {
    return declaredPackageManager;
  }

  return "npm";
}

function getShellCommand(command: string) {
  if (process.platform === "win32") {
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }

  return {
    executable: "/bin/sh",
    args: ["-lc", command],
  };
}

function getWindowsPackageCommand(
  packageManager: string,
  packageManagerArgs: string[],
) {
  if (process.platform !== "win32") {
    return {
      executable: packageManager,
      args: packageManagerArgs,
    };
  }

  return {
    executable: "cmd.exe",
    args: ["/d", "/s", "/c", packageManager, ...packageManagerArgs],
  };
}

function assertSafePackageSpec(packageSpec: string) {
  if (!/^[A-Za-z0-9@/_.,:+~-]+$/.test(packageSpec)) {
    throw new Error(`Unsupported package spec characters: ${packageSpec}`);
  }
}

async function replaceWorkspaceText(
  path: string,
  expectedText: string,
  replacementText: string,
  replaceAll: boolean,
) {
  const file = await getWorkspaceFile(path);
  const content = await readFile(file.absolutePath, "utf8");

  if (content.includes("\u0000")) {
    throw new Error("Workspace edits only support text files.");
  }

  const exactMatches = countExactMatches(content, expectedText);

  if (exactMatches === 0) {
    throw new Error(`Expected workspace text was not found in ${file.relativePath}.`);
  }

  const updatedContent = replaceAll
    ? content.replaceAll(expectedText, replacementText)
    : content.replace(expectedText, replacementText);
  const replacements = replaceAll ? exactMatches : 1;

  await writeFile(file.absolutePath, updatedContent, "utf8");

  return {
    path: file.relativePath,
    replacements,
  };
}

async function readDemoDocument() {
  try {
    return await readFile(demoDocumentPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function createServer() {
  const server = new McpServer({
    name: serverName,
    version: serverVersion,
  });

  server.registerTool(
    "say_hello",
    {
      title: "Say hello",
      description: "Return a greeting for the provided person name.",
      inputSchema: {
        name: z.string().trim().min(1).describe("Name of the person to greet."),
      },
      outputSchema: {
        message: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      const message = `Hola ${name}, tu MCP est\u00e1 funcionando correctamente.`;

      return {
        content: [{ type: "text", text: message }],
        structuredContent: { message },
      };
    },
  );

  server.registerTool(
    "append_demo_document",
    {
      title: "Append demo document",
      description:
        "Use this to verify MCP write actions. Append text only to the fixed demo document for this MCP project; it cannot write arbitrary files.",
      inputSchema: {
        text: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .describe("Text to append to the fixed demo Markdown document."),
      },
      outputSchema: {
        message: z.string(),
        path: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ text }) => {
      await mkdir(dirname(demoDocumentPath), { recursive: true });
      await appendFile(demoDocumentPath, `${text.trim()}\n`, "utf8");

      const message = `Texto agregado en ${demoDocumentRelativePath}.`;

      return {
        content: [{ type: "text", text: message }],
        structuredContent: {
          message,
          path: demoDocumentRelativePath,
        },
      };
    },
  );

  server.registerTool(
    "read_demo_document",
    {
      title: "Read demo document",
      description:
        "Read the fixed demo document used to verify MCP write actions. It cannot read arbitrary files.",
      outputSchema: {
        exists: z.boolean(),
        path: z.string(),
        content: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const content = await readDemoDocument();
      const exists = content !== null;
      const readableContent =
        content ?? "El documento de demostracion todavia no existe.";

      return {
        content: [{ type: "text", text: readableContent }],
        structuredContent: {
          exists,
          path: demoDocumentRelativePath,
          content: content ?? "",
        },
      };
    },
  );

  server.registerTool(
    "get_workspace_info",
    {
      title: "Get workspace info",
      description:
        "Use this before working on files. Return the programming workspace root, limits, and blocked path policy.",
      outputSchema: {
        root: z.string(),
        serverName: z.string(),
        brand: z.string(),
        homepage: z.string(),
        pathMode: z.string(),
        dangerousToolsEnabled: z.boolean(),
        blockedPaths: z.array(z.string()),
        ignoredTraversalDirectories: z.array(z.string()),
        limits: z.object({
          maxAnyFileBytes: z.number(),
          maxReadBytes: z.number(),
          maxSearchFileBytes: z.number(),
          maxSearchResults: z.number(),
          maxWorkspaceEntries: z.number(),
          maxWorkspaceWriteChars: z.number(),
        }),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const workspaceInfo = {
        root: workspaceRoot,
        serverName,
        brand: projectBrand,
        homepage: projectHomepage,
        pathMode: "All workspace tool paths are relative to root.",
        dangerousToolsEnabled,
        blockedPaths: [
          ".env and .env.* files",
          ".npmrc",
          "id_rsa and id_ed25519",
          "*.key, *.p12, *.pem, *.pfx",
          "paths outside root",
        ],
        ignoredTraversalDirectories: [...ignoredTraversalDirectories].sort(),
        limits: {
          maxAnyFileBytes,
          maxReadBytes,
          maxSearchFileBytes,
          maxSearchResults,
          maxWorkspaceEntries,
          maxWorkspaceWriteChars,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: `${workspaceInfo.serverName} by ${workspaceInfo.brand} (${workspaceInfo.homepage})\nWorkspace root: ${workspaceInfo.root}`,
          },
        ],
        structuredContent: workspaceInfo,
      };
    },
  );

  server.registerTool(
    "list_workspace_files",
    {
      title: "List workspace files",
      description:
        "List files and directories inside the programming workspace. Use relative paths and then read only the files needed.",
      inputSchema: {
        path: z
          .string()
          .default(".")
          .describe("Relative file or directory path inside the workspace."),
        maxDepth: z
          .number()
          .int()
          .min(0)
          .max(5)
          .default(2)
          .describe("Directory depth to traverse from the requested path."),
        maxEntries: z
          .number()
          .int()
          .min(1)
          .max(maxWorkspaceEntries)
          .default(100)
          .describe("Maximum entries to return."),
      },
      outputSchema: {
        path: z.string(),
        entries: z.array(
          z.object({
            path: z.string(),
            kind: z.enum(["directory", "file"]),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, maxDepth, maxEntries }) => {
      const entries = await listWorkspaceEntries(path, maxDepth, maxEntries);
      const relativePath = toWorkspaceRelativePath(await realWorkspacePath(path));

      return {
        content: [
          {
            type: "text",
            text: entries.map((entry) => `${entry.kind}: ${entry.path}`).join("\n"),
          },
        ],
        structuredContent: {
          path: relativePath,
          entries,
        },
      };
    },
  );

  server.registerTool(
    "read_workspace_file",
    {
      title: "Read workspace file",
      description:
        "Read one text file inside the programming workspace after it has been identified by listing or search.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Relative file path inside the programming workspace."),
      },
      outputSchema: {
        path: z.string(),
        size: z.number(),
        content: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ path }) => {
      const file = await getWorkspaceFile(path);
      const content = await readFile(file.absolutePath, "utf8");

      if (content.includes("\u0000")) {
        throw new Error("Workspace read only supports text files.");
      }

      return {
        content: [{ type: "text", text: content }],
        structuredContent: {
          path: file.relativePath,
          size: file.size,
          content,
        },
      };
    },
  );

  server.registerTool(
    "search_workspace_text",
    {
      title: "Search workspace text",
      description:
        "Search literal text inside workspace files. Use this to find code symbols before reading or editing files.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(200)
          .describe("Literal case-sensitive text to search for."),
        path: z
          .string()
          .default(".")
          .describe("Relative directory path to search from."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(maxSearchResults)
          .default(20)
          .describe("Maximum matching lines to return."),
      },
      outputSchema: {
        query: z.string(),
        path: z.string(),
        matches: z.array(
          z.object({
            path: z.string(),
            line: z.number(),
            text: z.string(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ query, path, maxResults }) => {
      const matches = await searchWorkspace(path, query, maxResults);
      const relativePath = toWorkspaceRelativePath(await realWorkspacePath(path));
      const outputText = matches
        .map((match) => `${match.path}:${match.line}: ${match.text}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: outputText || "No workspace text matches found.",
          },
        ],
        structuredContent: {
          query,
          path: relativePath,
          matches,
        },
      };
    },
  );

  server.registerTool(
    "create_workspace_file",
    {
      title: "Create workspace file",
      description:
        "Create a new text file inside the programming workspace. This refuses to overwrite existing files.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Relative path for a new workspace file."),
        content: z
          .string()
          .max(maxWorkspaceWriteChars)
          .describe("Initial UTF-8 text content for the new file."),
      },
      outputSchema: {
        path: z.string(),
        bytes: z.number(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, content }) => {
      const absolutePath = resolveWorkspacePath(path);
      await prepareWorkspaceWrite(absolutePath);

      try {
        await writeFile(absolutePath, content, {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error("Workspace file already exists; use an edit tool.");
        }

        throw error;
      }

      const relativePath = toWorkspaceRelativePath(absolutePath);
      const bytes = Buffer.byteLength(content, "utf8");

      return {
        content: [
          {
            type: "text",
            text: `Created ${relativePath}.`,
          },
        ],
        structuredContent: {
          path: relativePath,
          bytes,
        },
      };
    },
  );

  server.registerTool(
    "replace_workspace_text",
    {
      title: "Replace workspace text",
      description:
        "Edit one workspace text file by replacing exact expected text. Read the file first so the expected text is precise.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Relative text file path inside the workspace."),
        expectedText: z
          .string()
          .min(1)
          .max(maxWorkspaceWriteChars)
          .describe("Exact existing text to replace."),
        replacementText: z
          .string()
          .max(maxWorkspaceWriteChars)
          .describe("Replacement text. Empty text deletes the expected text."),
        replaceAll: z
          .boolean()
          .default(false)
          .describe("Replace every exact match instead of only the first one."),
      },
      outputSchema: {
        path: z.string(),
        replacements: z.number(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, expectedText, replacementText, replaceAll }) => {
      const replacement = await replaceWorkspaceText(
        path,
        expectedText,
        replacementText,
        replaceAll,
      );

      return {
        content: [
          {
            type: "text",
            text: `Replaced text in ${replacement.path}.`,
          },
        ],
        structuredContent: {
          path: replacement.path,
          replacements: replacement.replacements,
        },
      };
    },
  );

  server.registerTool(
    "apply_workspace_patch",
    {
      title: "Apply workspace patch",
      description:
        "Apply a batch of exact text replacements to workspace files. Read each file first and include precise expected text for every change.",
      inputSchema: {
        changes: z
          .array(
            z.object({
              path: z
                .string()
                .min(1)
                .describe("Relative workspace text file path."),
              expectedText: z
                .string()
                .min(1)
                .max(maxWorkspaceWriteChars)
                .describe("Exact existing text to replace."),
              replacementText: z
                .string()
                .max(maxWorkspaceWriteChars)
                .describe("Replacement text."),
              replaceAll: z
                .boolean()
                .default(false)
                .describe("Replace every exact match for this change."),
            }),
          )
          .min(1)
          .max(20)
          .describe("Exact workspace text replacements to apply."),
      },
      outputSchema: {
        changes: z.array(
          z.object({
            path: z.string(),
            replacements: z.number(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ changes }) => {
      const appliedChanges = [];

      for (const change of changes) {
        appliedChanges.push(
          await replaceWorkspaceText(
            change.path,
            change.expectedText,
            change.replacementText,
            change.replaceAll,
          ),
        );
      }

      return {
        content: [
          {
            type: "text",
            text: appliedChanges
              .map((change) => `${change.path}: ${change.replacements}`)
              .join("\n"),
          },
        ],
        structuredContent: {
          changes: appliedChanges,
        },
      };
    },
  );

  server.registerTool(
    "list_project_scripts",
    {
      title: "List project scripts",
      description:
        "Read package.json scripts for a project directory inside the workspace before running verification scripts.",
      inputSchema: {
        projectPath: z
          .string()
          .default(".")
          .describe("Relative project directory that contains package.json."),
      },
      outputSchema: {
        projectPath: z.string(),
        packageManager: z.enum(["npm", "pnpm", "yarn"]),
        scripts: z.record(z.string(), z.string()),
        verificationScripts: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectPath }) => {
      const project = await readPackageJson(projectPath);
      const scripts = Object.fromEntries(
        Object.entries(project.manifest.scripts ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      const verificationScripts = verificationScriptNames.filter(
        (scriptName) => scriptName in scripts,
      );
      const packageManager = getPackageManager(project.manifest);

      return {
        content: [
          {
            type: "text",
            text: Object.entries(scripts)
              .map(([scriptName, command]) => `${scriptName}: ${command}`)
              .join("\n"),
          },
        ],
        structuredContent: {
          projectPath: project.relativeProjectPath,
          packageManager,
          scripts,
          verificationScripts,
        },
      };
    },
  );

  server.registerTool(
    "run_project_script",
    {
      title: "Run project script",
      description:
        "Run one declared verification script in a workspace project. Only build, check, lint, test, and typecheck scripts are allowed.",
      inputSchema: {
        projectPath: z
          .string()
          .default(".")
          .describe("Relative project directory that contains package.json."),
        script: z
          .enum(verificationScriptNames)
          .describe("Allowed verification script name."),
      },
      outputSchema: {
        projectPath: z.string(),
        script: z.string(),
        result: z.object({
          command: z.string(),
          exitCode: z.number(),
          stdout: z.string(),
          stderr: z.string(),
          truncated: z.boolean(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectPath, script }) => {
      const project = await readPackageJson(projectPath);
      const scripts = project.manifest.scripts ?? {};

      if (typeof scripts[script] !== "string") {
        throw new Error(`Project does not declare the ${script} script.`);
      }

      const packageManager = getPackageManager(project.manifest);
      const packageManagerCommand = packageManagerCommands[packageManager];
      const packageManagerArgs =
        packageManager === "yarn" ? [script] : ["run", script];
      const executable =
        process.platform === "win32" ? "cmd.exe" : packageManagerCommand;
      const args =
        process.platform === "win32"
          ? ["/d", "/s", "/c", packageManagerCommand, ...packageManagerArgs]
          : packageManagerArgs;
      const result = await runWorkspaceCommand(
        executable,
        args,
        project.projectDirectory,
        `${packageManager} ${packageManagerArgs.join(" ")}`,
        120_000,
      );

      return {
        content: [
          {
            type: "text",
            text: [
              `${result.command} exited with ${result.exitCode}.`,
              result.stdout,
              result.stderr,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        structuredContent: {
          projectPath: project.relativeProjectPath,
          script,
          result,
        },
      };
    },
  );

  server.registerTool(
    "git_status",
    {
      title: "Git status",
      description:
        "Read concise Git status for a repository inside the workspace.",
      inputSchema: {
        repoPath: z
          .string()
          .default(".")
          .describe("Relative repository directory inside the workspace."),
      },
      outputSchema: {
        repoPath: z.string(),
        result: z.object({
          command: z.string(),
          exitCode: z.number(),
          stdout: z.string(),
          stderr: z.string(),
          truncated: z.boolean(),
        }),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ repoPath }) => {
      const repoDirectory = await getProjectDirectory(repoPath);
      const result = await runWorkspaceCommand(
        "git",
        ["status", "--short"],
        repoDirectory,
        "git status --short",
        30_000,
      );

      return {
        content: [
          {
            type: "text",
            text: [result.stdout, result.stderr].filter(Boolean).join("\n"),
          },
        ],
        structuredContent: {
          repoPath: toWorkspaceRelativePath(repoDirectory),
          result,
        },
      };
    },
  );

  server.registerTool(
    "git_diff",
    {
      title: "Git diff",
      description:
        "Read working-tree Git diff for a repository inside the workspace. This does not stage or change files.",
      inputSchema: {
        repoPath: z
          .string()
          .default(".")
          .describe("Relative repository directory inside the workspace."),
        staged: z
          .boolean()
          .default(false)
          .describe("Read staged diff instead of unstaged working-tree diff."),
      },
      outputSchema: {
        repoPath: z.string(),
        staged: z.boolean(),
        result: z.object({
          command: z.string(),
          exitCode: z.number(),
          stdout: z.string(),
          stderr: z.string(),
          truncated: z.boolean(),
        }),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ repoPath, staged }) => {
      const repoDirectory = await getProjectDirectory(repoPath);
      const args = staged ? ["diff", "--cached"] : ["diff"];
      const result = await runWorkspaceCommand(
        "git",
        args,
        repoDirectory,
        `git ${args.join(" ")}`,
        30_000,
      );

      return {
        content: [
          {
            type: "text",
            text: [result.stdout, result.stderr].filter(Boolean).join("\n"),
          },
        ],
        structuredContent: {
          repoPath: toWorkspaceRelativePath(repoDirectory),
          staged,
          result,
        },
      };
    },
  );

  if (dangerousToolsEnabled) {
    server.registerTool(
      "read_any_file",
      {
        title: "Read any workspace file",
        description:
          "Read any file inside WORKSPACE_ROOT, including paths that safer workspace read tools block as possible secrets. Use only when the user explicitly needs it.",
        inputSchema: {
          path: z
            .string()
            .min(1)
            .describe("Relative file path inside WORKSPACE_ROOT."),
          encoding: z
            .enum(["utf8", "base64"])
            .default("utf8")
            .describe("Output encoding for text or binary content."),
        },
        outputSchema: {
          path: z.string(),
          size: z.number(),
          encoding: z.enum(["utf8", "base64"]),
          content: z.string(),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ path, encoding }) => {
        const file = await getAnyWorkspaceFile(path);
        const content = await readFile(file.absolutePath);
        const encodedContent =
          encoding === "base64"
            ? content.toString("base64")
            : content.toString("utf8");

        return {
          content: [{ type: "text", text: encodedContent }],
          structuredContent: {
            path: file.relativePath,
            size: file.size,
            encoding,
            content: encodedContent,
          },
        };
      },
    );

    server.registerTool(
      "write_any_file",
      {
        title: "Write any workspace file",
        description:
          "Create or overwrite any file inside WORKSPACE_ROOT using UTF-8 or base64 content. This bypasses safer text patch tools.",
        inputSchema: {
          path: z
            .string()
            .min(1)
            .describe("Relative file path inside WORKSPACE_ROOT."),
          content: z
            .string()
            .max(maxAnyFileBytes * 2)
            .describe("Content to write using the selected encoding."),
          encoding: z
            .enum(["utf8", "base64"])
            .default("utf8")
            .describe("Input content encoding."),
          overwrite: z
            .boolean()
            .default(true)
            .describe("Allow overwriting an existing file."),
        },
        outputSchema: {
          path: z.string(),
          bytes: z.number(),
          encoding: z.enum(["utf8", "base64"]),
          overwritten: z.boolean(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ path, content, encoding, overwrite }) => {
        const absolutePath = resolveAnyWorkspacePath(path);
        const output = Buffer.from(content, encoding === "base64" ? "base64" : "utf8");

        if (output.byteLength > maxAnyFileBytes) {
          throw new Error(`Any-file write exceeds the ${maxAnyFileBytes} byte limit.`);
        }

        await prepareAnyWorkspaceWrite(absolutePath);

        let existed = false;

        try {
          const existingPath = await realAnyWorkspacePath(path);
          existed = (await stat(existingPath)).isFile();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }

        await writeFile(absolutePath, output, {
          flag: overwrite ? "w" : "wx",
        });

        return {
          content: [
            {
              type: "text",
              text: `Wrote ${toWorkspaceRelativePath(absolutePath)}.`,
            },
          ],
          structuredContent: {
            path: toWorkspaceRelativePath(absolutePath),
            bytes: output.byteLength,
            encoding,
            overwritten: existed,
          },
        };
      },
    );

    server.registerTool(
      "delete_any_file",
      {
        title: "Delete any workspace file",
        description:
          "Delete one file inside WORKSPACE_ROOT. This does not delete directories.",
        inputSchema: {
          path: z
            .string()
            .min(1)
            .describe("Relative file path inside WORKSPACE_ROOT."),
        },
        outputSchema: {
          path: z.string(),
          deleted: z.boolean(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ path }) => {
        const file = await getAnyWorkspaceFile(path);
        await unlink(file.absolutePath);

        return {
          content: [
            {
              type: "text",
              text: `Deleted ${file.relativePath}.`,
            },
          ],
          structuredContent: {
            path: file.relativePath,
            deleted: true,
          },
        };
      },
    );

    server.registerTool(
      "run_any_command",
      {
        title: "Run any command",
        description:
          "Run an arbitrary shell command from a workspace directory. The command itself can read, write, access the network, and escape workspace file-tool restrictions.",
        inputSchema: {
          command: z
            .string()
            .trim()
            .min(1)
            .max(10_000)
            .describe("Shell command to execute."),
          cwd: z
            .string()
            .default(".")
            .describe("Relative workspace directory for the command."),
          timeoutMs: z
            .number()
            .int()
            .min(1_000)
            .max(maxCommandTimeoutMs)
            .default(120_000)
            .describe("Maximum command runtime."),
        },
        outputSchema: {
          cwd: z.string(),
          result: z.object({
            command: z.string(),
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
            truncated: z.boolean(),
          }),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ command, cwd, timeoutMs }) => {
        const actualCwd = await getAnyWorkspaceDirectory(cwd);
        const shellCommand = getShellCommand(command);
        const result = await runWorkspaceCommand(
          shellCommand.executable,
          shellCommand.args,
          actualCwd,
          command,
          timeoutMs,
        );

        return {
          content: [
            {
              type: "text",
              text: [
                `${result.command} exited with ${result.exitCode}.`,
                result.stdout,
                result.stderr,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          structuredContent: {
            cwd: toWorkspaceRelativePath(actualCwd),
            result,
          },
        };
      },
    );

    server.registerTool(
      "npm_install",
      {
        title: "NPM install",
        description:
          "Run npm install inside a workspace project with arbitrary npm package specs. This can download code, run package install scripts, and modify project files.",
        inputSchema: {
          projectPath: z
            .string()
            .default(".")
            .describe("Relative workspace project directory."),
          packages: z
            .array(z.string().trim().min(1).max(300))
            .max(100)
            .default([])
            .describe("Package specs. Empty installs dependencies from package.json."),
          dev: z
            .boolean()
            .default(false)
            .describe("Save package specs as dev dependencies."),
        },
        outputSchema: {
          projectPath: z.string(),
          packages: z.array(z.string()),
          dev: z.boolean(),
          result: z.object({
            command: z.string(),
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
            truncated: z.boolean(),
          }),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ projectPath, packages, dev }) => {
        packages.forEach(assertSafePackageSpec);

        const projectDirectory = await getAnyWorkspaceDirectory(projectPath);
        const npmArgs = [
          "install",
          ...(dev && packages.length > 0 ? ["--save-dev"] : []),
          ...packages,
        ];
        const npmCommand = getWindowsPackageCommand("npm", npmArgs);
        const result = await runWorkspaceCommand(
          npmCommand.executable,
          npmCommand.args,
          projectDirectory,
          `npm ${npmArgs.join(" ")}`,
          maxCommandTimeoutMs,
        );

        return {
          content: [
            {
              type: "text",
              text: [
                `${result.command} exited with ${result.exitCode}.`,
                result.stdout,
                result.stderr,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          structuredContent: {
            projectPath: toWorkspaceRelativePath(projectDirectory),
            packages,
            dev,
            result,
          },
        };
      },
    );

    server.registerTool(
      "git_add",
      {
        title: "Git add",
        description:
          "Stage Git pathspecs inside a workspace repository before committing.",
        inputSchema: {
          repoPath: z
            .string()
            .default(".")
            .describe("Relative workspace repository directory."),
          paths: z
            .array(z.string().trim().min(1).max(500))
            .min(1)
            .max(100)
            .default(["."])
            .describe("Git pathspecs to stage."),
        },
        outputSchema: {
          repoPath: z.string(),
          paths: z.array(z.string()),
          result: z.object({
            command: z.string(),
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
            truncated: z.boolean(),
          }),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ repoPath, paths }) => {
        const repoDirectory = await getProjectDirectory(repoPath);
        const args = ["add", "--", ...paths];
        const result = await runWorkspaceCommand(
          "git",
          args,
          repoDirectory,
          `git ${args.join(" ")}`,
          30_000,
        );

        return {
          content: [{ type: "text", text: [result.stdout, result.stderr].filter(Boolean).join("\n") }],
          structuredContent: {
            repoPath: toWorkspaceRelativePath(repoDirectory),
            paths,
            result,
          },
        };
      },
    );

    server.registerTool(
      "git_commit",
      {
        title: "Git commit",
        description:
          "Create a Git commit in a workspace repository from staged changes. Optionally include modified tracked files with git commit -a.",
        inputSchema: {
          repoPath: z
            .string()
            .default(".")
            .describe("Relative workspace repository directory."),
          message: z
            .string()
            .trim()
            .min(1)
            .max(5000)
            .describe("Git commit message."),
          allTracked: z
            .boolean()
            .default(false)
            .describe("Use git commit -a for modified tracked files."),
        },
        outputSchema: {
          repoPath: z.string(),
          allTracked: z.boolean(),
          result: z.object({
            command: z.string(),
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
            truncated: z.boolean(),
          }),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async ({ repoPath, message, allTracked }) => {
        const repoDirectory = await getProjectDirectory(repoPath);
        const args = ["commit", ...(allTracked ? ["-a"] : []), "-m", message];
        const result = await runWorkspaceCommand(
          "git",
          args,
          repoDirectory,
          `git commit${allTracked ? " -a" : ""} -m <message>`,
          60_000,
        );

        return {
          content: [{ type: "text", text: [result.stdout, result.stderr].filter(Boolean).join("\n") }],
          structuredContent: {
            repoPath: toWorkspaceRelativePath(repoDirectory),
            allTracked,
            result,
          },
        };
      },
    );

    server.registerTool(
      "git_push",
      {
        title: "Git push",
        description:
          "Push Git commits from a workspace repository to a remote. This can change remote repositories.",
        inputSchema: {
          repoPath: z
            .string()
            .default(".")
            .describe("Relative workspace repository directory."),
          remote: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .optional()
            .describe("Optional Git remote name or URL."),
          branch: z
            .string()
            .trim()
            .min(1)
            .max(300)
            .optional()
            .describe("Optional branch or refspec."),
          setUpstream: z
            .boolean()
            .default(false)
            .describe("Pass --set-upstream when remote and branch are provided."),
          forceWithLease: z
            .boolean()
            .default(false)
            .describe("Pass --force-with-lease."),
        },
        outputSchema: {
          repoPath: z.string(),
          result: z.object({
            command: z.string(),
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
            truncated: z.boolean(),
          }),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async ({ repoPath, remote, branch, setUpstream, forceWithLease }) => {
        const repoDirectory = await getProjectDirectory(repoPath);
        const args = [
          "push",
          ...(forceWithLease ? ["--force-with-lease"] : []),
          ...(setUpstream ? ["--set-upstream"] : []),
          ...(remote ? [remote] : []),
          ...(branch ? [branch] : []),
        ];
        const result = await runWorkspaceCommand(
          "git",
          args,
          repoDirectory,
          `git ${args.join(" ")}`,
          maxCommandTimeoutMs,
        );

        return {
          content: [{ type: "text", text: [result.stdout, result.stderr].filter(Boolean).join("\n") }],
          structuredContent: {
            repoPath: toWorkspaceRelativePath(repoDirectory),
            result,
          },
        };
      },
    );

    server.registerTool(
      "git_reset",
      {
        title: "Git reset",
        description:
          "Run Git reset in a workspace repository. Hard reset can discard tracked working-tree changes.",
        inputSchema: {
          repoPath: z
            .string()
            .default(".")
            .describe("Relative workspace repository directory."),
          mode: z
            .enum(["soft", "mixed", "hard"])
            .default("mixed")
            .describe("Git reset mode."),
          target: z
            .string()
            .trim()
            .min(1)
            .max(500)
            .default("HEAD")
            .describe("Commit-ish or ref target."),
        },
        outputSchema: {
          repoPath: z.string(),
          mode: z.enum(["soft", "mixed", "hard"]),
          target: z.string(),
          result: z.object({
            command: z.string(),
            exitCode: z.number(),
            stdout: z.string(),
            stderr: z.string(),
            truncated: z.boolean(),
          }),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async ({ repoPath, mode, target }) => {
        const repoDirectory = await getProjectDirectory(repoPath);
        const args = ["reset", `--${mode}`, target];
        const result = await runWorkspaceCommand(
          "git",
          args,
          repoDirectory,
          `git ${args.join(" ")}`,
          60_000,
        );

        return {
          content: [{ type: "text", text: [result.stdout, result.stderr].filter(Boolean).join("\n") }],
          structuredContent: {
            repoPath: toWorkspaceRelativePath(repoDirectory),
            mode,
            target,
            result,
          },
        };
      },
    );
  }

  return server;
}

function methodNotAllowed() {
  return {
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed.",
    },
    id: null,
  };
}

async function startStdioServer() {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(`${serverName} listening over stdio`);
}

function startHttpServer() {
  const app = createMcpExpressApp();

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Failed to handle MCP request:", error);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error.",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json(methodNotAllowed());
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json(methodNotAllowed());
  });

  const port = Number(process.env.PORT ?? 3000);

  app.listen(port, () => {
    console.log(`${serverName} listening on http://localhost:${port}/mcp`);
  });
}

if (process.argv.includes("--stdio")) {
  startStdioServer().catch((error: unknown) => {
    console.error("Failed to start stdio MCP server:", error);
    process.exit(1);
  });
} else {
  startHttpServer();
}
