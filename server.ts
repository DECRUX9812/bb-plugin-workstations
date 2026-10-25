import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Host schema
const hostInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  platform: z.enum(["windows", "linux", "darwin", "unknown"]),
  isLocal: z.boolean(),
  lastSeenAt: z.number().nullable(),
  maxPermissionMode: z.string().nullable().optional(),
});
export type HostInfo = z.infer<typeof hostInfoSchema>;

// Directory entry schema
const dirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["directory", "file"]),
  ext: z.string().nullable(),
  sizeBytes: z.number().nullable(),
});
export type DirEntry = z.infer<typeof dirEntrySchema>;

// Directory listing schema
const dirListingSchema = z.object({
  hostId: z.string(),
  directory: z.string(),
  parent: z.string().nullable(),
  roots: z.array(z.string()),
  entries: z.array(dirEntrySchema),
});
export type DirListing = z.infer<typeof dirListingSchema>;

// File read schema
const fileReadSchema = z.object({
  path: z.string(),
  content: z.string().nullable(),
  sizeBytes: z.number(),
  mimeType: z.string().nullable(),
  linesCount: z.number(),
  sha256: z.string().nullable(),
  isBinary: z.boolean(),
  editable: z.boolean(),
});
export type FileReadResult = z.infer<typeof fileReadSchema>;

// Worktree / Environment schema
const worktreeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["thread_environment", "git_worktree"]),
  hostId: z.string(),
  hostName: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  repoName: z.string().nullable(),
  threadId: z.string().nullable(),
  threadTitle: z.string().nullable(),
  status: z.string(),
  isMain: z.boolean(),
});
export type WorktreeInfo = z.infer<typeof worktreeInfoSchema>;

// App / Tool schema
const appInfoSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  category: z.enum([
    "AI & Agents",
    "Runtimes & Compilers",
    "DevOps & Containers",
    "Package Managers",
    "System & Tools",
  ]),
  installed: z.boolean(),
  version: z.string().nullable(),
  executablePath: z.string().nullable(),
  description: z.string().nullable().optional(),
});
export type AppInfo = z.infer<typeof appInfoSchema>;

// Repository / Fork schema
const repoInfoSchema = z.object({
  name: z.string(),
  path: z.string(),
  originUrl: z.string().nullable(),
  upstreamUrl: z.string().nullable(),
  isFork: z.boolean(),
  branch: z.string().nullable(),
  lastCommit: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  isDirty: z.boolean().nullable().optional(),
});
export type RepoInfo = z.infer<typeof repoInfoSchema>;

// RPC Contract
export const rpcContract = defineRpcContract({
  workstations_list: {
    input: z.null(),
    output: z.object({
      hosts: z.array(hostInfoSchema),
      localHostId: z.string().nullable(),
    }),
  },
  workstations_directory: {
    input: z.object({
      hostId: z.string(),
      path: z.string().nullable().optional(),
    }),
    output: dirListingSchema,
  },
  workstations_readFile: {
    input: z.object({
      hostId: z.string(),
      path: z.string(),
    }),
    output: fileReadSchema,
  },
  workstations_worktrees: {
    input: z.object({
      hostId: z.string().nullable().optional(),
    }),
    output: z.object({
      worktrees: z.array(worktreeInfoSchema),
    }),
  },
  workstations_apps: {
    input: z.object({
      hostId: z.string(),
    }),
    output: z.object({
      hostId: z.string(),
      apps: z.array(appInfoSchema),
    }),
  },
  workstations_repos: {
    input: z.object({
      hostId: z.string(),
    }),
    output: z.object({
      hostId: z.string(),
      repos: z.array(repoInfoSchema),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("Workstations plugin loading");

  // Helper to determine if a host represents this Linux system
  function isDecruxLinux(hostId?: string | null): boolean {
    if (!hostId) return true;
    const lower = hostId.toLowerCase();
    return lower === "host_zzfkbj8hbd" || lower.includes("linux") || lower.includes("decrux");
  }

  let cachedLocalHostId: string | null = null;
  async function getLocalHostId(): Promise<string | null> {
    if (cachedLocalHostId !== null) return cachedLocalHostId;
    if (process.env.BB_HOST_ID) {
      cachedLocalHostId = process.env.BB_HOST_ID;
      return cachedLocalHostId;
    }
    try {
      const auth = JSON.parse(await readFile("/home/decrux/.bb-machines/decrux.getbb.app/auth.json", "utf8"));
      if (auth.hostId) {
        cachedLocalHostId = auth.hostId;
        return cachedLocalHostId;
      }
    } catch {}
    try {
      const { dataDir } = await bb.sdk.system.config();
      const val = (await readFile(path.join(dataDir, "host-id"), "utf8")).trim();
      if (val) cachedLocalHostId = val;
      return cachedLocalHostId;
    } catch {
      return null;
    }
  }

  // Determine OS platform of a host
  function inferHostPlatform(host: { name: string; id: string }): "windows" | "linux" | "darwin" | "unknown" {
    const n = host.name.toLowerCase();
    if (n.includes("alien") || n.includes("win") || n.includes("pc")) return "windows";
    if (n.includes("linux") || n.includes("ubuntu") || n.includes("decrux") || n.includes("vm")) return "linux";
    if (n.includes("mac") || n.includes("darwin") || n.includes("apple")) return "darwin";
    if (process.platform === "win32") return "windows";
    return "linux";
  }

  // 1. List all workstations
  async function listHosts(): Promise<{ hosts: HostInfo[]; localHostId: string | null }> {
    const rawHosts = await bb.sdk.hosts.list();
    const localId = await getLocalHostId();

    const hosts: HostInfo[] = rawHosts.map((h) => ({
      id: h.id,
      name: h.name,
      type: h.type,
      status: h.status,
      platform: inferHostPlatform(h),
      isLocal: h.id === localId,
      lastSeenAt: h.lastSeenAt,
      maxPermissionMode: h.maxPermissionMode ?? null,
    }));

    return { hosts, localHostId: localId };
  }

  // 2. Directory listing on a given workstation
  async function listDirectory(hostId: string, dirPath?: string | null): Promise<DirListing> {
    const args: { hostId: string; path?: string } = { hostId };
    if (dirPath && typeof dirPath === "string" && dirPath.trim().length > 0) {
      args.path = dirPath.trim();
    }
    const listing = await bb.sdk.hosts.directory(args);

    const entries: DirEntry[] = (listing.entries || []).map((e) => {
      let ext: string | null = null;
      if (e.kind === "file") {
        const dotIdx = e.name.lastIndexOf(".");
        if (dotIdx > 0) ext = e.name.slice(dotIdx + 1).toLowerCase();
      }
      return {
        name: e.name,
        path: e.path,
        kind: e.kind,
        ext,
        sizeBytes: null,
      };
    });

    // Sort: directories first alphabetically, then files alphabetically
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return {
      hostId,
      directory: listing.directory,
      parent: listing.parent ?? null,
      roots: listing.roots && listing.roots.length > 0 ? listing.roots : (listing.directory.startsWith("/") ? ["/"] : ["C:\\"]),
      entries,
    };
  }

  // 3. Read file contents on a workstation
  async function readHostFile(hostId: string, filePath: string): Promise<FileReadResult> {
    try {
      const res = await bb.sdk.files.read({ hostId, path: filePath });
      const isText = res.contentEncoding === "utf8" && typeof res.content === "string";
      const sizeBytes = res.sizeBytes ?? 0;
      const linesCount = isText ? res.content.split("\n").length : 0;

      return {
        path: filePath,
        content: isText ? res.content : null,
        sizeBytes,
        mimeType: res.mimeType ?? null,
        linesCount,
        sha256: res.sha256 ?? null,
        isBinary: !isText,
        editable: isText && sizeBytes <= 4 * 1024 * 1024,
      };
    } catch {
      // Local fallback if on this host
      const localId = await getLocalHostId();
      if ((!hostId || hostId === localId || isDecruxLinux(hostId)) && existsSync(filePath)) {
        try {
          const content = await readFile(filePath, "utf8");
          return {
            path: filePath,
            content,
            sizeBytes: Buffer.byteLength(content),
            mimeType: "text/plain",
            linesCount: content.split("\n").length,
            sha256: null,
            isBinary: false,
            editable: true,
          };
        } catch {
          // Binary or unreadable
        }
      }
      throw new Error(`Could not read file ${filePath} on host ${hostId}`);
    }
  }

  // 4. Discover Worktrees & Environments across BB & Git
  async function listWorktrees(hostIdFilter?: string | null): Promise<{ worktrees: WorktreeInfo[] }> {
    const worktrees: WorktreeInfo[] = [];
    const seenPaths = new Set<string>();

    // A. Thread Environments across all hosts
    try {
      const envs = await bb.sdk.environments.list();
      const threads = await bb.sdk.threads.list();
      const hosts = await bb.sdk.hosts.list();

      const hostMap = new Map(hosts.map((h) => [h.id, h.name]));
      const threadMap = new Map(threads.map((t) => [t.environmentId, t]));

      for (const env of envs) {
        if (!env.path) continue;
        if (hostIdFilter && env.hostId !== hostIdFilter) continue;
        if (seenPaths.has(env.path)) continue;
        seenPaths.add(env.path);

        const th = threadMap.get(env.id);
        const namePart = env.path.split(/[\\/]/).filter(Boolean).pop() || "Workspace";
        const title = th?.title ? `${th.title}` : namePart;

        worktrees.push({
          id: env.id,
          name: title,
          kind: "thread_environment",
          hostId: env.hostId,
          hostName: hostMap.get(env.hostId) || env.hostId,
          path: env.path,
          branch: env.branchName ?? null,
          repoName: namePart,
          threadId: th?.id ?? null,
          threadTitle: th?.title ?? null,
          status: env.status ?? "ready",
          isMain: true,
        });
      }
    } catch (e) {
      bb.log.warn(`environments.list failed: ${e}`);
    }

    // B. Git Worktrees on Linux host
    const localId = await getLocalHostId();
    const canScanLinux = !hostIdFilter || isDecruxLinux(hostIdFilter) || hostIdFilter === localId;
    if (canScanLinux) {
      const baseDir = "/home/decrux/Code";
      if (existsSync(baseDir)) {
        try {
          const entries = readdirSync(baseDir, { withFileTypes: true });
          for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const repoPath = path.join(baseDir, ent.name);
            try {
              const out = execSync("git worktree list --porcelain", {
                cwd: repoPath,
                encoding: "utf8",
                stdio: ["pipe", "pipe", "ignore"],
              });
              const lines = out.split("\n");
              let cur: { path?: string; head?: string; branch?: string } = {};
              for (const l of lines) {
                if (l.startsWith("worktree ")) {
                  cur.path = l.slice(9).trim();
                } else if (l.startsWith("HEAD ")) {
                  cur.head = l.slice(5).trim();
                } else if (l.startsWith("branch ")) {
                  cur.branch = l.slice(7).trim().replace(/^refs\/heads\//, "");
                } else if (l === "") {
                  if (cur.path && !seenPaths.has(cur.path)) {
                    seenPaths.add(cur.path);
                    const isMain = cur.path === repoPath;
                    const wtName = path.basename(cur.path);
                    worktrees.push({
                      id: `git-wt-${wtName}-${Math.random().toString(36).slice(2, 6)}`,
                      name: isMain ? `${ent.name} (main worktree)` : `${ent.name} → ${wtName}`,
                      kind: "git_worktree",
                      hostId: "host_zzfkbj8hbd",
                      hostName: "Decrux-Linux",
                      path: cur.path,
                      branch: cur.branch ?? (cur.head ? cur.head.slice(0, 8) : null),
                      repoName: ent.name,
                      threadId: null,
                      threadTitle: null,
                      status: isMain ? "main" : "linked",
                      isMain,
                    });
                  }
                  cur = {};
                }
              }
              if (cur.path && !seenPaths.has(cur.path)) {
                seenPaths.add(cur.path);
                const isMain = cur.path === repoPath;
                const wtName = path.basename(cur.path);
                worktrees.push({
                  id: `git-wt-${wtName}-${Math.random().toString(36).slice(2, 6)}`,
                  name: isMain ? `${ent.name} (main worktree)` : `${ent.name} → ${wtName}`,
                  kind: "git_worktree",
                  hostId: "host_zzfkbj8hbd",
                  hostName: "Decrux-Linux",
                  path: cur.path,
                  branch: cur.branch ?? (cur.head ? cur.head.slice(0, 8) : null),
                  repoName: ent.name,
                  threadId: null,
                  threadTitle: null,
                  status: isMain ? "main" : "linked",
                  isMain,
                });
              }
            } catch {}
          }
        } catch {}
      }
    }

    // Sort: Thread environments first, then linked worktrees, then main worktrees
    worktrees.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "thread_environment" ? -1 : 1;
      if (a.isMain !== b.isMain) return a.isMain ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return { worktrees };
  }

  // 5. Live discovery of installed apps / tools
  async function listApps(hostId: string): Promise<{ hostId: string; apps: AppInfo[] }> {
    const apps: AppInfo[] = [];

    // First check provider CLIs from BB SDK for any host
    try {
      const cliStatus = await bb.sdk.hosts.providerCliStatus({ hostId });
      for (const [key, item] of Object.entries(cliStatus)) {
        apps.push({
          name: item.executableName,
          displayName: item.displayName,
          category: "AI & Agents",
          installed: item.installed,
          version: item.currentVersion ?? null,
          executablePath: item.executablePath ?? null,
          description: `AI Provider CLI (${key})`,
        });
      }
    } catch (e) {
      bb.log.warn(`providerCliStatus failed for ${hostId}: ${e}`);
    }

    // If local Linux host or host_zzfkbj8hbd, probe deep system packages & developer runtimes
    const localId = await getLocalHostId();
    const isThisHost = isDecruxLinux(hostId) || (localId !== null && hostId === localId);
    if (isThisHost) {
      const localTools: Array<{
        name: string;
        displayName: string;
        category: AppInfo["category"];
        versionCmd: string;
        description: string;
      }> = [
        { name: "node", displayName: "Node.js", category: "Runtimes & Compilers", versionCmd: "node -v", description: "V8 JavaScript runtime" },
        { name: "npm", displayName: "npm", category: "Package Managers", versionCmd: "npm -v", description: "Node package manager" },
        { name: "pnpm", displayName: "pnpm", category: "Package Managers", versionCmd: "pnpm -v", description: "Fast, disk space efficient package manager" },
        { name: "yarn", displayName: "Yarn", category: "Package Managers", versionCmd: "yarn -v", description: "JavaScript package manager" },
        { name: "bun", displayName: "Bun", category: "Runtimes & Compilers", versionCmd: "bun -v", description: "All-in-one JavaScript runtime & toolkit" },
        { name: "python3", displayName: "Python 3", category: "Runtimes & Compilers", versionCmd: "python3 --version", description: "High-level programming language" },
        { name: "pip", displayName: "pip", category: "Package Managers", versionCmd: "pip --version", description: "Python package installer" },
        { name: "rustc", displayName: "Rust", category: "Runtimes & Compilers", versionCmd: "rustc --version", description: "Systems programming language compiler" },
        { name: "cargo", displayName: "Cargo", category: "Package Managers", versionCmd: "cargo --version", description: "Rust package manager & build tool" },
        { name: "go", displayName: "Go", category: "Runtimes & Compilers", versionCmd: "go version", description: "Open source programming language" },
        { name: "git", displayName: "Git", category: "DevOps & Containers", versionCmd: "git --version", description: "Distributed version control system" },
        { name: "gh", displayName: "GitHub CLI", category: "DevOps & Containers", versionCmd: "gh --version", description: "GitHub on the command line" },
        { name: "docker", displayName: "Docker", category: "DevOps & Containers", versionCmd: "docker --version", description: "Container platform" },
        { name: "podman", displayName: "Podman", category: "DevOps & Containers", versionCmd: "podman --version", description: "Daemonless container engine" },
        { name: "hermes", displayName: "Hermes Agent", category: "AI & Agents", versionCmd: "hermes --version", description: "Autonomous AI agent runtime" },
        { name: "claude", displayName: "Claude Code", category: "AI & Agents", versionCmd: "claude --version", description: "Anthropic Claude coding agent" },
        { name: "codex", displayName: "OpenAI Codex CLI", category: "AI & Agents", versionCmd: "codex --version", description: "OpenAI Codex coding assistant" },
        { name: "pi", displayName: "Pi Agent", category: "AI & Agents", versionCmd: "pi --version", description: "Minimal terminal coding harness" },
        { name: "ollama", displayName: "Ollama", category: "AI & Agents", versionCmd: "ollama --version", description: "Run local LLMs on your machine" },
      ];

      for (const tool of localTools) {
        if (apps.some((a) => a.name === tool.name)) continue;

        try {
          const binPath = execSync(`which ${tool.name}`, {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "ignore"],
          }).trim();

          let version: string | null = null;
          try {
            const rawVer = execSync(tool.versionCmd, {
              encoding: "utf8",
              timeout: 1000,
              stdio: ["pipe", "pipe", "ignore"],
            }).trim();
            version = rawVer.split("\n")[0].replace(/^v/i, "").trim();
          } catch {
            version = "Detected";
          }

          apps.push({
            name: tool.name,
            displayName: tool.displayName,
            category: tool.category,
            installed: true,
            version,
            executablePath: binPath,
            description: tool.description,
          });
        } catch {
          apps.push({
            name: tool.name,
            displayName: tool.displayName,
            category: tool.category,
            installed: false,
            version: null,
            executablePath: null,
            description: tool.description,
          });
        }
      }
    }

    return { hostId, apps };
  }

  // Helper to inspect a single git repository directory
  function inspectLocalRepo(repoDir: string): RepoInfo | null {
    try {
      const gitDir = path.join(repoDir, ".git");
      if (!existsSync(gitDir)) return null;

      let originUrl: string | null = null;
      let upstreamUrl: string | null = null;
      let branch: string | null = null;
      let lastCommit: string | null = null;
      let isFork = false;
      let isDirty = false;

      try {
        originUrl = execSync("git config --get remote.origin.url", {
          cwd: repoDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
        }).trim() || null;
      } catch {}

      try {
        upstreamUrl = execSync("git config --get remote.upstream.url", {
          cwd: repoDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
        }).trim() || null;
      } catch {}

      try {
        branch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: repoDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
        }).trim() || null;
      } catch {}

      try {
        lastCommit = execSync("git log -1 --format=\"%h - %s (%cr)\"", {
          cwd: repoDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
        }).trim() || null;
      } catch {}

      try {
        const status = execSync("git status --porcelain", {
          cwd: repoDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
        }).trim();
        isDirty = status.length > 0;
      } catch {}

      if (upstreamUrl !== null) {
        isFork = true;
      } else if (originUrl) {
        const lower = originUrl.toLowerCase();
        if (lower.includes("fork") || lower.includes("contrib") || lower.includes("decrux9812")) {
          isFork = true;
        }
      }

      return {
        name: path.basename(repoDir),
        path: repoDir,
        originUrl,
        upstreamUrl,
        isFork,
        branch,
        lastCommit,
        lastActivityAt: null,
        isDirty,
      };
    } catch {
      return null;
    }
  }

  // 6. Discover Git repositories & forks on a workstation
  async function listRepos(hostId: string): Promise<{ hostId: string; repos: RepoInfo[] }> {
    const repos: RepoInfo[] = [];
    const seenPaths = new Set<string>();

    // 1. Query BB SDK's discovered repos for any host
    try {
      const disc = await bb.sdk.hosts.experimental_discoverRepos({ hostId });
      for (const r of disc.repos || []) {
        if (seenPaths.has(r.path)) continue;
        seenPaths.add(r.path);

        const isFork = Boolean(
          r.originUrl &&
            (r.originUrl.includes("fork") ||
              r.originUrl.includes("contrib") ||
              r.originUrl.includes("DECRUX9812"))
        );

        repos.push({
          name: r.name,
          path: r.path,
          originUrl: r.originUrl ?? null,
          upstreamUrl: null,
          isFork,
          branch: "main",
          lastCommit: null,
          lastActivityAt: r.lastActivityAt ?? null,
          isDirty: false,
        });
      }
    } catch (e) {
      bb.log.warn(`experimental_discoverRepos failed for ${hostId}: ${e}`);
    }

    // 2. If Linux host / Decrux host, scan workspace & Code directories for all git repos
    const localId = await getLocalHostId();
    const isThisHost = isDecruxLinux(hostId) || (localId !== null && hostId === localId);
    if (isThisHost) {
      const scanRoots = ["/home/decrux/Code", "/home/decrux/projects", "/home/decrux"];
      for (const root of scanRoots) {
        if (!existsSync(root)) continue;
        try {
          const entries = readdirSync(root, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isDirectory()) {
              const full = path.join(root, ent.name);
              if (seenPaths.has(full)) continue;
              const info = inspectLocalRepo(full);
              if (info) {
                seenPaths.add(full);
                repos.push(info);
              }
            }
          }
        } catch {}
      }
    }

    // Sort: forks and recently active repos first
    repos.sort((a, b) => {
      if (a.isFork !== b.isFork) return a.isFork ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { hostId, repos };
  }

  // Register all RPC handlers
  bb.rpc.register(rpcContract, {
    workstations_list: async () => listHosts(),
    workstations_directory: async ({ hostId, path: dirPath }) => listDirectory(hostId, dirPath),
    workstations_readFile: async ({ hostId, path: filePath }) => readHostFile(hostId, filePath),
    workstations_worktrees: async ({ hostId }) => listWorktrees(hostId),
    workstations_apps: async ({ hostId }) => listApps(hostId),
    workstations_repos: async ({ hostId }) => listRepos(hostId),
  });

  // Register CLI commands for agents and terminal users
  bb.cli.register({
    name: "workstations",
    summary: "Explore workstations, files, installed apps, git forks, and worktrees",
    commands: [
      {
        name: "list",
        summary: "List all connected workstations and machines",
        usage: "bb workstations list [--json]",
      },
      {
        name: "worktrees",
        summary: "List agent workspace environments and git worktrees across workstations",
        usage: "bb workstations worktrees [<hostId>] [--json]",
      },
      {
        name: "apps",
        summary: "List installed developer runtimes and apps on a workstation",
        usage: "bb workstations apps [<hostId>] [--json]",
      },
      {
        name: "repos",
        summary: "List git repositories and forks on a workstation",
        usage: "bb workstations repos [<hostId>] [--json]",
      },
    ],
    async run(argv) {
      const isJson = argv.includes("--json");
      const cleanArgs = argv.filter((a) => a !== "--json");
      const sub = cleanArgs[0] || "list";

      if (sub === "list") {
        const data = await listHosts();
        if (isJson) return { exitCode: 0, stdout: JSON.stringify(data.hosts, null, 2) };
        const lines = data.hosts.map(
          (h) => `• ${h.name} (${h.id}) [${h.platform.toUpperCase()}] - ${h.status} ${h.isLocal ? "★ local" : ""}`
        );
        return { exitCode: 0, stdout: `Workstations:\n${lines.join("\n")}\n` };
      }

      if (sub === "worktrees") {
        const hostId = cleanArgs[1] || null;
        const data = await listWorktrees(hostId);
        if (isJson) return { exitCode: 0, stdout: JSON.stringify(data.worktrees, null, 2) };
        const lines = data.worktrees.map(
          (w) => `  [${w.kind === "thread_environment" ? "AGENT WORKSPACE" : "GIT WORKTREE"}] ${w.name}\n      host: ${w.hostName} (${w.hostId})\n      path: ${w.path}\n      branch: ${w.branch || "none"}`
        );
        return { exitCode: 0, stdout: `Worktrees (${data.worktrees.length} found):\n${lines.join("\n")}\n` };
      }

      if (sub === "apps") {
        const hostId = cleanArgs[1] || (await getLocalHostId()) || "host_zzfkbj8hbd";
        const data = await listApps(hostId);
        if (isJson) return { exitCode: 0, stdout: JSON.stringify(data.apps, null, 2) };
        const lines = data.apps
          .filter((a) => a.installed)
          .map((a) => `  [${a.category}] ${a.displayName}: ${a.version || "installed"} (${a.executablePath || ""})`);
        return { exitCode: 0, stdout: `Installed apps on ${hostId}:\n${lines.join("\n")}\n` };
      }

      if (sub === "repos") {
        const hostId = cleanArgs[1] || (await getLocalHostId()) || "host_zzfkbj8hbd";
        const data = await listRepos(hostId);
        if (isJson) return { exitCode: 0, stdout: JSON.stringify(data.repos, null, 2) };
        const lines = data.repos.map(
          (r) => `  ${r.isFork ? "🔱 [FORK]" : "📦 [REPO]"} ${r.name} (${r.branch || "main"})\n      path: ${r.path}\n      origin: ${r.originUrl || "none"}`
        );
        return { exitCode: 0, stdout: `Git Repositories & Forks on ${hostId} (${data.repos.length} found):\n${lines.join("\n")}\n` };
      }

      return {
        exitCode: 0,
        stdout: "Usage: bb workstations [list | worktrees [<hostId>] | apps <hostId> | repos <hostId>] [--json]\n",
      };
    },
  });

  bb.onDispose(() => {
    bb.log.info("Workstations plugin disposed");
  });

  bb.log.info("Workstations plugin ready");
}
