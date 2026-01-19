/**
 * ChatPane Component - Individual chat pane for a session
 * 
 * Design: Terminal-Inspired Dark Mode
 * - Compact header with session info and controls
 * - Scrollable message area
 * - Input field at bottom
 */

import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Terminal,
  Square,
  Send,
  X,
  Maximize2,
  Minimize2,
  AlertCircle,
  GitBranch,
} from "lucide-react";
import { Streamdown } from "streamdown";
import type { Session, Message, Worktree } from "../../../shared/types";

interface ChatPaneProps {
  session: Session;
  worktree: Worktree | undefined;
  messages: Message[];
  streamingContent: string | null;
  onSendMessage: (message: string) => void;
  onStopSession: () => void;
  onClose: () => void;
  onMaximize?: () => void;
  isMaximized?: boolean;
}

export function ChatPane({
  session,
  worktree,
  messages,
  streamingContent,
  onSendMessage,
  onStopSession,
  onClose,
  onMaximize,
  isMaximized = false,
}: ChatPaneProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debug: log messages count
  useEffect(() => {
    console.log("[ChatPane] Messages count:", messages.length, "Session:", session.id);
  }, [messages, session.id]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = inputRef.current;
    if (input && input.value.trim()) {
      onSendMessage(input.value.trim());
      input.value = "";
    }
  };

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

      {/* Messages */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full p-4 md:p-3">
          <div className="space-y-4 md:space-y-3">
            {messages.length === 0 && !streamingContent ? (
              <div className="text-center py-12 md:py-8">
                <Terminal className="w-12 h-12 md:w-8 md:h-8 text-muted-foreground mx-auto mb-3 md:mb-2" />
                <p className="text-base md:text-xs text-muted-foreground">
                  Send a message to start
                </p>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} compact />
                ))}
                {streamingContent && (
                  <div className="flex gap-2 justify-start">
                    <div className="max-w-[95%] md:max-w-[90%] rounded-lg md:rounded-md p-3 md:p-2 bg-muted border border-border">
                      <div className="flex items-center gap-1.5 md:gap-1 mb-2 md:mb-1 text-xs md:text-[10px] text-muted-foreground">
                        <Terminal className="w-3.5 h-3.5 md:w-2.5 md:h-2.5" />
                        <span>Claude</span>
                        <span className="inline-block w-2 h-2 md:w-1.5 md:h-1.5 bg-primary rounded-full animate-pulse" />
                      </div>
                      <div className="text-sm md:text-xs">
                        <Streamdown>{streamingContent}</Streamdown>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border p-3 md:p-2 shrink-0">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <span className="absolute left-3 md:left-2 top-1/2 -translate-y-1/2 text-accent font-mono text-sm md:text-xs">
              {">"}
            </span>
            <Input
              ref={inputRef}
              placeholder="Message..."
              disabled={session.status === "active"}
              className="h-12 md:h-8 pl-8 md:pl-6 text-base md:text-xs font-mono bg-input border-border"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            className="h-12 w-12 md:h-8 md:w-8 glow-green"
            disabled={session.status === "active"}
          >
            <Send className="w-5 h-5 md:w-3 md:h-3" />
          </Button>
        </div>
      </form>
    </div>
  );
}

// Compact message bubble for pane view
function MessageBubble({ message, compact }: { message: Message; compact?: boolean }) {
  const isUser = message.role === "user";
  const isError = message.type === "error";
  const isToolUse = message.type === "tool_use";
  const isToolResult = message.type === "tool_result";

  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[95%] md:max-w-[90%] rounded-lg md:rounded-md p-3 md:p-2 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : isError
            ? "bg-destructive/10 border border-destructive/30"
            : isToolUse || isToolResult
            ? "bg-muted border border-border"
            : "bg-muted border border-border"
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 md:gap-1 mb-2 md:mb-1 text-xs md:text-[10px] text-muted-foreground">
            {isError ? (
              <AlertCircle className="w-3.5 h-3.5 md:w-2.5 md:h-2.5" />
            ) : (
              <Terminal className="w-3.5 h-3.5 md:w-2.5 md:h-2.5" />
            )}
            <span>
              {isError ? "Error" : isToolUse ? "Tool" : isToolResult ? "Result" : "Claude"}
            </span>
          </div>
        )}
        <div className={`text-sm md:text-xs ${isToolUse || isToolResult ? "font-mono text-xs md:text-[10px]" : ""}`}>
          {isToolUse || isToolResult ? (
            <pre className="whitespace-pre-wrap break-words max-h-32 md:max-h-24 overflow-auto">
              {message.content}
            </pre>
          ) : (
            <Streamdown>{message.content}</Streamdown>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatPane;
