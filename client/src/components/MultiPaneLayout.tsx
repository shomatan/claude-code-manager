/**
 * MultiPaneLayout Component - Grid layout for multiple chat panes
 * 
 * Design: Terminal-Inspired Dark Mode
 * - Flexible grid layout (1x1, 2x1, 2x2, etc.)
 * - Drag and drop pane reordering (future)
 * - Maximize/minimize individual panes
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  LayoutGrid,
  Columns2,
  Square,
  Grid2x2,
  Maximize2,
} from "lucide-react";
import { ChatPane } from "./ChatPane";
import type { Session, Worktree, Message } from "../../../shared/types";

type LayoutMode = "single" | "split-2" | "grid-4";

interface MultiPaneLayoutProps {
  activePanes: string[]; // Session IDs
  sessions: Map<string, Session>;
  worktrees: Worktree[];
  messages: Map<string, Message[]>;
  streamingContent: Map<string, string>;
  onSendMessage: (sessionId: string, message: string) => void;
  onStopSession: (sessionId: string) => void;
  onClosePane: (sessionId: string) => void;
  onMaximizePane: (sessionId: string) => void;
  maximizedPane: string | null;
}

export function MultiPaneLayout({
  activePanes,
  sessions,
  worktrees,
  messages,
  streamingContent,
  onSendMessage,
  onStopSession,
  onClosePane,
  onMaximizePane,
  maximizedPane,
}: MultiPaneLayoutProps) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("split-2");

  const getWorktreeForSession = (session: Session): Worktree | undefined => {
    return worktrees.find((w) => w.id === session.worktreeId);
  };

  // If a pane is maximized, only show that pane
  if (maximizedPane) {
    const session = sessions.get(maximizedPane);
    if (session) {
      const worktree = getWorktreeForSession(session);
      return (
        <div className="h-full p-2">
          <ChatPane
            session={session}
            worktree={worktree}
            messages={messages.get(maximizedPane) || []}
            streamingContent={streamingContent.get(maximizedPane) || null}
            onSendMessage={(msg) => onSendMessage(maximizedPane, msg)}
            onStopSession={() => onStopSession(maximizedPane)}
            onClose={() => onClosePane(maximizedPane)}
            onMaximize={() => onMaximizePane(maximizedPane)}
            isMaximized={true}
          />
        </div>
      );
    }
  }

  // Filter to only show panes that have active sessions
  const visiblePanes = activePanes.filter((id) => sessions.has(id));

  if (visiblePanes.length === 0) {
    return null;
  }

  // Determine grid layout based on mode and number of panes
  const getGridClass = () => {
    const paneCount = visiblePanes.length;
    
    if (layoutMode === "single" || paneCount === 1) {
      return "grid-cols-1";
    }
    
    if (layoutMode === "split-2" || paneCount === 2) {
      return "grid-cols-1 md:grid-cols-2";
    }
    
    if (layoutMode === "grid-4" || paneCount >= 3) {
      return "grid-cols-1 md:grid-cols-2 xl:grid-cols-2";
    }
    
    return "grid-cols-1";
  };

  return (
    <div className="h-full flex flex-col">
      {/* Layout Controls */}
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-sidebar">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {visiblePanes.length} active pane{visiblePanes.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={layoutMode === "single" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setLayoutMode("single")}
            title="Single pane"
          >
            <Square className="w-4 h-4" />
          </Button>
          <Button
            variant={layoutMode === "split-2" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setLayoutMode("split-2")}
            title="Split view"
          >
            <Columns2 className="w-4 h-4" />
          </Button>
          <Button
            variant={layoutMode === "grid-4" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setLayoutMode("grid-4")}
            title="Grid view"
          >
            <Grid2x2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Panes Grid */}
      <div className={`flex-1 grid ${getGridClass()} gap-2 p-2 overflow-hidden auto-rows-fr`}>
        {visiblePanes.slice(0, layoutMode === "grid-4" ? 4 : layoutMode === "split-2" ? 2 : 1).map((sessionId) => {
          const session = sessions.get(sessionId);
          if (!session) return null;

          const worktree = getWorktreeForSession(session);

          return (
            <ChatPane
              key={sessionId}
              session={session}
              worktree={worktree}
              messages={messages.get(sessionId) || []}
              streamingContent={streamingContent.get(sessionId) || null}
              onSendMessage={(msg) => onSendMessage(sessionId, msg)}
              onStopSession={() => onStopSession(sessionId)}
              onClose={() => onClosePane(sessionId)}
              onMaximize={() => onMaximizePane(sessionId)}
              isMaximized={false}
            />
          );
        })}
      </div>

      {/* Hidden Panes Indicator */}
      {visiblePanes.length > (layoutMode === "grid-4" ? 4 : layoutMode === "split-2" ? 2 : 1) && (
        <div className="h-8 border-t border-border flex items-center justify-center text-xs text-muted-foreground shrink-0">
          +{visiblePanes.length - (layoutMode === "grid-4" ? 4 : layoutMode === "split-2" ? 2 : 1)} more session(s) hidden
        </div>
      )}
    </div>
  );
}

export default MultiPaneLayout;
