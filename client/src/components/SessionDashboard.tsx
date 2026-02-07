/**
 * SessionDashboard Component - Overview of all active sessions
 *
 * Design: Terminal-Inspired Dark Mode
 * - Grid layout showing all active sessions grouped by repository
 * - Session cards with status and quick actions
 * - Click to expand into full terminal view
 */

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Terminal,
  Play,
  Square,
  GitBranch,
  Clock,
  Zap,
  AlertCircle,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import type { ManagedSession } from "../../../shared/types";
import { getBaseName } from "@/utils/pathUtils";

interface SessionDashboardProps {
  sessions: Map<string, ManagedSession>;
  onSelectSession: (sessionId: string) => void;
  onStopSession: (sessionId: string) => void;
}

/**
 * セッションをリポジトリごとにグループ化
 */
function groupSessionsByRepo(sessions: ManagedSession[]): Map<string, ManagedSession[]> {
  const grouped = new Map<string, ManagedSession[]>();

  for (const session of sessions) {
    // worktreePathの親ディレクトリをリポジトリのベースパスとして使用
    // 例: /Users/xxx/dev/claude-code-manager-feature -> /Users/xxx/dev をベースパスとして
    // リポジトリ名は claude-code-manager
    const pathParts = session.worktreePath.split("/");
    const dirName = pathParts.pop() || "";
    const basePath = pathParts.join("/");

    // worktreeIdまたはworktreePathからリポジトリ名を推測
    // worktreeIdは通常 hash 形式なので、worktreePathを使う
    // tmuxSessionNameから情報を取得することも可能

    // リポジトリのベースパスをキーにする
    // 同じベースパスを持つセッションは同じリポジトリに属する
    const repoKey = basePath;

    const existing = grouped.get(repoKey) || [];
    existing.push(session);
    grouped.set(repoKey, existing);
  }

  return grouped;
}

export function SessionDashboard({
  sessions,
  onSelectSession,
  onStopSession,
}: SessionDashboardProps) {
  const sessionsArray = Array.from(sessions.values());

  const getStatusColor = (status: ManagedSession["status"]) => {
    switch (status) {
      case "active":
        return "text-primary";
      case "idle":
        return "text-accent";
      case "error":
        return "text-destructive";
      default:
        return "text-muted-foreground";
    }
  };

  const getStatusIcon = (status: ManagedSession["status"]) => {
    switch (status) {
      case "active":
        return <Zap className="w-4 h-4 animate-pulse" />;
      case "idle":
        return <Clock className="w-4 h-4" />;
      case "error":
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <Terminal className="w-4 h-4" />;
    }
  };

  if (sessionsArray.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 md:w-16 md:h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Terminal className="w-10 h-10 md:w-8 md:h-8 text-primary" />
          </div>
          <h2 className="text-2xl md:text-xl font-semibold mb-3 md:mb-2">No Active Sessions</h2>
          <p className="text-base md:text-sm text-muted-foreground">
            Start a session from the sidebar to begin working with Claude Code.
          </p>
        </div>
      </div>
    );
  }

  // リポジトリごとにセッションをグループ化
  const groupedSessions = groupSessionsByRepo(sessionsArray);

  return (
    <ScrollArea className="h-full p-4 md:p-4">
      <div className="mb-5 md:mb-4">
        <h2 className="text-xl md:text-lg font-semibold flex items-center gap-2">
          <Terminal className="w-6 h-6 md:w-5 md:h-5 text-primary" />
          Active Sessions
          <span className="text-base md:text-sm font-normal text-muted-foreground">
            ({sessionsArray.length})
          </span>
        </h2>
      </div>

      <div className="space-y-6">
        {Array.from(groupedSessions.entries()).map(([repoPath, repoSessions]) => {
          // リポジトリのベースパスから表示名を取得
          const repoDisplayName = getBaseName(repoPath);

          return (
            <div key={repoPath} className="space-y-3">
              {/* リポジトリヘッダー */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <FolderOpen className="w-4 h-4" />
                <span className="text-sm font-medium">{repoDisplayName}</span>
                <span className="text-xs">({repoSessions.length})</span>
              </div>

              {/* セッションカードグリッド */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {repoSessions.map((session) => {
                  const displayName = getBaseName(session.worktreePath);

                  return (
                    <div
                      key={session.id}
                      className="group bg-card border border-border rounded-lg overflow-hidden hover:border-primary/50 active:border-primary/70 transition-colors cursor-pointer"
                      onClick={() => onSelectSession(session.id)}
                    >
                      {/* Card Header */}
                      <div className="p-4 md:p-3 border-b border-border bg-sidebar">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`status-indicator ${session.status}`} />
                            <GitBranch className="w-5 h-5 md:w-4 md:h-4 text-muted-foreground shrink-0" />
                            <span className="font-mono text-base md:text-sm truncate">
                              {displayName}
                            </span>
                          </div>
                          <div className={`flex items-center gap-1 ${getStatusColor(session.status)}`}>
                            {getStatusIcon(session.status)}
                          </div>
                        </div>
                      </div>

                      {/* Card Body */}
                      <div className="p-4 md:p-3">
                        {/* Session Info */}
                        <div className="mb-4 md:mb-3 space-y-2">
                          <div className="flex items-center gap-2 text-sm md:text-xs text-muted-foreground">
                            <Terminal className="w-4 h-4 md:w-3 md:h-3 shrink-0" />
                            <span className="font-mono truncate">
                              tmux: {session.tmuxSessionName || session.id}
                            </span>
                          </div>
                          {session.ttydPort && (
                            <div className="flex items-center gap-2 text-sm md:text-xs text-muted-foreground">
                              <ExternalLink className="w-4 h-4 md:w-3 md:h-3 shrink-0" />
                              <span className="font-mono">
                                port: {session.ttydPort}
                              </span>
                            </div>
                          )}
                          <div className="text-sm md:text-xs text-muted-foreground font-mono truncate">
                            {session.worktreePath}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between text-sm md:text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5 md:gap-1">
                            {session.ttydUrl ? (
                              <span className="text-primary">Terminal ready</span>
                            ) : (
                              <span>Starting...</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 md:h-6 md:w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectSession(session.id);
                              }}
                            >
                              <Play className="w-5 h-5 md:w-3 md:h-3 text-primary" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 md:h-6 md:w-6"
                              onClick={(e) => {
                                e.stopPropagation();
                                onStopSession(session.id);
                              }}
                            >
                              <Square className="w-5 h-5 md:w-3 md:h-3 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

export default SessionDashboard;
