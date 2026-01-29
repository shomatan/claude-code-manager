import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  GitBranch,
  Plus,
  FolderOpen,
  Play,
  Square,
  Trash2,
  MessageSquare,
  Terminal,
  Settings,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertCircle,
  LayoutGrid,
  Columns2,
  Menu,
} from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";
import { toast } from "sonner";
import { useSocket, type TtydSession } from "@/hooks/useSocket";
import { MultiPaneLayout } from "@/components/MultiPaneLayout";
import { SessionDashboard } from "@/components/SessionDashboard";
import { RepoSelectDialog } from "@/components/RepoSelectDialog";
import { CreateWorktreeDialog } from "@/components/CreateWorktreeDialog";
import { isSessionBelongsToRepo, findRepoForSession } from "@/utils/sessionUtils";
import type { Worktree } from "../../../shared/types";

type ViewMode = "dashboard" | "panes";

export default function Dashboard() {
  const {
    isConnected,
    error,
    allowedRepos,
    repoList,
    repoPath,
    selectRepo,
    removeRepo,
    scannedRepos,
    isScanning,
    scanRepos,
    worktrees,
    createWorktree,
    deleteWorktree,
    refreshWorktrees,
    sessions,
    startSession,
    stopSession,
    sendMessage,
    sendKey,
  } = useSocket();

  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [activePanesPerRepo, setActivePanesPerRepo] = useState<Map<string, string[]>>(new Map());
  const [maximizedPane, setMaximizedPane] = useState<string | null>(null);

  // 現在のリポジトリのactivePanesを取得
  const activePanes = repoPath ? (activePanesPerRepo.get(repoPath) || []) : [];

  // activePanesを更新するヘルパー関数
  const setActivePanes = (updater: string[] | ((prev: string[]) => string[])) => {
    if (!repoPath) return;
    setActivePanesPerRepo((prev) => {
      const newMap = new Map(prev);
      const currentPanes = newMap.get(repoPath) || [];
      const newPanes = typeof updater === 'function' ? updater(currentPanes) : updater;
      newMap.set(repoPath, newPanes);
      return newMap;
    });
  };
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [isCreateWorktreeOpen, setIsCreateWorktreeOpen] = useState(false);
  const [isSelectRepoOpen, setIsSelectRepoOpen] = useState(false);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    setMaximizedPane(null);
    setSelectedWorktreeId(null);
    const currentPanes = repoPath ? (activePanesPerRepo.get(repoPath) || []) : [];
    setViewMode(currentPanes.length > 0 ? "panes" : "dashboard");
  }, [repoPath, activePanesPerRepo]);

  const getSessionForWorktree = (worktreeId: string): TtydSession | undefined => {
    return Array.from(sessions.values()).find((s) => s.worktreeId === worktreeId);
  };

  const handleSelectRepo = (path: string) => {
    selectRepo(path);
    setIsSelectRepoOpen(false);
  };

  const handleCreateWorktree = (branchName: string, baseBranch?: string) => {
    createWorktree(branchName, baseBranch);
    setIsCreateWorktreeOpen(false);
    toast.success(`Creating worktree: ${branchName}`);
  };

  const handleDeleteWorktree = (worktree: Worktree) => {
    if (worktree.isMain) {
      toast.error("Cannot delete the main worktree");
      return;
    }
    deleteWorktree(worktree.path);
    toast.success("Worktree deleted");
  };

  const handleStartSession = (worktree: Worktree) => {
    const existingSession = getSessionForWorktree(worktree.id);
    if (existingSession) {
      // Add to active panes if not already there
      if (!activePanes.includes(existingSession.id)) {
        setActivePanes((prev) => [...prev, existingSession.id]);
      }
      setViewMode("panes");
      return;
    }
    startSession(worktree.id, worktree.path);
    toast.success("Session started");
  };

  const handleStopSession = (sessionId: string) => {
    stopSession(sessionId);
    setActivePanes((prev) => prev.filter((id) => id !== sessionId));
    if (maximizedPane === sessionId) {
      setMaximizedPane(null);
    }
    toast.info("Session stopped");
  };

  const handleSelectSession = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    // セッションが属するリポジトリを特定
    const targetRepo = findRepoForSession(session, repoList);
    if (targetRepo && targetRepo !== repoPath) {
      // 別リポジトリの場合は切り替え
      selectRepo(targetRepo);
    }

    // activePanesPerRepoを直接更新（リポジトリ切り替え後でも正しく動作するように）
    const targetRepoPath = targetRepo || repoPath;
    if (targetRepoPath) {
      setActivePanesPerRepo((prev) => {
        const newMap = new Map(prev);
        const currentPanes = newMap.get(targetRepoPath) || [];
        if (!currentPanes.includes(sessionId)) {
          newMap.set(targetRepoPath, [...currentPanes, sessionId]);
        }
        return newMap;
      });
    }

    setViewMode("panes");
  };

  const handleClosePane = (sessionId: string) => {
    setActivePanes((prev) => prev.filter((id) => id !== sessionId));
    if (maximizedPane === sessionId) {
      setMaximizedPane(null);
    }
  };

  const handleMaximizePane = (sessionId: string) => {
    setMaximizedPane(maximizedPane === sessionId ? null : sessionId);
  };


  useEffect(() => {
    if (!repoPath) return;
    sessions.forEach((session, sessionId) => {
      if (isSessionBelongsToRepo(session, repoPath) && !activePanes.includes(sessionId)) {
        setActivePanes((prev) => [...prev, sessionId]);
        setViewMode("panes");
      }
    });
  }, [sessions, repoPath, activePanes]);

  // 現在のリポジトリに属し、かつ存在するセッションのみをフィルタ
  const { filteredSessions, validActivePanes } = useMemo(() => {
    const filtered = new Map(
      Array.from(sessions.entries()).filter(([sessionId, session]) =>
        repoPath && isSessionBelongsToRepo(session, repoPath) && activePanes.includes(sessionId)
      )
    );
    const valid = activePanes.filter((id) => filtered.has(id));
    return { filteredSessions: filtered, validActivePanes: valid };
  }, [sessions, repoPath, activePanes]);

  const SidebarContent = () => (
    <>
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Repositories</Label>
          {allowedRepos.length > 0 ? (
            <Select onValueChange={selectRepo} value={repoPath || undefined}>
              <SelectTrigger className="w-auto h-8 text-xs gap-1">
                <Plus className="w-3 h-3" />
              </SelectTrigger>
              <SelectContent>
                {allowedRepos.map((repo) => (
                  <SelectItem key={repo} value={repo} className="font-mono text-xs">
                    {repo.split("/").pop()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <RepoSelectDialog
              isOpen={isSelectRepoOpen}
              onOpenChange={setIsSelectRepoOpen}
              scannedRepos={scannedRepos}
              isScanning={isScanning}
              onScanRepos={scanRepos}
              onSelectRepo={handleSelectRepo}
            />
          )}
        </div>

        {repoList.length > 0 ? (
          <div className="space-y-1">
            {repoList.map((repo) => {
              const isSelected = repo === repoPath;
              const repoName = repo.split("/").pop() || repo;
              return (
                <div
                  key={repo}
                  className={`group flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-primary/20 border border-primary/30"
                      : "hover:bg-sidebar-accent"
                  }`}
                  onClick={() => selectRepo(repo)}
                >
                  <FolderOpen className={`w-4 h-4 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${isSelected ? "text-primary" : "text-sidebar-foreground"}`}>
                      {repoName}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {repo}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {isSelected && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          refreshWorktrees();
                        }}
                      >
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRepo(repo);
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            リポジトリを追加してください
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 md:w-4 md:h-4 text-muted-foreground" />
            <span className="text-base md:text-sm font-medium text-sidebar-foreground">Worktrees</span>
            <span className="text-sm md:text-xs text-muted-foreground">({worktrees.length})</span>
          </div>
          <CreateWorktreeDialog
            open={isCreateWorktreeOpen}
            onOpenChange={setIsCreateWorktreeOpen}
            selectedRepoPath={repoPath}
            onCreateWorktree={handleCreateWorktree}
          />
        </div>

        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1 pb-4">
            {worktrees.length === 0 && repoPath && (
              <div className="p-4 text-center text-muted-foreground text-base md:text-sm">
                No worktrees found
              </div>
            )}
            {!repoPath && (
              <div className="p-4 text-center text-muted-foreground text-base md:text-sm">
                Select a repository to view worktrees
              </div>
            )}
            {worktrees.map((worktree) => {
              const session = getSessionForWorktree(worktree.id);
              const isSelected = selectedWorktreeId === worktree.id;
              const isInPane = session && activePanes.includes(session.id);

              return (
                <div
                  key={worktree.id}
                  className={`group p-4 md:p-3 rounded-lg cursor-pointer transition-all ${
                    isInPane
                      ? "bg-sidebar-accent border border-primary/30"
                      : isSelected
                      ? "bg-sidebar-accent"
                      : "hover:bg-sidebar-accent/50 active:bg-sidebar-accent/70"
                  }`}
                  onClick={() => {
                    setSelectedWorktreeId(worktree.id);
                    handleStartSession(worktree);
                    if (isMobile) setSidebarOpen(false);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {session && (
                        <div
                          className={`status-indicator ${session.status}`}
                          title={session.status}
                        />
                      )}
                      <GitBranch className="w-5 h-5 md:w-4 md:h-4 text-muted-foreground shrink-0" />
                      <span className="text-base md:text-sm font-mono truncate text-sidebar-foreground">
                        {worktree.branch}
                      </span>
                      {worktree.isMain && (
                        <span className="text-xs md:text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary uppercase">
                          main
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {session ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 md:h-6 md:w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSession(session.id);
                              if (isMobile) setSidebarOpen(false);
                            }}
                          >
                            <MessageSquare className="w-5 h-5 md:w-3 md:h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 md:h-6 md:w-6 text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStopSession(session.id);
                            }}
                          >
                            <Square className="w-5 h-5 md:w-3 md:h-3" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 md:h-6 md:w-6 text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartSession(worktree);
                            if (isMobile) setSidebarOpen(false);
                          }}
                        >
                          <Play className="w-5 h-5 md:w-3 md:h-3" />
                        </Button>
                      )}
                      {!worktree.isMain && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 md:h-6 md:w-6 text-destructive"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Trash2 className="w-5 h-5 md:w-3 md:h-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-card border-border w-[calc(100%-2rem)] max-w-md mx-auto">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Worktree</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this worktree? This will also delete the associated branch.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
                              <AlertDialogCancel className="h-12 md:h-10">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-12 md:h-10"
                                onClick={() => handleDeleteWorktree(worktree)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-sm md:text-xs text-muted-foreground font-mono truncate pl-7 md:pl-6">
                    {worktree.path}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <div className="p-4 border-t border-sidebar-border">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground h-12 md:h-10 text-base md:text-sm"
          onClick={() => toast.info("Settings coming soon")}
        >
          <Settings className="w-5 h-5 md:w-4 md:h-4" />
          Settings
        </Button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex flex-col md:flex-row bg-background">
      {isMobile && (
        <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-sidebar shrink-0">
          <div className="flex items-center gap-3">
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10">
                  <Menu className="w-6 h-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[85%] max-w-[320px] p-0 flex flex-col bg-sidebar">
                <SheetHeader className="p-4 border-b border-sidebar-border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                      <Terminal className="w-5 h-5 text-primary" />
                    </div>
                    <SheetTitle className="text-sidebar-foreground">Claude Code Manager</SheetTitle>
                  </div>
                </SheetHeader>
                <div className="flex-1 flex flex-col overflow-hidden">
                  <SidebarContent />
                </div>
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-primary" />
              <span className="font-semibold text-sidebar-foreground">Claude Code</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Wifi className="w-5 h-5 text-primary" />
            ) : (
              <WifiOff className="w-5 h-5 text-destructive" />
            )}
          </div>
        </header>
      )}

      {!isMobile && (
        <aside className="w-80 border-r border-border flex flex-col bg-sidebar shrink-0">
          <div className="p-4 border-b border-sidebar-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Terminal className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="font-semibold text-sidebar-foreground">Claude Code Manager</h1>
                  <p className="text-xs text-muted-foreground font-mono">v0.2.0</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isConnected ? (
                  <Wifi className="w-4 h-4 text-primary" />
                ) : (
                  <WifiOff className="w-4 h-4 text-destructive" />
                )}
              </div>
            </div>
          </div>
          <SidebarContent />
        </aside>
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-14 md:h-12 border-b border-border flex items-center justify-between px-4 bg-sidebar shrink-0">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList className="bg-sidebar-accent h-10 md:h-9">
              <TabsTrigger value="dashboard" className="gap-2 h-8 md:h-7 px-3 md:px-2 text-sm md:text-xs">
                <LayoutGrid className="w-4 h-4 md:w-4 md:h-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </TabsTrigger>
              <TabsTrigger value="panes" className="gap-2 h-8 md:h-7 px-3 md:px-2 text-sm md:text-xs">
                <Columns2 className="w-4 h-4 md:w-4 md:h-4" />
                <span className="hidden sm:inline">Panes</span>
                {validActivePanes.length > 0 && (
                  <span className="ml-1 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                    {validActivePanes.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {!isConnected && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-5 h-5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Not connected to server</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {viewMode === "dashboard" ? (
            <SessionDashboard
              sessions={sessions}
              onSelectSession={handleSelectSession}
              onStopSession={handleStopSession}
            />
          ) : validActivePanes.length > 0 ? (
            <MultiPaneLayout
              activePanes={validActivePanes}
              sessions={filteredSessions}
              worktrees={worktrees}
              onSendMessage={sendMessage}
              onSendKey={sendKey}
              onStopSession={handleStopSession}
              onClosePane={handleClosePane}
              onMaximizePane={handleMaximizePane}
              maximizedPane={maximizedPane}
            />
          ) : (
              <div className="h-full flex items-center justify-center p-6">
                <div className="text-center max-w-md">
                  <div className="w-20 h-20 md:w-16 md:h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                    <Terminal className="w-10 h-10 md:w-8 md:h-8 text-primary" />
                  </div>
                  <h2 className="text-2xl md:text-xl font-semibold mb-3 md:mb-2">No Active Panes</h2>
                  <p className="text-base md:text-sm text-muted-foreground mb-6">
                    {isMobile ? "Tap the menu to select a worktree and start a session." : "Start a session from the sidebar to open a chat pane."}
                  </p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-base md:text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Play className="w-5 h-5 md:w-4 md:h-4 text-primary" />
                      <span>Start session</span>
                    </div>
                    <Separator orientation="vertical" className="h-4 hidden sm:block" />
                    <div className="flex items-center gap-2">
                      <Plus className="w-5 h-5 md:w-4 md:h-4 text-accent" />
                      <span>Create worktree</span>
                    </div>
                  </div>
                </div>
              </div>
          )}
        </div>
      </main>
    </div>
  );
}
