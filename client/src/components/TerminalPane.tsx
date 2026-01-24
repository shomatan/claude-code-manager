/**
 * TerminalPane Component - ttyd iframe with mobile-friendly input
 *
 * Design: Full terminal experience with mobile input overlay
 * - ttyd iframe for terminal rendering (handles all output display)
 * - Mobile-friendly input bar at bottom
 * - Support for special keys (Ctrl+C, etc.)
 * - Quick command buttons for common operations
 */

import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Square,
  X,
  Maximize2,
  Minimize2,
  Send,
  CornerDownLeft,
  StopCircle,
  GitBranch,
  Keyboard,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import type { Session, Worktree } from "../../../shared/types";

// Extended Session type with ttyd fields
export interface TtydSession extends Session {
  ttydUrl?: string | null;
  ttydPort?: number | null;
  tmuxSessionName?: string;
}

interface TerminalPaneProps {
  session: TtydSession;
  worktree: Worktree | undefined;
  onSendMessage: (message: string) => void;
  onSendKey: (key: "Enter" | "C-c" | "C-d" | "y" | "n") => void;
  onStopSession: () => void;
  onClose: () => void;
  onMaximize?: () => void;
  isMaximized?: boolean;
}

export function TerminalPane({
  session,
  worktree,
  onSendMessage,
  onSendKey,
  onStopSession,
  onClose,
  onMaximize,
  isMaximized = false,
}: TerminalPaneProps) {
  const [inputValue, setInputValue] = useState("");
  const [showInput, setShowInput] = useState(true);
  const [showQuickCommands, setShowQuickCommands] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(0);

  // Focus textarea when input bar is shown
  useEffect(() => {
    if (showInput && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [showInput]);

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onSendMessage(inputValue);
      setInputValue("");
    }
  };

  // Handle Enter key in textarea (with shift for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Reload iframe
  const handleReloadIframe = () => {
    setIframeKey((prev) => prev + 1);
  };

  // Construct ttyd iframe URL
  // ttydPortがある場合は直接接続（viteプロキシ経由だとWebSocket接続に問題がある）
  const ttydIframeSrc = session.ttydPort
    ? `http://127.0.0.1:${session.ttydPort}/`
    : session.ttydUrl || `/ttyd/${session.id}/`;

  // Quick commands for mobile
  const quickCommands = [
    { label: "/resume", cmd: "/resume" },
    { label: "/help", cmd: "/help" },
    { label: "/status", cmd: "/status" },
    { label: "/clear", cmd: "/clear" },
    { label: "/compact", cmd: "/compact" },
  ];

  return (
    <div className="h-full flex flex-col bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <header className="h-14 md:h-10 border-b border-border flex items-center justify-between px-4 md:px-3 bg-sidebar shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`status-indicator ${session.status}`} />
          <GitBranch className="w-4 h-4 md:w-3 md:h-3 text-muted-foreground shrink-0" />
          <span className="font-mono text-sm md:text-xs truncate text-sidebar-foreground">
            {worktree?.branch || "Unknown"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 md:h-6 md:w-6"
            onClick={handleReloadIframe}
            title="Reload terminal"
          >
            <RefreshCw className="w-5 h-5 md:w-3 md:h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 md:h-6 md:w-6"
            onClick={() => setShowInput(!showInput)}
            title={showInput ? "Hide input" : "Show input"}
          >
            <Keyboard className="w-5 h-5 md:w-3 md:h-3" />
          </Button>
          {onMaximize && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 md:h-6 md:w-6"
              onClick={onMaximize}
            >
              {isMaximized ? (
                <Minimize2 className="w-5 h-5 md:w-3 md:h-3" />
              ) : (
                <Maximize2 className="w-5 h-5 md:w-3 md:h-3" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 md:h-6 md:w-6 text-destructive hover:text-destructive"
            onClick={onStopSession}
            title="Stop session (kills tmux)"
          >
            <Square className="w-5 h-5 md:w-3 md:h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 md:h-6 md:w-6"
            onClick={onClose}
          >
            <X className="w-5 h-5 md:w-3 md:h-3" />
          </Button>
        </div>
      </header>

      {/* ttyd iframe */}
      <div className="flex-1 min-h-0 bg-[#1a1b26]">
        {session.ttydUrl || session.ttydPort ? (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={ttydIframeSrc}
            className="w-full h-full border-0"
            title={`Terminal - ${worktree?.branch || session.id}`}
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
              <p>Starting terminal...</p>
            </div>
          </div>
        )}
      </div>

      {/* Mobile-friendly Input Bar */}
      {showInput && (
        <div className="border-t border-border bg-sidebar shrink-0">
          {/* Quick commands toggle */}
          <div className="flex items-center justify-between px-3 py-1 border-b border-border/50">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowQuickCommands(!showQuickCommands)}
            >
              {showQuickCommands ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
              Quick commands
            </button>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onSendKey("y")}
                title="Send 'y' (yes)"
              >
                y
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onSendKey("n")}
                title="Send 'n' (no)"
              >
                n
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => onSendKey("C-c")}
                title="Send Ctrl+C (interrupt)"
              >
                <StopCircle className="w-3 h-3 mr-1" />
                Ctrl+C
              </Button>
            </div>
          </div>

          {/* Quick commands panel */}
          {showQuickCommands && (
            <div className="flex gap-2 px-3 py-2 border-b border-border/50 overflow-x-auto">
              {quickCommands.map(({ label, cmd }) => (
                <Button
                  key={cmd}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="shrink-0 text-xs font-mono h-8"
                  onClick={() => onSendMessage(cmd)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}

          {/* Main input */}
          <form onSubmit={handleSubmit} className="p-3 md:p-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type message... (Enter to send)"
                  className="min-h-[44px] max-h-32 resize-none font-mono text-sm bg-input"
                  rows={1}
                />
              </div>
              <Button
                type="submit"
                size="icon"
                className="h-11 w-11 md:h-9 md:w-9 glow-green shrink-0"
                disabled={!inputValue.trim()}
              >
                <Send className="w-5 h-5 md:w-4 md:h-4" />
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default TerminalPane;
