import { useCallback, useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  AppInfo,
  DirEntry,
  DirListing,
  FileReadResult,
  HostInfo,
  RepoInfo,
  WorktreeInfo,
  rpcContract,
} from "./server";

type ActiveTab = "explorer" | "repos" | "apps";

function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(entry: DirEntry): { icon: string; color: string } {
  if (entry.kind === "directory") return { icon: "Folder", color: "text-amber-400" };
  const ext = entry.ext || "";
  if (["ts", "tsx", "js", "jsx"].includes(ext)) return { icon: "Code", color: "text-blue-400" };
  if (["py"].includes(ext)) return { icon: "Code", color: "text-emerald-400" };
  if (["json", "yaml", "yml", "toml"].includes(ext)) return { icon: "FileText", color: "text-amber-300" };
  if (["md", "markdown", "txt"].includes(ext)) return { icon: "FileText", color: "text-sky-300" };
  if (["sh", "bash", "ps1", "bat"].includes(ext)) return { icon: "Terminal", color: "text-purple-400" };
  return { icon: "File", color: "text-muted-foreground" };
}

export function WorkstationsExplorer({ variant = "page" }: { variant?: "page" | "panel" }) {
  const rpc = useRpc<typeof rpcContract>();

  // Workstation state
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("explorer");

  // Files & Worktrees state
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string>("custom");
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loadingDir, setLoadingDir] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DirEntry | null>(null);
  const [fileContent, setFileContent] = useState<FileReadResult | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Repos & Apps state
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  // 1. Initial Load: Workstations & Worktrees
  const loadInitialData = useCallback(async () => {
    try {
      const [hostsRes, wtRes] = await Promise.all([
        rpc.call("workstations_list"),
        rpc.call("workstations_worktrees", {}),
      ]);
      setHosts(hostsRes.hosts);
      setWorktrees(wtRes.worktrees);

      if (hostsRes.hosts.length > 0 && !selectedHostId) {
        const preferred = hostsRes.hosts.find((h) => h.isLocal) || hostsRes.hosts[0];
        setSelectedHostId(preferred.id);
      }
    } catch {
      toast.error("Failed to connect to workstations");
    }
  }, [rpc, selectedHostId]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // 2. Fetch directory when host or path changes
  const fetchDirectory = useCallback(
    async (path?: string) => {
      if (!selectedHostId) return;
      try {
        setLoadingDir(true);
        const res = await rpc.call("workstations_directory", {
          hostId: selectedHostId,
          path: path && path.trim().length > 0 ? path.trim() : null,
        });
        setListing(res);
        setCurrentPath(res.directory);
      } catch {
        toast.error("Could not open folder");
      } finally {
        setLoadingDir(false);
      }
    },
    [rpc, selectedHostId]
  );

  useEffect(() => {
    if (selectedHostId && activeTab === "explorer") {
      fetchDirectory(currentPath);
    }
  }, [selectedHostId, activeTab, fetchDirectory]);

  // 3. Open and preview file
  const openFile = useCallback(
    async (entry: DirEntry) => {
      if (!selectedHostId) return;
      setSelectedFile(entry);
      try {
        setLoadingFile(true);
        const res = await rpc.call("workstations_readFile", {
          hostId: selectedHostId,
          path: entry.path,
        });
        setFileContent(res);
      } catch {
        toast.error("Could not preview file");
        setFileContent(null);
      } finally {
        setLoadingFile(false);
      }
    },
    [rpc, selectedHostId]
  );

  // 4. Fetch Repos or Apps on tab switch
  useEffect(() => {
    if (!selectedHostId) return;
    if (activeTab === "repos") {
      setLoadingRepos(true);
      rpc
        .call("workstations_repos", { hostId: selectedHostId })
        .then((res) => setRepos(res.repos))
        .catch(() => toast.error("Failed to load repositories"))
        .finally(() => setLoadingRepos(false));
    } else if (activeTab === "apps") {
      setLoadingApps(true);
      rpc
        .call("workstations_apps", { hostId: selectedHostId })
        .then((res) => setApps(res.apps))
        .catch(() => toast.error("Failed to load apps"))
        .finally(() => setLoadingApps(false));
    }
  }, [selectedHostId, activeTab, rpc]);

  // Handle Worktree Dropdown Switch
  const onSelectWorktree = (wtId: string) => {
    setSelectedWorktreeId(wtId);
    if (wtId === "custom") return;
    const wt = worktrees.find((w) => w.id === wtId);
    if (wt) {
      if (wt.hostId !== selectedHostId) {
        setSelectedHostId(wt.hostId);
      }
      setSelectedFile(null);
      setFileContent(null);
      setCurrentPath(wt.path);
      fetchDirectory(wt.path);
      toast.success(`Opened workspace: ${wt.name}`);
    }
  };

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    toast.success("Path copied!");
  };

  // Filtered files in tree
  const filteredEntries = useMemo(() => {
    if (!listing) return [];
    return listing.entries.filter((e) => {
      if (!showHidden && e.name.startsWith(".")) return false;
      if (fileFilter && !e.name.toLowerCase().includes(fileFilter.toLowerCase())) return false;
      return true;
    });
  }, [listing, showHidden, fileFilter]);

  // Breadcrumb path segments
  const breadcrumbs = useMemo(() => {
    if (!listing?.directory) return [];
    const dir = listing.directory;
    const isWin = dir.includes("\\");
    const sep = isWin ? "\\" : "/";
    const parts = dir.split(sep).filter(Boolean);

    const segments: Array<{ name: string; path: string }> = [];
    if (!isWin) segments.push({ name: "/", path: "/" });

    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      if (isWin && i === 0) {
        acc = parts[0] + "\\";
        segments.push({ name: parts[0], path: acc });
      } else {
        acc = acc + (acc.endsWith(sep) || acc === "" ? "" : sep) + parts[i];
        segments.push({ name: parts[i], path: acc });
      }
    }
    return segments;
  }, [listing?.directory]);

  const activeHost = hosts.find((h) => h.id === selectedHostId);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* 1. Clean Top Header: Pick Machine + Pick Tab */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="Server" className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight">Workstations</span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                Connected
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {activeHost ? `Active: ${activeHost.name} (${activeHost.platform.toUpperCase()})` : "Select machine"}
            </p>
          </div>
        </div>

        {/* Machine Switcher & Tabs */}
        <div className="flex items-center gap-2">
          {/* Machines */}
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            {hosts.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  setSelectedHostId(h.id);
                  setSelectedFile(null);
                  setFileContent(null);
                  setCurrentPath(undefined);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                  selectedHostId === h.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon name={h.platform === "windows" ? "AppWindow" : "Terminal"} className="size-3.5" />
                <span>{h.name}</span>
              </button>
            ))}
          </div>

          {/* Tab Selector */}
          <div className="flex rounded-lg border border-border bg-card p-0.5">
            <button
              onClick={() => setActiveTab("explorer")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                activeTab === "explorer"
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon name="Folder" className="size-3.5" />
              <span>Explorer</span>
            </button>
            <button
              onClick={() => setActiveTab("repos")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                activeTab === "repos"
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon name="GitFork" className="size-3.5" />
              <span>Forks & Repos</span>
            </button>
            <button
              onClick={() => setActiveTab("apps")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                activeTab === "apps"
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon name="Cpu" className="size-3.5" />
              <span>Apps & Tools</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Content View */}
      <div className="flex-1 overflow-hidden">
        {/* TAB 1: EXPLORER (FILES & WORKTREES) */}
        {activeTab === "explorer" && (
          <div className="flex h-full w-full flex-col">
            {/* Worktree Jump & Directory Navigation Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/30 px-3 py-1.5 text-xs">
              {/* Worktree Picker */}
              <div className="flex items-center gap-2">
                <span className="font-semibold text-muted-foreground flex items-center gap-1 shrink-0">
                  <Icon name="GitBranch" className="size-3.5 text-primary" />
                  Worktree:
                </span>
                <select
                  value={selectedWorktreeId}
                  onChange={(e) => onSelectWorktree(e.target.value)}
                  className="h-7 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary max-w-[280px] truncate"
                >
                  <option value="custom">📁 Custom Folder...</option>
                  {worktrees.filter((w) => w.kind === "thread_environment").length > 0 && (
                    <optgroup label="⚡ BB Agent Workspaces">
                      {worktrees
                        .filter((w) => w.kind === "thread_environment")
                        .map((wt) => (
                          <option key={wt.id} value={wt.id}>
                            {wt.name} ({wt.hostName})
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {worktrees.filter((w) => w.kind === "factory_worktree").length > 0 && (
                    <optgroup label="🏭 Factory / Droid Worktrees">
                      {worktrees
                        .filter((w) => w.kind === "factory_worktree")
                        .map((wt) => (
                          <option key={wt.id} value={wt.id}>
                            {wt.name} ({wt.branch || "main"})
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {worktrees.filter((w) => w.kind === "git_worktree").length > 0 && (
                    <optgroup label="🔱 Git Worktrees & Repos">
                      {worktrees
                        .filter((w) => w.kind === "git_worktree")
                        .map((wt) => (
                          <option key={wt.id} value={wt.id}>
                            {wt.name} ({wt.hostName})
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Breadcrumb Path */}
              <div className="flex flex-1 items-center gap-1 overflow-x-auto px-2 font-mono text-[11px]">
                {listing?.roots?.map((root) => (
                  <button
                    key={root}
                    onClick={() => fetchDirectory(root)}
                    className="rounded bg-accent/70 px-1.5 py-0.5 font-bold hover:bg-accent"
                  >
                    {root}
                  </button>
                ))}

                {listing?.parent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1 text-[11px]"
                    onClick={() => fetchDirectory(listing.parent!)}
                  >
                    <Icon name="ArrowUp" className="size-3" />
                  </Button>
                )}

                {breadcrumbs.map((b, i) => (
                  <div key={b.path} className="flex items-center gap-0.5">
                    <button
                      onClick={() => fetchDirectory(b.path)}
                      className="rounded px-1 py-0.5 text-muted-foreground hover:text-foreground"
                    >
                      {b.name}
                    </button>
                    {i < breadcrumbs.length - 1 && <span className="text-muted-foreground/40">/</span>}
                  </div>
                ))}
              </div>

              {/* Search & Actions */}
              <div className="flex items-center gap-1.5">
                <Input
                  placeholder="Filter files..."
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  className="h-6 w-32 text-xs"
                />
                <Button
                  variant={showHidden ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  onClick={() => setShowHidden(!showHidden)}
                  title="Toggle hidden files"
                >
                  <Icon name="Eye" className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  onClick={() => fetchDirectory(currentPath)}
                  title="Refresh folder"
                >
                  <Icon name="RefreshCw" className={cn("size-3", loadingDir && "animate-spin")} />
                </Button>
              </div>
            </div>

            {/* Split View: Tree & Code Viewer */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left Pane: Files & Folders */}
              <div
                className={cn(
                  "flex flex-col border-r border-border bg-card/10 overflow-y-auto p-1",
                  variant === "page" ? "w-1/3 min-w-[260px] max-w-[380px]" : "w-1/2 min-w-[220px]"
                )}
              >
                {loadingDir ? (
                  <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                    <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                    Opening folder…
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    No files found in this directory.
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {filteredEntries.map((entry) => {
                      const { icon, color } = getFileIcon(entry);
                      const isSelected = selectedFile?.path === entry.path;
                      return (
                        <div
                          key={entry.path}
                          onClick={() => {
                            if (entry.kind === "directory") {
                              fetchDirectory(entry.path);
                            } else {
                              openFile(entry);
                            }
                          }}
                          className={cn(
                            "flex cursor-pointer items-center justify-between rounded px-2 py-1 text-xs transition-colors",
                            isSelected
                              ? "bg-primary text-primary-foreground font-medium"
                              : "hover:bg-accent text-foreground/90"
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon name={icon} className={cn("size-3.5 shrink-0", isSelected ? "text-primary-foreground" : color)} />
                            <span className="truncate">{entry.name}</span>
                          </div>
                          {entry.kind === "directory" ? (
                            <Icon name="ChevronRight" className="size-3 opacity-50 shrink-0" />
                          ) : (
                            entry.sizeBytes !== null && (
                              <span className="text-[10px] opacity-70 shrink-0 font-mono">
                                {formatBytes(entry.sizeBytes)}
                              </span>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Pane: Code Viewer & Inspector */}
              <div className="flex flex-1 flex-col overflow-hidden bg-background">
                {selectedFile ? (
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-border bg-card/40 px-3 py-1.5 text-xs">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Icon name={getFileIcon(selectedFile).icon} className={cn("size-4", getFileIcon(selectedFile).color)} />
                        <span className="font-bold truncate">{selectedFile.name}</span>
                        {fileContent && (
                          <span className="text-[11px] text-muted-foreground font-mono">
                            ({formatBytes(fileContent.sizeBytes)}, {fileContent.linesCount} lines)
                          </span>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-6 gap-1 px-2 text-xs"
                        onClick={() => copyPath(selectedFile.path)}
                      >
                        <Icon name="Copy" className="size-3" />
                        Copy Path
                      </Button>
                    </div>

                    <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                      {loadingFile ? (
                        <div className="flex h-32 items-center justify-center text-muted-foreground">
                          <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                          Loading preview…
                        </div>
                      ) : fileContent?.isBinary ? (
                        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                          <Icon name="File" className="size-8 opacity-40" />
                          <p>Binary file ({formatBytes(fileContent.sizeBytes)})</p>
                        </div>
                      ) : fileContent?.content !== null ? (
                        <div className="table w-full">
                          {fileContent?.content?.split("\n").map((line, idx) => (
                            <div key={idx} className="table-row hover:bg-accent/40">
                              <div className="table-cell select-none pr-3 text-right text-muted-foreground/40 text-[11px] w-8">
                                {idx + 1}
                              </div>
                              <div className="table-cell whitespace-pre font-mono text-foreground/90">
                                {line || " "}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">No content</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center p-6 text-muted-foreground">
                    <Icon name="Code" className="size-10 opacity-30 mb-2" />
                    <p className="font-semibold text-sm text-foreground">File Inspector</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Pick any file from the explorer on the left or select a worktree above to view code immediately.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FORKS & REPOS */}
        {activeTab === "repos" && (
          <div className="flex h-full flex-col overflow-y-auto p-4 md:p-6">
            <div className="mb-4">
              <h3 className="font-bold text-base">Git Repositories & Forks</h3>
              <p className="text-xs text-muted-foreground">
                All tracked codebases on {activeHost?.name || "selected machine"}.
              </p>
            </div>

            {loadingRepos ? (
              <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                Scanning repositories…
              </div>
            ) : repos.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                No repositories found.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {repos.map((repo) => (
                  <div
                    key={repo.path}
                    className="flex flex-col justify-between rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/50"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm text-foreground">{repo.name}</span>
                        {repo.isFork ? (
                          <span className="rounded bg-purple-500/15 px-2 py-0.5 text-[11px] font-semibold text-purple-400">
                            Fork
                          </span>
                        ) : (
                          <span className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                            Repo
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground truncate mt-1">{repo.path}</p>
                      {repo.originUrl && (
                        <p className="text-[11px] text-primary truncate mt-0.5">{repo.originUrl}</p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2">
                      <span className="text-[11px] text-muted-foreground font-mono">
                        Branch: {repo.branch || "main"}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs"
                        onClick={() => {
                          setActiveTab("explorer");
                          setCurrentPath(repo.path);
                          fetchDirectory(repo.path);
                        }}
                      >
                        Explore Files →
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: APPS & TOOLS */}
        {activeTab === "apps" && (
          <div className="flex h-full flex-col overflow-y-auto p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold text-base">Installed Tools & Developer Runtimes</h3>
                <p className="text-xs text-muted-foreground">
                  AI coding agents and programming environments detected on {activeHost?.name || "selected machine"}.
                </p>
              </div>

              {/* Category Pills */}
              <div className="flex flex-wrap gap-1">
                {[
                  "All",
                  "AI Harnesses & Agents",
                  "Runtimes & Compilers",
                  "DevOps & Containers",
                  "Package Managers",
                ].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                      selectedCategory === cat
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {loadingApps ? (
              <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                Checking installed tools…
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {apps
                  .filter((app) => {
                    if (selectedCategory !== "All" && app.category !== selectedCategory) return false;
                    return true;
                  })
                  .sort((a, b) => {
                    if (a.installed !== b.installed) return a.installed ? -1 : 1;
                    return a.displayName.localeCompare(b.displayName);
                  })
                  .map((app) => (
                  <div
                    key={app.name}
                    className={cn(
                      "flex flex-col justify-between rounded-lg border p-3.5",
                      app.installed ? "border-border bg-card shadow-sm" : "border-border/40 bg-card/40 opacity-60"
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{app.displayName}</span>
                        {app.installed ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                            Installed
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            Not found
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mt-0.5">
                        {app.category}
                      </span>
                      {app.version && (
                        <div className="mt-2 inline-block rounded bg-accent px-2 py-0.5 font-mono text-xs font-semibold">
                          {app.version}
                        </div>
                      )}
                    </div>

                    {app.executablePath && (
                      <div className="mt-3 truncate border-t border-border/40 pt-1.5 font-mono text-[10px] text-muted-foreground">
                        {app.executablePath}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  // Main full-page sidebar navigation panel
  app.slots.navPanel({
    id: "workstations",
    title: "Workstations",
    icon: "Server",
    path: "workstations",
    component: () => <WorkstationsExplorer variant="page" />,
  });

  // Thread side-panel tab
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "workstations-tab",
    title: "Workstations",
    icon: "Server",
    component: () => <WorkstationsExplorer variant="panel" />,
    run: ({ openPanel }) => {
      openPanel({ title: "Workstations" });
    },
  });

  // Command palette action
  app.slots.commandPaletteAction({
    id: "open-workstations",
    title: "Workstations: Explore Files, Apps & Forks",
    run: ({ openPanel }) => {
      openPanel({ actionId: "workstations-tab", title: "Workstations" });
    },
  });
});
