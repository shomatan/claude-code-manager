// Shared types between client and server

export interface Worktree {
  id: string;
  path: string;
  branch: string;
  commit: string;
  isMain: boolean;
  isBare: boolean;
}

export interface Session {
  id: string;
  worktreeId: string;
  worktreePath: string;
  status: SessionStatus;
  createdAt: Date;
}

export type SessionStatus = "active" | "idle" | "error" | "stopped";

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  type?: MessageType;
}

export type MessageType = "text" | "tool_use" | "tool_result" | "thinking" | "error";

// Claude Code stream-json event types
export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  result?: string;
  error?: string;
}

// WebSocket event types
export interface ServerToClientEvents {
  // Worktree events
  "worktree:list": (worktrees: Worktree[]) => void;
  "worktree:created": (worktree: Worktree) => void;
  "worktree:deleted": (worktreeId: string) => void;
  "worktree:error": (error: string) => void;

  // Session events
  "session:created": (session: Session) => void;
  "session:updated": (session: Session) => void;
  "session:stopped": (sessionId: string) => void;
  "session:error": (data: { sessionId: string; error: string }) => void;
  "session:restored": (data: { session: Session; messages: Message[] }) => void;
  "session:restore_failed": (data: { worktreePath: string; error: string }) => void;

  // Message events
  "message:received": (message: Message) => void;
  "message:stream": (data: { sessionId: string; chunk: string; type?: MessageType }) => void;
  "message:complete": (data: { sessionId: string; messageId: string }) => void;

  // Repository events
  "repo:set": (path: string) => void;
  "repo:error": (error: string) => void;
}

export interface ClientToServerEvents {
  // Worktree commands
  "worktree:list": (repoPath: string) => void;
  "worktree:create": (data: { repoPath: string; branchName: string; baseBranch?: string }) => void;
  "worktree:delete": (data: { repoPath: string; worktreePath: string }) => void;

  // Session commands
  "session:start": (data: { worktreeId: string; worktreePath: string }) => void;
  "session:stop": (sessionId: string) => void;
  "session:send": (data: { sessionId: string; message: string }) => void;
  "session:restore": (worktreePath: string) => void;

  // Repository commands
  "repo:select": (path: string) => void;
  "repo:browse": () => void;
}
