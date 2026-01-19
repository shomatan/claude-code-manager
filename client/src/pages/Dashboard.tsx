/**
 * Dashboard Page - Claude Code Manager
 * 
 * Design: Terminal-Inspired Dark Mode
 * - Left sidebar: Worktree list with status indicators
 * - Right main area: Multi-pane view or dashboard overview
 * - Real-time communication via Socket.IO
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Send,
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
import { useSocket } from "@/hooks/useSocket";
import { MultiPaneLayout } from "@/components/MultiPaneLayout";
import { SessionDashboard } from "@/components/SessionDashboard";
import type { Worktree, Session } from "../../../shared/types";

type ViewMode = "dashboard" | "panes";

export default function Dashboard() {
  const {
    isConnected,
    error,
    repoPath,
    selectRepo,
    worktrees,
    createWorktree,
    deleteWorktree,
    refreshWorktrees,
    sessions,
    startSession,
    stopSession,
    sendMessage,
    messages,
    streamingContent,
  } = useSocket();

  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [activePanes, setActivePanes] = useState<string[]>([]);
  const [maximizedPane, setMaximizedPane] = useState<string | null>(null);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [isCreateWorktreeOpen, setIsCreateWorktreeOpen] = useState(false);
  const [isSelectRepoOpen, setIsSelectRepoOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [repoInput, setRepoInput] = useState("");

  // Show error toast when error changes
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  // Find session for a worktree
  const getSessionForWorktree = (worktreeId: string): Session | undefined => {
    const sessionsArray = Array.from(sessions.values());
    return sessionsArray.find((s) => s.worktreeId === worktreeId);
  };

  const handleSelectRepo = () => {
    if (!repoInput.trim()) {
      toast.error("Please enter a repository path");
      return;
    }
    selectRepo(repoInput.trim());
    setIsSelectRepoOpen(false);
  };

  const handleCreateWorktree = () => {
    if (!newBranchName.trim()) {
      toast.error("Branch name is required");
      return;
    }
    createWorktree(newBranchName.trim(), baseBranch.trim() || undefined);
    setNewBranchName("");
    setBaseBranch("");
    setIsCreateWorktreeOpen(false);
    toast.success(`Creating worktree: ${newBranchName}`);
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
    if (!activePanes.includes(sessionId)) {
      setActivePanes((prev) => [...prev, sessionId]);
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

  const handleSendMessage = (sessionId: string, message: string) => {
    sendMessage(sessionId, message);
  };

  // Auto-add new sessions to active panes
  useEffect(() => {
    sessions.forEach((session, sessionId) => {
      if (!activePanes.includes(sessionId)) {
        setActivePanes((prev) => [...prev, sessionId]);
        setViewMode("panes");
      }
    });
  }, [sessions]);

  // Sidebar content component for reuse
  const SidebarContent = () => (
    <>
      {/* Repository Path */}
      <div className="p-4 border-b border-sidebar-border">
        <Label className="text-xs text-muted-foreground uppercase tracking-wider">Repository</Label>
        {repoPath ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 p-2 md:p-2 rounded-md bg-sidebar-accent">
              <FolderOpen className="w-4 h-4 md:w-4 md:h-4 text-accent shrink-0" />
              <span className="text-sm md:text-sm font-mono text-sidebar-foreground truncate">{repoPath}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 md:h-8 md:w-8 shrink-0"
              onClick={refreshWorktrees}
            >
              <RefreshCw className="w-5 h-5 md:w-4 md:h-4" />
            </Button>
          </div>
        ) : (
          <Dialog open={isSelectRepoOpen} onOpenChange={setIsSelectRepoOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full mt-2 justify-start gap-2 h-12 md:h-10 text-base md:text-sm">
                <FolderOpen className="w-5 h-5 md:w-4 md:h-4" />
                Select Repository
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border w-[calc(100%-2rem)] max-w-md mx-auto">
              <DialogHeader>
                <DialogTitle>Select Repository</DialogTitle>
                <DialogDescription>
                  Enter the path to a local git repository.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="repoPath">Repository Path</Label>
                  <Input
                    id="repoPath"
                    placeholder="/path/to/your/repository"
                    value={repoInput}
                    onChange={(e) => setRepoInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSelectRepo();
                      }
                    }}
                    className="font-mono h-12 md:h-10 text-base md:text-sm"
                  />
                </div>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => setIsSelectRepoOpen(false)} className="h-12 md:h-10">
                  Cancel
                </Button>
                <Button onClick={handleSelectRepo} className="glow-green h-12 md:h-10">
                  Select
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Worktrees Section */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 md:w-4 md:h-4 text-muted-foreground" />
            <span className="text-base md:text-sm font-medium text-sidebar-foreground">Worktrees</span>
            <span className="text-sm md:text-xs text-muted-foreground">({worktrees.length})</span>
          </div>
          <Dialog open={isCreateWorktreeOpen} onOpenChange={setIsCreateWorktreeOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 md:h-7 md:w-7"
                disabled={!repoPath}
              >
                <Plus className="w-5 h-5 md:w-4 md:h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border w-[calc(100%-2rem)] max-w-md mx-auto">
              <DialogHeader>
                <DialogTitle>Create New Worktree</DialogTitle>
                <DialogDescription>
                  Create a new git worktree with a new branch.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="branch">Branch Name</Label>
                  <Input
                    id="branch"
                    placeholder="feature/new-feature"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    className="font-mono h-12 md:h-10 text-base md:text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="baseBranch">Base Branch (optional)</Label>
                  <Input
                    id="baseBranch"
                    placeholder="main"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    className="font-mono h-12 md:h-10 text-base md:text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Worktree Path (auto-generated)</Label>
                  <div className="p-3 md:p-2 rounded-md bg-muted font-mono text-sm text-muted-foreground">
                    {repoPath}-{newBranchName.replace(/\//g, "-") || "branch-name"}
                  </div>
                </div>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => setIsCreateWorktreeOpen(false)} className="h-12 md:h-10">
                  Cancel
                </Button>
                <Button onClick={handleCreateWorktree} className="glow-green h-12 md:h-10">
                  Create Worktree
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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

      {/* Footer */}
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
      {/* Mobile Header */}
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

      {/* Desktop Sidebar */}
      {!isMobile && (
        <aside className="w-80 border-r border-border flex flex-col bg-sidebar shrink-0">
          {/* Header */}
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

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* View Mode Tabs */}
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
                {activePanes.length > 0 && (
                  <span className="ml-1 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                    {activePanes.length}
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

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {viewMode === "dashboard" ? (
            <SessionDashboard
              sessions={sessions}
              worktrees={worktrees}
              messages={messages}
              streamingContent={streamingContent}
              onSelectSession={handleSelectSession}
              onStopSession={handleStopSession}
            />
          ) : (
            activePanes.length > 0 ? (
              <MultiPaneLayout
                activePanes={activePanes}
                sessions={sessions}
                worktrees={worktrees}
                messages={messages}
                streamingContent={streamingContent}
                onSendMessage={handleSendMessage}
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
            )
          )}
        </div>
      </main>
    </div>
  );
}
