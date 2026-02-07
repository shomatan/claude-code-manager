/**
 * MultiPaneLayout Component - Grid layout for multiple terminal panes
 *
 * Design: Terminal-Inspired Dark Mode
 * - Flexible grid layout (1x1, 2x1, 2x2, etc.)
 * - Maximize/minimize individual panes
 * - Mobile-first: single pane on small screens
 * - Uses ttyd iframe for terminal rendering
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Columns2,
  Square,
  Grid2x2,
} from "lucide-react";
import { TerminalPane } from "./TerminalPane";
import { useIsMobile } from "@/hooks/useMobile";
import type { ManagedSession, SpecialKey, Worktree } from "../../../shared/types";

type LayoutMode = "single" | "split-2" | "grid-4";

interface MultiPaneLayoutProps {
  activePanes: string[]; // Session IDs
  sessions: Map<string, ManagedSession>;
  worktrees: Worktree[];
  onSendMessage: (sessionId: string, message: string) => void;
  onSendKey: (sessionId: string, key: SpecialKey) => void;
  onStopSession: (sessionId: string) => void;
  onClosePane: (sessionId: string) => void;
  onMaximizePane: (sessionId: string) => void;
  maximizedPane: string | null;
  onUploadImage?: (sessionId: string, base64Data: string, mimeType: string) => void;
  imageUploadResult?: { path: string; filename: string } | null;
  imageUploadError?: string | null;
  onClearImageUploadState?: () => void;
}

export function MultiPaneLayout({
  activePanes,
  sessions,
  worktrees,
  onSendMessage,
  onSendKey,
  onStopSession,
  onClosePane,
  onMaximizePane,
  maximizedPane,
  onUploadImage,
  imageUploadResult,
  imageUploadError,
  onClearImageUploadState,
}: MultiPaneLayoutProps) {
  const isMobile = useIsMobile();
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("grid-4");

  // Force single pane on mobile
  const effectiveLayoutMode = isMobile ? "single" : layoutMode;

  const getWorktreeForSession = (session: ManagedSession): Worktree | undefined => {
    return worktrees.find((w) => w.id === session.worktreeId);
  };

  // If a pane is maximized, only show that pane
  if (maximizedPane) {
    const session = sessions.get(maximizedPane);
    if (session) {
      const worktree = getWorktreeForSession(session);
      return (
        <div className="h-full p-2">
          <TerminalPane
            session={session}
            worktree={worktree}
            onSendMessage={(msg) => onSendMessage(maximizedPane, msg)}
            onSendKey={(key) => onSendKey(maximizedPane, key)}
            onStopSession={() => onStopSession(maximizedPane)}
            onClose={() => onClosePane(maximizedPane)}
            onMaximize={() => onMaximizePane(maximizedPane)}
            isMaximized={true}
            onUploadImage={(base64, mimeType) => onUploadImage?.(maximizedPane, base64, mimeType)}
            imageUploadResult={imageUploadResult}
            imageUploadError={imageUploadError}
            onClearImageUploadState={onClearImageUploadState}
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

    if (effectiveLayoutMode === "single" || paneCount === 1) {
      return "grid-cols-1";
    }

    if (effectiveLayoutMode === "split-2") {
      return "grid-cols-1 md:grid-cols-2";
    }

    // grid-4モード: ペイン数に応じてグリッドを調整
    if (effectiveLayoutMode === "grid-4") {
      if (paneCount <= 2) return "grid-cols-1 md:grid-cols-2";
      if (paneCount <= 4) return "grid-cols-1 md:grid-cols-2";
      if (paneCount <= 6) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
      return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";
    }

    return "grid-cols-1 md:grid-cols-2";
  };

  // 表示するペイン数を決定
  const getMaxPanes = () => {
    if (effectiveLayoutMode === "single") return 1;
    if (effectiveLayoutMode === "split-2") return 2;
    return visiblePanes.length; // grid-4モードでは全て表示
  };

  return (
    <div className="h-full flex flex-col">
      {/* Layout Controls */}
      <div className="h-12 md:h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-sidebar">
        <div className="flex items-center gap-2">
          <span className="text-base md:text-sm text-muted-foreground">
            {visiblePanes.length} active pane{visiblePanes.length !== 1 ? "s" : ""}
          </span>
        </div>
        {/* Hide layout selector on mobile - always single pane */}
        <div className="hidden md:flex items-center gap-1">
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
      <div className={`flex-1 grid ${getGridClass()} gap-3 md:gap-2 p-3 md:p-2 overflow-auto auto-rows-fr`}>
        {visiblePanes.slice(0, getMaxPanes()).map((sessionId) => {
          const session = sessions.get(sessionId);
          if (!session) return null;

          const worktree = getWorktreeForSession(session);

          return (
            <TerminalPane
              key={sessionId}
              session={session}
              worktree={worktree}
              onSendMessage={(msg) => onSendMessage(sessionId, msg)}
              onSendKey={(key) => onSendKey(sessionId, key)}
              onStopSession={() => onStopSession(sessionId)}
              onClose={() => onClosePane(sessionId)}
              onMaximize={() => onMaximizePane(sessionId)}
              isMaximized={false}
              onUploadImage={(base64, mimeType) => onUploadImage?.(sessionId, base64, mimeType)}
              imageUploadResult={imageUploadResult}
              imageUploadError={imageUploadError}
              onClearImageUploadState={onClearImageUploadState}
            />
          );
        })}
      </div>

      {/* Hidden Panes Indicator */}
      {visiblePanes.length > getMaxPanes() && (
        <div className="h-10 md:h-8 border-t border-border flex items-center justify-center text-sm md:text-xs text-muted-foreground shrink-0">
          +{visiblePanes.length - getMaxPanes()} more session(s) hidden
        </div>
      )}
    </div>
  );
}

export default MultiPaneLayout;
