import { useCallback, useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  useRpc,
} from "@get-bb/plugin-sdk/app";
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

type ActiveTab = "files" | "worktrees" | "apps" | "repos" | "workstations";

function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(entry: DirEntry): { icon: string; color: string } {
  if (entry.kind === "directory") {
    return { icon: "Folder", color: "text-amber-400" };
  }
  const ext = entry.ext || "";
  if (["ts", "tsx"].includes(ext)) return { icon: "Code", color: "text-blue-400" };
  if (["js", "jsx"].includes(ext)) return { icon: "Code", color: "text-yellow-400" };
  if (["py"].includes(ext)) return { icon: "Code", color: "text-emerald-400" };
  if (["json", "yaml", "yml", "toml"].includes(ext)) return { icon: "FileText", color: "text-amber-300" };
  if (["md", "markdown", "txt"].includes(ext)) return { icon: "FileText", color: "text-sky-300" };
  if (["sh", "bash", "ps1", "bat"].includes(ext)) return { icon: "Terminal", color: "text-purple-400" };
  if (["png", "jpg", "jpeg", "svg", "webp", "gif"].includes(ext)) return { icon: "Image", color: "text-pink-400" };
  return { icon: "File", color: "text-muted-foreground" };
}

export function WorkstationsExplorer({ variant = "page" }: { variant?: "page" | "panel" }) {
  const rpc = useRpc<typeof rpcContract>();

  // Core workstation state
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("files");
  const [loadingHosts, setLoadingHosts] = useState(true);

  // File explorer state
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [loadingDir, setLoadingDir] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DirEntry | null>(null);
  const [fileContent, setFileContent] = useState<FileReadResult | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false);

  // Worktrees state
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [loadingWorktrees, setLoadingWorktrees] = useState(false);
  const [worktreeFilter, setWorktreeFilter] = useState("");
  const [worktreeKindFilter, setWorktreeKindFilter] = useState<"all" | "thread_environment" | "git_worktree">("all");

  // Apps state
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [appsFilter, setAppsFilter] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  // Repos & Forks state
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [reposFilter, setReposFilter] = useState("");

  // 1. Fetch Workstations
  const fetchHosts = useCallback(async () => {
    try {
      setLoadingHosts(true);
      const res = await rpc.call("workstations_list");
      setHosts(res.hosts);
      if (res.hosts.length > 0 && !selectedHostId) {
        const preferred = res.hosts.find((h) => h.isLocal) || res.hosts[0];
        setSelectedHostId(preferred.id);
      }
    } catch {
      toast.error("Failed to load workstations");
    } finally {
      setLoadingHosts(false);
    }
  }, [rpc, selectedHostId]);

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  const activeHost = useMemo(
    () => hosts.find((h) => h.id === selectedHostId) || null,
    [hosts, selectedHostId]
  );

  // 2. Fetch Directory when host or path changes
  const fetchDirectory = useCallback(
    async (dirPath?: string) => {
      if (!selectedHostId) return;
      try {
        setLoadingDir(true);
        const res = await rpc.call("workstations_directory", {
          hostId: selectedHostId,
          path: dirPath && dirPath.trim().length > 0 ? dirPath.trim() : null,
        });
        setListing(res);
        setCurrentPath(res.directory);
      } catch {
        toast.error("Failed to read directory");
      } finally {
        setLoadingDir(false);
      }
    },
    [rpc, selectedHostId]
  );

  useEffect(() => {
    if (selectedHostId && activeTab === "files") {
      fetchDirectory(currentPath);
    }
  }, [selectedHostId, activeTab, fetchDirectory]);

  // 3. Fetch File Content when selected
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
        toast.error("Could not read file preview");
        setFileContent(null);
      } finally {
        setLoadingFile(false);
      }
    },
    [rpc, selectedHostId]
  );

  // 4. Fetch Worktrees
  const fetchWorktrees = useCallback(async () => {
    try {
      setLoadingWorktrees(true);
      const res = await rpc.call("workstations_worktrees", {
        hostId: selectedHostId || null,
      });
      setWorktrees(res.worktrees);
    } catch {
      toast.error("Failed to load worktrees");
    } finally {
      setLoadingWorktrees(false);
    }
  }, [rpc, selectedHostId]);

  useEffect(() => {
    fetchWorktrees();
  }, [fetchWorktrees]);

  // 5. Fetch Apps
  const fetchApps = useCallback(async () => {
    if (!selectedHostId) return;
    try {
      setLoadingApps(true);
      const res = await rpc.call("workstations_apps", { hostId: selectedHostId });
      setApps(res.apps);
    } catch {
      toast.error("Failed to load installed apps");
    } finally {
      setLoadingApps(false);
    }
  }, [rpc, selectedHostId]);

  useEffect(() => {
    if (selectedHostId && activeTab === "apps") {
      fetchApps();
    }
  }, [selectedHostId, activeTab, fetchApps]);

  // 6. Fetch Repos
  const fetchRepos = useCallback(async () => {
    if (!selectedHostId) return;
    try {
      setLoadingRepos(true);
      const res = await rpc.call("workstations_repos", { hostId: selectedHostId });
      setRepos(res.repos);
    } catch {
      toast.error("Failed to load git repositories");
    } finally {
      setLoadingRepos(false);
    }
  }, [rpc, selectedHostId]);

  useEffect(() => {
    if (selectedHostId && activeTab === "repos") {
      fetchRepos();
    }
  }, [selectedHostId, activeTab, fetchRepos]);

  // Filtered files in directory
  const filteredEntries = useMemo(() => {
    if (!listing) return [];
    return listing.entries.filter((e) => {
      if (!showHidden && e.name.startsWith(".")) return false;
      if (fileFilter && !e.name.toLowerCase().includes(fileFilter.toLowerCase())) {
        return false;
      }
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
    if (!isWin) {
      segments.push({ name: "/", path: "/" });
    }

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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard`);
  };

  // Jump into a worktree's file system directly
  const jumpToWorktree = (wt: WorktreeInfo) => {
    if (wt.hostId !== selectedHostId) {
      setSelectedHostId(wt.hostId);
    }
    setActiveTab("files");
    setCurrentPath(wt.path);
    fetchDirectory(wt.path);
    setWorktreeMenuOpen(false);
    toast.success(`Opened worktree: ${wt.name}`);
  };

  // Jump into a repo directory
  const jumpToRepo = (repoPath: string) => {
    setActiveTab("files");
    setCurrentPath(repoPath);
    fetchDirectory(repoPath);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Top Header: Workstation Selector & Machine Status */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon name="Server" className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm tracking-tight">Workstations</span>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-medium text-[11px] text-primary">
                v1.1
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Cross-machine file system, worktree manager & runtime inspector
            </p>
          </div>
        </div>

        {/* Machine Switcher Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {hosts.map((h) => {
            const isSelected = h.id === selectedHostId;
            return (
              <button
                key={h.id}
                onClick={() => {
                  setSelectedHostId(h.id);
                  setCurrentPath(undefined);
                  setSelectedFile(null);
                  setFileContent(null);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                  isSelected
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-border bg-card/80 text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    h.status === "connected" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-zinc-500"
                  )}
                />
                <Icon
                  name={h.platform === "windows" ? "AppWindow" : "Terminal"}
                  className="size-3.5"
                />
                <span className="font-semibold">{h.name}</span>
                {h.isLocal && (
                  <span className="rounded bg-accent px-1.5 py-0.2 text-[10px] text-muted-foreground">
                    local
                  </span>
                )}
              </button>
            );
          })}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => {
              fetchHosts();
              fetchWorktrees();
            }}
            title="Refresh workstations"
          >
            <Icon name="RefreshCw" className={cn("size-3.5", loadingHosts && "animate-spin")} />
          </Button>
        </div>
      </header>

      {/* Primary Navigation Tabs */}
      <nav className="flex items-center border-b border-border bg-card/40 px-4">
        <button
          onClick={() => setActiveTab("files")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === "files"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon name="Folder" className="size-3.5" />
          <span>Files & Directory Tree</span>
        </button>

        <button
          onClick={() => setActiveTab("worktrees")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === "worktrees"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon name="GitBranch" className="size-3.5" />
          <span>Worktrees & Environments</span>
          {worktrees.length > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] text-primary font-bold">
              {worktrees.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("repos")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === "repos"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon name="GitFork" className="size-3.5" />
          <span>Git Repos & Forks</span>
          {repos.length > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-0.2 text-[10px] text-foreground">
              {repos.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("apps")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === "apps"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon name="Cpu" className="size-3.5" />
          <span>Installed Apps & Tools</span>
          {apps.length > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-0.2 text-[10px] text-foreground">
              {apps.filter((a) => a.installed).length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("workstations")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === "workstations"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon name="Server" className="size-3.5" />
          <span>Workstation Matrix</span>
        </button>
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        {/* TAB 1: FILES & DIRECTORY EXPLORER */}
        {activeTab === "files" && (
          <div className="flex h-full w-full flex-col">
            {/* Explorer Bar: Quick-Worktrees, Roots, Breadcrumbs, Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/20 px-4 py-2 text-xs">
              {/* Left group: Worktree Jump, Roots, Breadcrumbs */}
              <div className="flex flex-1 items-center gap-1.5 overflow-x-auto py-1">
                {/* Worktree Jump Dropdown Button */}
                <div className="relative">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs font-medium shadow-sm"
                    onClick={() => setWorktreeMenuOpen(!worktreeMenuOpen)}
                  >
                    <Icon name="GitBranch" className="size-3.5" />
                    <span>Worktrees ({worktrees.length})</span>
                    <Icon name="ChevronDown" className="size-3 ml-0.5 opacity-80" />
                  </Button>

                  {/* Dropdown Menu */}
                  {worktreeMenuOpen && (
                    <div className="absolute left-0 top-8 z-50 w-80 max-h-96 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                      <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Jump to Worktree
                      </div>
                      <div className="divide-y divide-border/50">
                        {worktrees.slice(0, 30).map((wt) => (
                          <button
                            key={wt.id}
                            onClick={() => jumpToWorktree(wt)}
                            className="flex w-full flex-col items-start rounded p-2 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <div className="flex w-full items-center justify-between gap-1">
                              <span className="font-semibold truncate max-w-[190px]">
                                {wt.name}
                              </span>
                              <span className="rounded bg-secondary px-1.5 py-0.2 text-[10px] font-medium text-secondary-foreground shrink-0">
                                {wt.hostName}
                              </span>
                            </div>
                            <span className="font-mono text-[10px] text-muted-foreground truncate w-full mt-0.5">
                              {wt.path}
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="border-t border-border mt-1 pt-1 text-center">
                        <button
                          onClick={() => {
                            setWorktreeMenuOpen(false);
                            setActiveTab("worktrees");
                          }}
                          className="w-full py-1 text-center text-xs font-medium text-primary hover:underline"
                        >
                          View All {worktrees.length} Worktrees →
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <span className="text-muted-foreground/40">|</span>

                {/* Drive Roots */}
                {listing?.roots?.map((root) => (
                  <button
                    key={root}
                    onClick={() => fetchDirectory(root)}
                    className="flex items-center gap-1 rounded bg-secondary px-2 py-1 font-mono text-[11px] font-semibold text-secondary-foreground hover:bg-secondary/80"
                    title={`Jump to drive root ${root}`}
                  >
                    <Icon name="HardDrive" className="size-3" />
                    {root}
                  </button>
                ))}

                {listing?.parent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                    onClick={() => fetchDirectory(listing.parent!)}
                    title="Up one directory"
                  >
                    <Icon name="ArrowUp" className="size-3" />
                    ..
                  </Button>
                )}

                {breadcrumbs.map((b, i) => (
                  <div key={b.path} className="flex items-center gap-1 font-mono">
                    <button
                      onClick={() => fetchDirectory(b.path)}
                      className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {b.name}
                    </button>
                    {i < breadcrumbs.length - 1 && (
                      <span className="text-muted-foreground/40">/</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Filters & Actions */}
              <div className="flex items-center gap-2">
                <div className="relative w-44">
                  <Input
                    placeholder="Filter files..."
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    className="h-7 text-xs"
                  />
                  {fileFilter && (
                    <button
                      onClick={() => setFileFilter("")}
                      className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  )}
                </div>

                <Button
                  variant={showHidden ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setShowHidden(!showHidden)}
                  title="Toggle hidden / dotfiles"
                >
                  <Icon name="Eye" className="size-3 mr-1" />
                  Dotfiles
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => fetchDirectory(currentPath)}
                  title="Refresh folder"
                >
                  <Icon name="RefreshCw" className={cn("size-3", loadingDir && "animate-spin")} />
                </Button>
              </div>
            </div>

            {/* Split View: Tree on Left, Preview on Right */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left Pane: Directory Entries */}
              <div
                className={cn(
                  "flex flex-col border-r border-border bg-card/10 overflow-y-auto",
                  variant === "page" ? "w-1/3 min-w-[280px] max-w-[420px]" : "w-1/2 min-w-[240px]"
                )}
              >
                {loadingDir ? (
                  <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                    <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                    Reading directory…
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    Empty directory or all files filtered.
                  </div>
                ) : (
                  <div className="divide-y divide-border/40 p-1">
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
                            "group flex cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-xs transition-colors",
                            isSelected
                              ? "bg-primary/15 text-primary font-medium"
                              : "hover:bg-accent text-foreground/90"
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon name={icon} className={cn("size-3.5 shrink-0", color)} />
                            <span className="truncate">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 text-muted-foreground">
                            {entry.kind === "file" && entry.sizeBytes !== undefined && entry.sizeBytes !== null && (
                              <span className="text-[10px] font-mono">
                                {formatBytes(entry.sizeBytes)}
                              </span>
                            )}
                            {entry.kind === "directory" && (
                              <Icon name="ChevronRight" className="size-3 text-muted-foreground/50" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Pane: File Preview & Inspector */}
              <div className="flex flex-1 flex-col overflow-hidden bg-background">
                {selectedFile ? (
                  <div className="flex h-full flex-col">
                    {/* File Header */}
                    <div className="flex items-center justify-between border-b border-border bg-card/30 px-4 py-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <Icon
                          name={getFileIcon(selectedFile).icon}
                          className={cn("size-4 shrink-0", getFileIcon(selectedFile).color)}
                        />
                        <span className="font-semibold text-xs truncate">
                          {selectedFile.name}
                        </span>
                        {fileContent && (
                          <span className="text-[11px] text-muted-foreground font-mono">
                            ({formatBytes(fileContent.sizeBytes)}, {fileContent.linesCount} lines)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-xs"
                          onClick={() => copyToClipboard(selectedFile.path, "file path")}
                        >
                          <Icon name="Copy" className="size-3" />
                          Copy Path
                        </Button>
                      </div>
                    </div>

                    {/* File Content View */}
                    <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                      {loadingFile ? (
                        <div className="flex h-40 items-center justify-center text-muted-foreground">
                          <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                          Loading file content…
                        </div>
                      ) : fileContent?.isBinary ? (
                        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                          <Icon name="File" className="size-8 text-muted-foreground/40" />
                          <p>Binary or media file ({formatBytes(fileContent.sizeBytes)})</p>
                          <p className="text-[11px]">Cannot display text in preview.</p>
                        </div>
                      ) : fileContent?.content !== null ? (
                        <div className="table w-full">
                          {fileContent?.content?.split("\n").map((line, idx) => (
                            <div key={idx} className="table-row hover:bg-accent/40">
                              <div className="table-cell select-none pr-4 text-right text-muted-foreground/40 text-[11px] w-10">
                                {idx + 1}
                              </div>
                              <div className="table-cell whitespace-pre font-mono text-foreground/90">
                                {line || " "}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-center py-8">
                          No content available.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center p-6 text-muted-foreground">
                    <div className="rounded-full bg-accent/50 p-4 mb-3">
                      <Icon name="Code" className="size-8 text-muted-foreground/60" />
                    </div>
                    <p className="font-medium text-sm text-foreground">Next-Level File Inspector</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      Select any file in the left directory tree to inspect syntax-formatted source code, lines, and metadata.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WORKTREES & ENVIRONMENTS */}
        {activeTab === "worktrees" && (
          <div className="flex h-full flex-col overflow-y-auto p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-semibold">Active Worktrees & Environments</h3>
                <p className="text-xs text-muted-foreground">
                  Browse and switch across agent workspaces and linked git worktrees on all machines.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  placeholder="Filter worktrees..."
                  value={worktreeFilter}
                  onChange={(e) => setWorktreeFilter(e.target.value)}
                  className="h-8 w-48 text-xs"
                />
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fetchWorktrees}>
                  <Icon name="RefreshCw" className={cn("size-3 mr-1", loadingWorktrees && "animate-spin")} />
                  Rescan
                </Button>
              </div>
            </div>

            {/* Kind Filter Pills */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {[
                { id: "all", label: "All Worktrees" },
                { id: "thread_environment", label: "Agent Workspaces" },
                { id: "git_worktree", label: "Git Worktrees" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setWorktreeKindFilter(tab.id as any)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    worktreeKindFilter === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {loadingWorktrees ? (
              <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                Scanning worktrees across machines…
              </div>
            ) : worktrees.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                No worktrees found.
              </div>
            ) : (
              <div className="space-y-3">
                {worktrees
                  .filter((w) => {
                    if (worktreeKindFilter !== "all" && w.kind !== worktreeKindFilter) return false;
                    if (
                      worktreeFilter &&
                      !w.name.toLowerCase().includes(worktreeFilter.toLowerCase()) &&
                      !w.path.toLowerCase().includes(worktreeFilter.toLowerCase()) &&
                      !(w.branch && w.branch.toLowerCase().includes(worktreeFilter.toLowerCase()))
                    ) {
                      return false;
                    }
                    return true;
                  })
                  .map((wt) => (
                    <div
                      key={wt.id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card/70 p-4 transition-all hover:border-primary/50"
                    >
                      <div className="flex flex-col gap-1.5 min-w-[280px]">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">
                            {wt.name}
                          </span>

                          <span
                            className={cn(
                              "rounded px-2 py-0.5 text-[11px] font-semibold",
                              wt.kind === "thread_environment"
                                ? "bg-primary/15 text-primary"
                                : "bg-purple-500/15 text-purple-400"
                            )}
                          >
                            {wt.kind === "thread_environment" ? "Agent Workspace" : "Git Worktree"}
                          </span>

                          <span className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                            {wt.hostName}
                          </span>

                          {wt.branch && (
                            <span className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                              <Icon name="GitBranch" className="size-3" />
                              {wt.branch}
                            </span>
                          )}

                          <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground capitalize">
                            {wt.status}
                          </span>
                        </div>

                        <div className="font-mono text-xs text-muted-foreground truncate max-w-xl">
                          {wt.path}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          className="h-8 gap-1.5 text-xs font-medium"
                          onClick={() => jumpToWorktree(wt)}
                        >
                          <Icon name="Folder" className="size-3.5" />
                          Explore Worktree Files
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => copyToClipboard(wt.path, "worktree path")}
                        >
                          <Icon name="Copy" className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: GIT REPOSITORIES & FORKS */}
        {activeTab === "repos" && (
          <div className="flex h-full flex-col overflow-y-auto p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-semibold">Git Repositories & Forks</h3>
                <p className="text-xs text-muted-foreground">
                  Detected repositories on{" "}
                  <strong className="text-foreground">{activeHost?.name || "selected"}</strong>.
                  Forks are automatically identified.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  placeholder="Filter repositories..."
                  value={reposFilter}
                  onChange={(e) => setReposFilter(e.target.value)}
                  className="h-8 w-48 text-xs"
                />
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fetchRepos}>
                  <Icon name="RefreshCw" className={cn("size-3 mr-1", loadingRepos && "animate-spin")} />
                  Rescan
                </Button>
              </div>
            </div>

            {loadingRepos ? (
              <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                Scanning Git repositories…
              </div>
            ) : repos.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                No git repositories found on this host.
              </div>
            ) : (
              <div className="space-y-3">
                {repos
                  .filter(
                    (r) =>
                      !reposFilter ||
                      r.name.toLowerCase().includes(reposFilter.toLowerCase()) ||
                      r.path.toLowerCase().includes(reposFilter.toLowerCase())
                  )
                  .map((repo) => (
                    <div
                      key={repo.path}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card/70 p-4 transition-all hover:border-primary/50"
                    >
                      <div className="flex flex-col gap-1.5 min-w-[280px]">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">
                            {repo.name}
                          </span>
                          {repo.isFork ? (
                            <span className="flex items-center gap-1 rounded bg-purple-500/15 px-2 py-0.5 text-[11px] font-semibold text-purple-400">
                              <Icon name="GitFork" className="size-3" />
                              Fork
                            </span>
                          ) : (
                            <span className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                              Repository
                            </span>
                          )}

                          {repo.branch && (
                            <span className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                              <Icon name="GitBranch" className="size-3" />
                              {repo.branch}
                            </span>
                          )}

                          {repo.isDirty && (
                            <span className="size-2 rounded-full bg-amber-400" title="Uncommitted changes" />
                          )}
                        </div>

                        <div className="font-mono text-xs text-muted-foreground truncate max-w-xl">
                          {repo.path}
                        </div>

                        {repo.originUrl && (
                          <div className="flex items-center gap-1 text-[11px] text-primary/80">
                            <Icon name="ExternalLink" className="size-3" />
                            <a
                              href={repo.originUrl.replace(/\.git$/, "")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {repo.originUrl}
                            </a>
                            {repo.upstreamUrl && (
                              <span className="text-muted-foreground text-[10px]">
                                (Upstream: {repo.upstreamUrl})
                              </span>
                            )}
                          </div>
                        )}

                        {repo.lastCommit && (
                          <div className="text-[11px] text-muted-foreground italic mt-0.5">
                            Last commit: {repo.lastCommit}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 gap-1.5 text-xs font-medium"
                          onClick={() => jumpToRepo(repo.path)}
                        >
                          <Icon name="Folder" className="size-3.5" />
                          Explore Files
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => copyToClipboard(repo.path, "repo path")}
                        >
                          <Icon name="Copy" className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: INSTALLED APPS & RUNTIMES */}
        {activeTab === "apps" && (
          <div className="flex h-full flex-col overflow-y-auto p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-semibold">Installed Developer Runtimes & CLIs</h3>
                <p className="text-xs text-muted-foreground">
                  Probed directly on workstation{" "}
                  <strong className="text-foreground">{activeHost?.name || "selected"}</strong>
                </p>
              </div>

              {/* Search & Categories */}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Filter apps & tools..."
                  value={appsFilter}
                  onChange={(e) => setAppsFilter(e.target.value)}
                  className="h-8 w-48 text-xs"
                />
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fetchApps}>
                  <Icon name="RefreshCw" className={cn("size-3 mr-1", loadingApps && "animate-spin")} />
                  Rescan
                </Button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {[
                "All",
                "AI & Agents",
                "Runtimes & Compilers",
                "DevOps & Containers",
                "Package Managers",
              ].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    selectedCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Apps Grid */}
            {loadingApps ? (
              <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                <Icon name="RefreshCw" className="size-4 animate-spin mr-2" />
                Scanning installed runtimes…
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {apps
                  .filter((a) => {
                    if (selectedCategory !== "All" && a.category !== selectedCategory) return false;
                    if (appsFilter && !a.displayName.toLowerCase().includes(appsFilter.toLowerCase())) {
                      return false;
                    }
                    return true;
                  })
                  .map((app) => (
                    <div
                      key={app.name}
                      className={cn(
                        "flex flex-col justify-between rounded-lg border p-3.5 transition-shadow",
                        app.installed
                          ? "border-border bg-card/80 shadow-sm"
                          : "border-border/40 bg-card/30 opacity-70"
                      )}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-semibold text-sm">{app.displayName}</span>
                            <span className="block text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                              {app.category}
                            </span>
                          </div>
                          {app.installed ? (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-500">
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                              Installed
                            </span>
                          ) : (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              Not found
                            </span>
                          )}
                        </div>

                        {app.version && (
                          <div className="mt-2.5 inline-block rounded bg-accent/60 px-2 py-0.5 font-mono text-[11px] text-foreground font-medium">
                            {app.version}
                          </div>
                        )}

                        {app.description && (
                          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                            {app.description}
                          </p>
                        )}
                      </div>

                      {app.executablePath && (
                        <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground font-mono">
                          <span className="truncate max-w-[200px]" title={app.executablePath}>
                            {app.executablePath}
                          </span>
                          <button
                            onClick={() => copyToClipboard(app.executablePath!, "path")}
                            className="hover:text-foreground"
                            title="Copy executable path"
                          >
                            <Icon name="Copy" className="size-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: WORKSTATIONS MATRIX */}
        {activeTab === "workstations" && (
          <div className="flex h-full flex-col overflow-y-auto p-4 md:p-6">
            <div className="mb-4">
              <h3 className="text-base font-semibold">Connected Workstations & Environments</h3>
              <p className="text-xs text-muted-foreground">
                All machines enrolled in your BB mesh. Click any workstation to switch active view.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {hosts.map((host) => {
                const isSelected = host.id === selectedHostId;
                return (
                  <div
                    key={host.id}
                    onClick={() => setSelectedHostId(host.id)}
                    className={cn(
                      "flex cursor-pointer flex-col justify-between rounded-xl border p-5 transition-all",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-md"
                        : "border-border bg-card hover:border-border/80"
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground font-bold">
                            <Icon
                              name={host.platform === "windows" ? "AppWindow" : "Terminal"}
                              className="size-5"
                            />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm text-foreground">{host.name}</h4>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {host.id}
                            </span>
                          </div>
                        </div>

                        <span
                          className={cn(
                            "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                            host.status === "connected"
                              ? "bg-emerald-500/15 text-emerald-500"
                              : "bg-zinc-500/15 text-zinc-400"
                          )}
                        >
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              host.status === "connected" ? "bg-emerald-500" : "bg-zinc-500"
                            )}
                          />
                          {host.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/50">
                        <div>
                          <span className="text-muted-foreground text-[11px]">Platform:</span>
                          <span className="block font-semibold capitalize">{host.platform}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-[11px]">Type:</span>
                          <span className="block font-semibold capitalize">{host.type}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-[11px]">Permission:</span>
                          <span className="block font-semibold">{host.maxPermissionMode || "full"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-[11px]">Location:</span>
                          <span className="block font-semibold">{host.isLocal ? "Local Machine" : "Remote Host"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <Button
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        className="text-xs"
                      >
                        {isSelected ? "Active Workstation" : "Switch To This Machine"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
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
    run: ({ openTab }) => {
      openTab();
    },
  });

  // Command palette action
  app.slots.commandPaletteAction({
    id: "open-workstations",
    title: "Workstations: Explore Files, Apps & Forks",
    run: ({ openTab }) => {
      openTab({ tabId: "workstations-tab" });
    },
  });
});
